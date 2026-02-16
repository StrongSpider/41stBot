'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../db/connection');
const { OFFICER_LABELS_TABLE } = require('../db/constants');
const { extractFeatures } = require('./featureExtractor');

// Model storage path
const MODEL_DIR = path.join(__dirname, '..', '..', 'models');
const MODEL_FILE = path.join(MODEL_DIR, 'suspicious_account_model.json');

/**
 * Initialize model directory if it doesn't exist
 */
function ensureModelDir() {
    if (!fs.existsSync(MODEL_DIR)) {
        fs.mkdirSync(MODEL_DIR, { recursive: true });
    }
}

/**
 * Train model on officer labels using background check data
 * @param {Object} options Training options
 * @param {boolean} options.slow Whether to process slowly to avoid spamming (default: true)
 * @param {number} options.delay Delay in milliseconds between accounts (default: 30000)
 * @returns {Promise<Object>} Trained model
 */
async function trainModel(options = {}) {
    const slow = options.slow !== false;
    const delayMs = options.delay || 1000;

    ensureModelDir();

    console.log('Fetching officer labels from database...');

    const limit = options.limit || 689;

    // Fetch all labeled data
    const res = await pool.query(
        `SELECT target_roblox_id, label FROM ${OFFICER_LABELS_TABLE} ORDER BY created_at DESC LIMIT ${limit}`
    );

    if (res.rows.length === 0) {
        console.warn('No training data available. Using default model.');
        return getDefaultModel();
    }

    console.log(`Found ${res.rows.length} labeled examples. Extracting background check features...`);

    // Extract features for each labeled account
    const labeledExamples = [];
    let successCount = 0;
    let failureCount = 0;

    for (const row of res.rows) {
        try {
            // Throttling for slow burn
            if (slow && successCount > 0) {
                console.log(`  Waiting ${delayMs / 1000} seconds before next account...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            const features = await extractFeatures(Number(row.target_roblox_id));
            labeledExamples.push({
                targetRobloxId: Number(row.target_roblox_id),
                label: row.label,
                features
            });
            successCount++;

            // Log progress
            console.log(`  [${successCount}/${res.rows.length}] Processed ${row.target_roblox_id} (${labeledExamples[labeledExamples.length - 1].features.username})`);
        } catch (err) {
            failureCount++;
            console.warn(`  Failed to extract features for ${row.target_roblox_id}: ${err.message}`);
        }
    }

    console.log(`Training complete: ${successCount} succeeded, ${failureCount} failed`);

    if (labeledExamples.length === 0) {
        console.warn('No successful feature extractions. Using default model.');
        return getDefaultModel();
    }

    // Train Logistic Regression Model
    const { weights, normalization } = trainLogisticRegression(labeledExamples);
    const stats = calculateStats(labeledExamples);

    const model = {
        version: '2.0.0', // Bump version for ML model
        type: 'logistic_regression',
        trainedAt: new Date().toISOString(),
        trainingExamples: labeledExamples.length,
        weights,
        normalization,
        stats,
        labelDistribution: getLabelDistribution(labeledExamples)
    };

    // Save model
    fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2));
    console.log(`✓ Model trained and saved to ${MODEL_FILE}`);

    return model;
}

/**
 * Load model from disk
 * @returns {Object|null}
 */
function loadModel() {
    if (!fs.existsSync(MODEL_FILE)) {
        return null;
    }
    const data = fs.readFileSync(MODEL_FILE, 'utf-8');
    return JSON.parse(data);
}

/**
 * Get or train model (lazy load)
 */
function getOrLoadModel() {
    let model = loadModel();
    if (!model) {
        console.warn('No trained model found. Using default.');
        model = getDefaultModel();
    }
    return model;
}

/**
 * Train model using Logistic Regression (Gradient Descent)
 * 
 * @param {Array} examples - Labeled examples { label, features }
 * @returns {Object} Trained weights and normalization stats
 */
function trainLogisticRegression(examples) {
    // 1. Prepare Data
    // Map labels to 0.0 - 1.0
    const labelMap = {
        'REAL': 0.0,
        'LIKELY_REAL': 0.25,
        'LIKELY_ALT': 0.75,
        'ALT': 1.0
    };

    const X = []; // Feature matrix
    const y = []; // Label vector

    // Identify all unique feature keys
    const featureKeys = new Set();
    examples.forEach(ex => {
        Object.keys(ex.features.features).forEach(k => featureKeys.add(k));
    });
    const featuresList = Array.from(featureKeys).sort();

    examples.forEach(ex => {
        const row = [];
        featuresList.forEach(k => {
            row.push(Number(ex.features.features[k]) || 0);
        });
        X.push(row);
        y.push(labelMap[ex.label] || 0);
    });

    const m = X.length;
    const n = featuresList.length;

    // 2. Normalize Features (Min-Max Scaling)
    const minVals = new Array(n).fill(Infinity);
    const maxVals = new Array(n).fill(-Infinity);

    for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
            if (X[i][j] < minVals[j]) minVals[j] = X[i][j];
            if (X[i][j] > maxVals[j]) maxVals[j] = X[i][j];
        }
    }

    const normX = [];
    for (let i = 0; i < m; i++) {
        const row = [];
        row.push(1); // Bias term (x0 = 1)
        for (let j = 0; j < n; j++) {
            const range = maxVals[j] - minVals[j];
            const val = range === 0 ? 0 : (X[i][j] - minVals[j]) / range;
            row.push(val);
        }
        normX.push(row);
    }

    // 3. Gradient Descent
    let theta = new Array(n + 1).fill(0); // Weights (including bias)
    // Initialize random small weights
    for (let i = 0; i < theta.length; i++) theta[i] = (Math.random() - 0.5) * 0.1;

    const alpha = 0.1; // Learning rate
    const iterations = 1000;

    for (let iter = 0; iter < iterations; iter++) {
        const newTheta = [...theta];

        for (let j = 0; j < theta.length; j++) {
            let gradient = 0;
            for (let i = 0; i < m; i++) {
                const h = sigmoid(dotProduct(theta, normX[i]));
                gradient += (h - y[i]) * normX[i][j];
            }
            newTheta[j] = theta[j] - (alpha / m) * gradient;
        }
        theta = newTheta;
    }

    // 4. Package Result
    // formatted: { featureName: weight, ... }
    const weights = {};
    weights['__BIAS__'] = theta[0];
    for (let j = 0; j < n; j++) {
        weights[featuresList[j]] = theta[j + 1];
    }

    return {
        weights,
        normalization: {
            features: featuresList,
            min: minVals,
            max: maxVals
        }
    };
}

function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
}

function dotProduct(vecA, vecB) {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
        sum += vecA[i] * vecB[i];
    }
    return sum;
}

/**
 * Calculate statistics about feature distributions
 */
/**
 * Calculate statistics about feature distributions
 */
function calculateStats(labeledExamples) {
    const stats = {
        altExamples: 0,
        realExamples: 0,
        meanFeaturesAlt: {},
        meanFeaturesReal: {}
    };

    const labelMapping = {
        'ALT': 'alt',
        'LIKELY_ALT': 'alt',
        'REAL': 'real',
        'LIKELY_REAL': 'real'
    };

    const sums = { alt: {}, real: {} };
    const counts = { alt: 0, real: 0 };

    for (const example of labeledExamples) {
        const normalized = labelMapping[example.label] || 'real';
        stats[`${normalized}Examples`]++;
        counts[normalized]++;

        const features = example.features.features;
        for (const [key, value] of Object.entries(features)) {
            if (!sums[normalized][key]) sums[normalized][key] = 0;
            sums[normalized][key] += (Number(value) || 0);
        }
    }

    // Calculate averages
    for (const key of Object.keys(sums.alt)) {
        stats.meanFeaturesAlt[key] = counts.alt > 0 ? sums.alt[key] / counts.alt : 0;
    }
    for (const key of Object.keys(sums.real)) {
        stats.meanFeaturesReal[key] = counts.real > 0 ? sums.real[key] / counts.real : 0;
    }

    return stats;
}

/**
 * Get label distribution from training data
 */
function getLabelDistribution(labeledExamples) {
    const dist = {
        REAL: 0,
        LIKELY_REAL: 0,
        LIKELY_ALT: 0,
        ALT: 0
    };

    for (const example of labeledExamples) {
        dist[example.label]++;
    }

    return dist;
}

/**
 * Default model for when no training data exists
 * These are reasonable defaults based on typical alt patterns
 */
function getDefaultModel() {
    return {
        version: '1.0.0',
        trainedAt: new Date().toISOString(),
        trainingExamples: 0,
        isDefault: true,
        weights: {
            badgeAnomalies: { alt: 45, real: 15 },
            inventoryAnomalies: { alt: 35, real: 10 },
            gamePassAnomalies: { alt: 25, real: 8 },
            groupAnomalies: { alt: 30, real: 12 },
            connectionAnomalies: { alt: 20, real: 5 }
        },
        stats: {
            altExamples: 0,
            realExamples: 0,
            meanAreaScoresAlt: {
                badgeAnomalies: 50,
                inventoryAnomalies: 40,
                gamePassAnomalies: 30,
                groupAnomalies: 35,
                connectionAnomalies: 15
            },
            meanAreaScoresReal: {
                badgeAnomalies: 10,
                inventoryAnomalies: 5,
                gamePassAnomalies: 5,
                groupAnomalies: 8,
                connectionAnomalies: 3
            }
        },
        labelDistribution: {}
    };
}

/**
 * Get model info (latest training stats)
 */
function getModelInfo() {
    const model = getOrLoadModel();
    return {
        version: model.version,
        trainedAt: model.trainedAt,
        trainingExamples: model.trainingExamples || 0,
        isDefault: model.isDefault || false,
        labelDistribution: model.labelDistribution
    };
}

module.exports = {
    trainModel,
    loadModel,
    getOrLoadModel,
    getModelInfo,
    ensureModelDir
};
