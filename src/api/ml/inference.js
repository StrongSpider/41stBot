'use strict';

const { extractFeatures } = require('./featureExtractor');
const { getOrLoadModel } = require('./trainer');

/**
 * Predict suspicion for an account using background check data
 * @param {number} robloxId
 * @returns {Promise<Object>} Prediction with area scores and cumulative rating
 */
async function predictSuspicion(robloxId) {
    const features = await extractFeatures(robloxId);
    const model = getOrLoadModel();

    const prediction = calculatePrediction(features, model);

    return {
        robloxId,
        username: features.username,
        prediction,
        timestamp: new Date().toISOString()
    };
}

/**
 * Calculate suspicion prediction from features and model
 */
function calculatePrediction(features, model) {
    const featureData = features.features;
    const areaScores = {};
    let totalWeightedScore = 0;
    let totalWeight = 0;

    // Calculate weighted score for each area
    const areas = [
        'badgeAnomalies',
        'inventoryAnomalies',
        'gamePassAnomalies',
        'groupAnomalies',
        'xTrackerEvidence',
        'connectionAnomalies'
    ];

    for (const area of areas) {
        if (!featureData[area]) continue;

        const rawScore = featureData[area].score || 0;
        const altWeight = model.weights[area]?.alt || 0;
        const realWeight = model.weights[area]?.real || 0;

        // Calculate how much this area suggests "alt" (difference between alt and real weights)
        // Higher alt weight vs real weight = more suspicion
        const suspicionMultiplier = Math.max(0, altWeight - realWeight);
        const weightedScore = rawScore * (suspicionMultiplier / 10 + 1);

        areaScores[area] = {
            rawScore: Math.round(rawScore),
            altWeight: Math.round(altWeight * 10) / 10,
            realWeight: Math.round(realWeight * 10) / 10,
            suspicionMultiplier: Math.round(suspicionMultiplier * 100) / 100,
            weightedScore: Math.round(weightedScore),
            details: featureData[area]
        };

        totalWeightedScore += weightedScore;
        totalWeight += (suspicionMultiplier + 1);
    }

    // Normalize cumulative score to 0-100
    const cumulativeScore = totalWeight > 0 ? Math.min(100, (totalWeightedScore / totalWeight) * 2) : 0;

    // Convert to suspicion rating
    const rating = scoreToRating(cumulativeScore);

    return {
        cumulativeScore: Math.round(cumulativeScore),
        rating,
        suspicionString: ratingToHumanReadable(rating),
        confidence: calculateConfidence(model, areaScores),
        areaScores,
        recommendation: getRecommendation(rating, areaScores)
    };
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
        0: 'LEGITIMATE',
        1: 'LIKELY_LEGITIMATE',
        2: 'SUSPICIOUS',
        3: 'LIKELY_ALT',
        4: 'ALT'
    };
    return mapping[rating] || 'UNKNOWN';
}

/**
 * Calculate confidence in prediction (0-100)
 * Higher confidence when: more training data, consistency across areas
 */
function calculateConfidence(model, areaScores) {
    const trainingExamples = model.trainingExamples || 0;

    // Base confidence from training data: 0-50 based on how much data was used
    const baseConfidence = Math.min(50, (trainingExamples / 100) * 50);

    // Consistency bonus: areas agreeing raises confidence
    const areaValues = Object.values(areaScores).map(a => a.weightedScore);
    const variance = calculateVariance(areaValues);
    const consistency = Math.max(0, 100 - variance);
    const consistencyBonus = consistency * 0.5;

    // Non-default model bonus
    const modelBonus = model.isDefault ? 0 : 20;

    return Math.min(100, Math.round(baseConfidence + consistencyBonus + modelBonus));
}

/**
 * Calculate variance of array of numbers
 */
function calculateVariance(numbers) {
    if (numbers.length === 0) return 0;
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / numbers.length;
    return Math.sqrt(variance); // Return standard deviation
}

/**
 * Get recommendation based on rating and specific flags
 */
function getRecommendation(rating, areaScores) {
    const recommendations = [];

    // Identify most suspicious areas
    const sortedAreas = Object.entries(areaScores)
        .filter(([, data]) => data.details.flagged)
        .sort((a, b) => b[1].weightedScore - a[1].weightedScore);

    // Recommend actions based on top suspicious areas
    for (const [areaName, areaData] of sortedAreas.slice(0, 3)) {
        if (areaData.details.flags && areaData.details.flags.length > 0) {
            const topFlag = areaData.details.flags[0];
            recommendations.push(`${topFlag}`);
        }
    }

    // Action recommendations based on rating
    if (rating >= 4) {
        recommendations.push('ACTION: Recommend immediate manual review');
        recommendations.push('ACTION: Consider adding to verification list');
    } else if (rating === 3) {
        recommendations.push('ACTION: Schedule for officer review');
        recommendations.push('ACTION: Monitor for further suspicious activity');
    } else if (rating === 2) {
        recommendations.push('INFO: Monitor account for suspicious patterns');
    }

    return recommendations.length > 0 ? recommendations : ['No significant concerns'];
}

/**
 * Batch predict suspicion for multiple accounts
 */
async function predictBatch(robloxIds) {
    const predictions = [];
    for (const id of robloxIds) {
        try {
            const result = await predictSuspicion(id);
            predictions.push(result);
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
