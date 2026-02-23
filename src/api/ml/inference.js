'use strict';

const { extractFeatures } = require('./featureExtractor');
const { getOrLoadModel } = require('./trainer');

/**
 * Predict suspicion for an account using background check data
 * @param {Object} bgCheckData
 * @returns {Promise<Object>} Prediction with area scores and cumulative rating
 */
async function predictSuspicion(bgCheckData) {
    const features = extractFeatures(bgCheckData);
    const model = getOrLoadModel();

    const prediction = calculatePrediction(features, model);

    return {
        robloxId: bgCheckData.robloxId,
        username: bgCheckData.username,
        ...prediction,
        timestamp: new Date().toISOString()
    };
}

/**
 * Calculate suspicion prediction from features and model
 */
function calculatePrediction(features, model) {
    if (model.type === 'logistic_regression' || model.version >= '2.0.0') {
        return calculateLogisticPrediction(features, model);
    }

    // Fallback for old models (should not happen if we retrained)
    return {
        cumulativeScore: 0,
        rating: 0,
        suspicionString: 'UNKNOWN',
        confidence: 0,
        areaScores: {},
        recommendation: ['Model version mismatch - please retrain']
    };
}

/**
 * Prediction using Logistic Regression Model
 */
function calculateLogisticPrediction(features, model) {
    const rawFeatures = features.features; // Flat object
    const weights = model.weights;
    const norm = model.normalization;

    let z = weights['__BIAS__'] || 0;
    const contributors = [];

    // 1. Normalize and dot product
    norm.features.forEach((key, index) => {
        const rawVal = Number(rawFeatures[key]) || 0;
        const min = norm.min[index];
        const max = norm.max[index];
        const weight = weights[key] || 0;

        const range = max - min;
        const normalizedVal = range === 0 ? 0 : (rawVal - min) / range;

        const contribution = normalizedVal * weight;
        z += contribution;

        if (Math.abs(contribution) > 0.01) {
            contributors.push({ key, contribution, weight, rawVal });
        }
    });

    // 2. Sigmoid -> Probability
    const probability = 1 / (1 + Math.exp(-z));

    // 3. Map Probability to Rating (0-4)
    // 0.0-0.2: Legit (0)
    // 0.2-0.4: Likely Legit (1)
    // 0.4-0.6: Suspicious (2)
    // 0.6-0.8: Likely Alt (3)
    // 0.8-1.0: Alt (4)
    let rating = 0;
    if (probability > 0.8) rating = 4;
    else if (probability > 0.6) rating = 3;
    else if (probability > 0.4) rating = 2;
    else if (probability > 0.2) rating = 1;

    // 4. Recommendations
    const recommendations = getLogisticRecommendations(contributors, rating);

    return {
        cumulativeScore: Math.round(probability * 100),
        rating,
        suspicionString: ratingToHumanReadable(rating),
        confidence: calculateConfidence(model, features.dataCoverage, probability),
        probability: probability,
        contributors: contributors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 10),
        recommendation: recommendations
    };
}

function getLogisticRecommendations(contributors, rating) {
    const recs = [];

    const recMap = {
        badgeAvgTimeGap: "Investigate badge timeline for anomalies (large gaps)",
        badgeClusterCount: "Investigate badge timeline for badge-running behavior",
        suspiciousBadgePlaceCount: "Review badge history for anomalies",
        suspiciousBadgeCount: "Review badge history for anomalies", // handle both naming conventions if uncertain
        accountAge: "New account - verify meets minimum age requirements",
        friendCount: "Check social connections (low count)",
        groupCount: "Review group participation history",
        inventoryCount: "Inspect inventory for normal player assets",
        gamePassCount: "Check purchase history (low count)",
        badgeCount: "Investigate badge history (low count)",
        badgeTimeVariance: "Investigate badge timeline for anomalies (large variance)",
    };

    // Suggest b1sed on top positive contributors (things making it look like an alt)
    const topSuspicious = contributors
        .filter(c => c.contribution > 0)
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3);

    topSuspicious.forEach(c => {
        const action = recMap[c.key];
        if (action && !recs.includes(action)) {
            recs.push(action);
        }
    });

    if (rating >= 3 && recs.length === 0) {
        recs.push('Manual review recommended due to high score');
    }

    // Ensure we don't have too many, top 3 is enough
    if (recs.length > 3) {
        recs.length = 3;
    }

    if (recs.length === 0) recs.push('No specific investigations recommended');
    return recs;
}

/**
 * Convert cumulative score to suspicion rating (0-4)
 * 0 = LEGITIMATE
 * 1 = LIKELY_LEGITIMATE  
 * 2 = SUSPICIOUS
 * 3 = LIKELY_ALT
 * 4 = ALT
 */
function scoreToRating(score) {
    if (score < 20) return 0;
    if (score < 40) return 1;
    if (score < 60) return 2;
    if (score < 80) return 3;
    return 4;
}

/**
 * Convert rating to human-readable suspicion string
 */
function ratingToHumanReadable(rating) {
    const mapping = {
        0: 'Legitimate Account',
        1: 'Likely Legitimate',
        2: 'Suspicious Activity Detected',
        3: 'Likely Alternative Account',
        4: 'Alternative Account'
    };
    return mapping[rating] || 'Unknown';
}

/**
 * Calculate confidence in prediction (0-100)
 * 
 * Factors:
 * 1. Model Certainty: Predictions near 0.5 are less certain.
 * 2. Data Coverage: Missing data sections reduce confidence.
 * 3. Model Version: Default models (if they existed) would be lower.
 */
function calculateConfidence(model, dataCoverage, probability) {
    let confidence = 100;

    // 1. Model Certainty (Distance from 0.5)
    // If probability is 0.5, we subtract 50 (min 50% from this factor)
    // If probability is 1.0 or 0.0, we subtract 0.
    const certaintyPenalty = (0.5 - Math.abs(probability - 0.5)) * 100;
    confidence -= (certaintyPenalty * 0.4); // This factor accounts for 40% of confidence

    // 2. Data Coverage
    if (dataCoverage) {
        let missingCount = 0;
        const weights = {
            badges: 15,
            inventory: 10,
            groups: 10,
            gamePasses: 5,
            connections: 5
        };

        for (const [key, weight] of Object.entries(weights)) {
            if (!dataCoverage[key]) {
                confidence -= weight;
            }
        }
    }

    // 3. Training Size (Small data sets are less reliable)
    if (model.trainingExamples < 100) {
        confidence -= 20;
    } else if (model.trainingExamples < 300) {
        confidence -= 10;
    }

    return Math.max(10, Math.round(confidence));
}

/**
 * Get recommendation based on rating and specific flags
 */
function getRecommendation(rating, areaScores) {
    return []; // Replaced by getLogisticRecommendations
}

/**
 * Batch predict suspicion for multiple accounts
 */
async function predictBatch(robloxIds) {
    const predictions = [];
    for (const id of robloxIds) {
        try {
            // NOTE: predictBatch needs full data, so we can't just pass ID anymore unless we fetch it here.
            // For now, assuming predictBatch is not used or will be updated later.
            // Disabling to prevent error since predictSuspicion now expects data.
            throw new Error("predictBatch not fully implemented for new data flow");
            // const result = await predictSuspicion(id);
            // predictions.push(result);
        } catch (err) {
            console.error(`Error predicting suspicion for ${id}:`, err);
            predictions.push({
                robloxId: id,
                error: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    return predictions;
}

module.exports = {
    predictSuspicion,
    predictBatch,
    calculatePrediction,
    scoreToRating,
    ratingToHumanReadable,
    calculateConfidence,
    getRecommendation
};
