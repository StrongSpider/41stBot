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
 * @returns {Promise<Object>} Trained model
 */
async function trainModel() {
    ensureModelDir();

    console.log('Fetching officer labels from database...');
    
    // Fetch all labeled data
    const res = await pool.query(
        `SELECT target_roblox_id, label FROM ${OFFICER_LABELS_TABLE} ORDER BY created_at DESC LIMIT 500`
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
            const features = await extractFeatures(Number(row.target_roblox_id));
            labeledExamples.push({
                targetRobloxId: Number(row.target_roblox_id),
                label: row.label,
                features
            });
            successCount++;
            
            // Log progress every 10 accounts
            if (successCount % 10 === 0) {
                console.log(`  Processed ${successCount} accounts...`);
            }
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

    // Calculate feature weights based on label distribution
    const weights = calculateWeights(labeledExamples);
    const stats = calculateStats(labeledExamples);

    const model = {
        version: '1.0.0',
        trainedAt: new Date().toISOString(),
        trainingExamples: labeledExamples.length,
        weights,
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
 * Calculate feature weights based on labeled data
 * Higher weights for features that distinguish alts from real accounts
 */
function calculateWeights(labeledExamples) {
    const weights = {
        badgeAnomalies: { alt: 0, real: 0 },
        inventoryAnomalies: { alt: 0, real: 0 },
        gamePassAnomalies: { alt: 0, real: 0 },
        groupAnomalies: { alt: 0, real: 0 },
        xTrackerEvidence: { alt: 0, real: 0 },
        connectionAnomalies: { alt: 0, real: 0 }
    };

    // Normalize labels
    const labelMapping = {
        'ALT': 'alt',
        'LIKELY_ALT': 'alt',
        'REAL': 'real',
        'LIKELY_REAL': 'real'
    };

    const counts = { alt: 0, real: 0 };

    // Aggregate feature scores by label type
    for (const example of labeledExamples) {
        const normalized = labelMapping[example.label] || 'real';
        counts[normalized]++;

        const features = example.features.features;
        for (const [area, data] of Object.entries(features)) {
            if (!weights[area]) continue;

            const score = data.score || 0;
            if (normalized === 'alt') {
                weights[area].alt += score;
            } else {
                weights[area].real += score;
            }
        }
    }

    // Calculate average weights per area
    for (const area of Object.keys(weights)) {
        if (counts.alt > 0) weights[area].alt /= counts.alt;
        if (counts.real > 0) weights[area].real /= counts.real;
    }

    return weights;
}

/**
 * Calculate statistics about feature distributions
 */
function calculateStats(labeledExamples) {
    const stats = {
        altExamples: 0,
        realExamples: 0,
        meanAreaScoresAlt: {},
        meanAreaScoresReal: {},
        areaFlags: {}
    };

    const labelMapping = {
        'ALT': 'alt',
        'LIKELY_ALT': 'alt',
        'REAL': 'real',
        'LIKELY_REAL': 'real'
    };

    const areaSums = {
        alt: { badgeAnomalies: 0, inventoryAnomalies: 0, gamePassAnomalies: 0, groupAnomalies: 0, xTrackerEvidence: 0, connectionAnomalies: 0 },
        real: { badgeAnomalies: 0, inventoryAnomalies: 0, gamePassAnomalies: 0, groupAnomalies: 0, xTrackerEvidence: 0, connectionAnomalies: 0 }
    };

    const areaCounts = {
        alt: { badgeAnomalies: 0, inventoryAnomalies: 0, gamePassAnomalies: 0, groupAnomalies: 0, xTrackerEvidence: 0, connectionAnomalies: 0 },
        real: { badgeAnomalies: 0, inventoryAnomalies: 0, gamePassAnomalies: 0, groupAnomalies: 0, xTrackerEvidence: 0, connectionAnomalies: 0 }
    };

    for (const example of labeledExamples) {
        const normalized = labelMapping[example.label] || 'real';
        stats[`${normalized}Examples`]++;

        const features = example.features.features;
        for (const [area, data] of Object.entries(features)) {
            if (!areaSums[normalized][area]) continue;

            areaSums[normalized][area] += data.score || 0;
            areaCounts[normalized][area]++;
        }
    }

    // Calculate averages
    for (const area of Object.keys(areaSums.alt)) {
        stats.meanAreaScoresAlt[area] = areaCounts.alt[area] > 0 ? areaSums.alt[area] / areaCounts.alt[area] : 0;
        stats.meanAreaScoresReal[area] = areaCounts.real[area] > 0 ? areaSums.real[area] / areaCounts.real[area] : 0;
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
            xTrackerEvidence: { alt: 60, real: 5 },
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
                xTrackerEvidence: 50,
                connectionAnomalies: 15
            },
            meanAreaScoresReal: {
                badgeAnomalies: 10,
                inventoryAnomalies: 5,
                gamePassAnomalies: 5,
                groupAnomalies: 8,
                xTrackerEvidence: 0,
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
