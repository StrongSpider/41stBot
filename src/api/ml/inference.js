'use strict';

const {
    FEATURE_CATALOG,
    extractFeatures
} = require('./featureExtractor');
const {
    getOrLoadModel,
    normalizeFeatureVector,
    forwardPass
} = require('./trainer');

const ASPECT_LABELS = {
    profile: 'Profile',
    badges: 'Badges',
    inventory: 'Inventory',
    gamePasses: 'Game Passes',
    groups: 'Groups',
    connections: 'Connections'
};

async function predictSuspicion(subject) {
    let bgCheckData = subject;

    if (typeof subject === 'string' || typeof subject === 'number') {
        const bgCheck = await require('../backgroundCheck').getAIBackgroundCheck(subject);
        if (!bgCheck?.success) {
            throw new Error(bgCheck?.error || 'Background check failed');
        }
        bgCheckData = bgCheck;
    }

    const featureBundle = extractFeatures(bgCheckData);
    const model = getOrLoadModel();
    const prediction = calculatePrediction(featureBundle, model);

    return {
        robloxId: bgCheckData.robloxId,
        username: bgCheckData.username,
        ...prediction,
        timestamp: new Date().toISOString()
    };
}

function calculatePrediction(featureBundle, model) {
    if (model?.type === 'neural_network') {
        return calculateNeuralPrediction(featureBundle, model);
    }

    if (model?.type === 'logistic_regression' || (model?.weights && model?.normalization?.min)) {
        return calculateLegacyLogisticPrediction(featureBundle, model);
    }

    return buildUnavailablePrediction();
}

function calculateNeuralPrediction(featureBundle, model) {
    if (!model?.normalization?.features?.length) {
        return {
            ...buildUnavailablePrediction(),
            recommendation: ['Train the suspicious-account model before trusting AI output.']
        };
    }

    const normalizedVector = normalizeFeatureVector(featureBundle.features, model.normalization);
    const probability = forwardPass(model.network, normalizedVector).output;
    const contributors = calculateFeatureContributors(featureBundle, model, normalizedVector, probability);
    const breakdown = buildAspectBreakdown(contributors);
    const rating = probabilityToRating(probability);

    return {
        cumulativeScore: Math.round(probability * 100),
        rating,
        suspicionString: ratingToHumanReadable(rating),
        confidence: calculateConfidence(model, featureBundle.dataCoverage, probability),
        probability,
        contributors: contributors
            .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
            .slice(0, 12),
        breakdown,
        areaScores: breakdown,
        recommendation: buildRecommendations(breakdown, rating),
        summary: buildSummary(breakdown, rating)
    };
}

function calculateFeatureContributors(featureBundle, model, normalizedVector, probability) {
    return model.normalization.features.map((featureKey, index) => {
        const withoutFeature = [...normalizedVector];
        withoutFeature[index] = 0;

        const withoutProbability = forwardPass(model.network, withoutFeature).output;
        const contribution = probability - withoutProbability;
        const rawVal = Number(featureBundle.features[featureKey]) || 0;
        const metadata = FEATURE_CATALOG[featureKey] || {
            aspect: 'profile',
            label: featureKey
        };

        return {
            key: featureKey,
            label: metadata.label,
            aspect: metadata.aspect,
            rawVal,
            contribution: roundNumber(contribution, 6),
            direction: contribution > 0.002 ? 'suspicious' : (contribution < -0.002 ? 'reassuring' : 'neutral'),
            description: describeContribution(featureKey, rawVal, contribution, model)
        };
    });
}

function describeContribution(featureKey, rawVal, contribution, model) {
    const label = FEATURE_CATALOG[featureKey]?.label || featureKey;
    const insight = model.featureInsights?.[featureKey];
    const formattedValue = formatFeatureValue(featureKey, rawVal);

    if (Math.abs(contribution) <= 0.002) {
        return `${label} was close to neutral (${formattedValue}).`;
    }

    const suspiciousDirection = insight?.suspiciousDirection || 'neutral';

    if (contribution > 0) {
        if (suspiciousDirection === 'high') {
            return `${label} is elevated versus officer-labeled legitimate accounts (${formattedValue}).`;
        }
        if (suspiciousDirection === 'low') {
            return `${label} is unusually low versus officer-labeled legitimate accounts (${formattedValue}).`;
        }
        return `${label} pushed the score upward (${formattedValue}).`;
    }

    if (suspiciousDirection === 'high') {
        return `${label} stayed below the suspicious pattern seen in training (${formattedValue}).`;
    }
    if (suspiciousDirection === 'low') {
        return `${label} looks more established than suspicious training examples (${formattedValue}).`;
    }
    return `${label} lowered the suspicion score (${formattedValue}).`;
}

function buildAspectBreakdown(contributors) {
    const breakdown = {};

    for (const [aspect, title] of Object.entries(ASPECT_LABELS)) {
        const aspectContributors = contributors
            .filter(contributor => contributor.aspect === aspect)
            .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

        const suspiciousSignals = aspectContributors
            .filter(contributor => contributor.contribution > 0.002)
            .sort((a, b) => b.contribution - a.contribution)
            .slice(0, 3)
            .map(signal => formatSignal(signal));

        const reassuringSignals = aspectContributors
            .filter(contributor => contributor.contribution < -0.002)
            .sort((a, b) => a.contribution - b.contribution)
            .slice(0, 2)
            .map(signal => formatSignal(signal));

        const netContribution = aspectContributors.reduce((sum, contributor) => sum + contributor.contribution, 0);
        const suspiciousContribution = aspectContributors
            .filter(contributor => contributor.contribution > 0)
            .reduce((sum, contributor) => sum + contributor.contribution, 0);
        const reassuringContribution = Math.abs(aspectContributors
            .filter(contributor => contributor.contribution < 0)
            .reduce((sum, contributor) => sum + contributor.contribution, 0));

        const score = Math.max(0, Math.min(100, Math.round(50 + (netContribution * 250))));

        breakdown[aspect] = {
            title,
            score,
            direction: score >= 60 ? 'suspicious' : (score <= 40 ? 'reassuring' : 'neutral'),
            suspiciousContribution: roundNumber(suspiciousContribution, 4),
            reassuringContribution: roundNumber(reassuringContribution, 4),
            suspiciousSignals,
            reassuringSignals
        };
    }

    return breakdown;
}

function formatSignal(signal) {
    return {
        feature: signal.key,
        label: signal.label,
        value: formatFeatureValue(signal.key, signal.rawVal),
        impact: `${signal.contribution > 0 ? '+' : ''}${Math.round(signal.contribution * 100)} pts`,
        explanation: signal.description
    };
}

function buildRecommendations(breakdown, rating) {
    const aspectRecommendations = {
        badges: 'Review badge timing and flagged badge places.',
        inventory: 'Check whether the inventory looks like a real played account.',
        gamePasses: 'Review purchase history and whether the account has spent Robux normally.',
        groups: 'Inspect group roles for real participation instead of mass base-rank joins.',
        connections: 'Review friends, followers, and following for a believable social footprint.',
        profile: 'Review account age and basic profile history manually.'
    };

    const suspiciousAspects = Object.entries(breakdown)
        .map(([aspect, data]) => ({ aspect, score: data.score }))
        .filter(item => item.score >= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    const recommendations = suspiciousAspects
        .map(item => aspectRecommendations[item.aspect])
        .filter(Boolean);

    if (!recommendations.length && rating >= 3) {
        recommendations.push('Manual officer review is recommended because the overall score is high.');
    }

    if (!recommendations.length) {
        recommendations.push('No single area stands out strongly; review the full profile if needed.');
    }

    return recommendations;
}

function buildSummary(breakdown, rating) {
    const suspiciousAspects = Object.values(breakdown)
        .filter(area => area.score >= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(area => area.title.toLowerCase());

    if (!suspiciousAspects.length) {
        return rating >= 2
            ? 'The score is elevated without one dominant suspicious area.'
            : 'No major suspicious area dominated the score.';
    }

    return `Highest concern came from ${suspiciousAspects.join(' and ')}.`;
}

function probabilityToRating(probability) {
    if (probability >= 0.8) return 4;
    if (probability >= 0.6) return 3;
    if (probability >= 0.4) return 2;
    if (probability >= 0.2) return 1;
    return 0;
}

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

function calculateConfidence(model, dataCoverage, probability) {
    if (model?.isDefault) {
        return 15;
    }

    let confidence = 100;
    const certaintyPenalty = (0.5 - Math.abs(probability - 0.5)) * 100;
    confidence -= certaintyPenalty * 0.45;

    if (dataCoverage) {
        const coverageWeights = {
            profile: 10,
            badges: 20,
            inventory: 15,
            gamePasses: 15,
            groups: 15,
            connections: 10
        };

        for (const [key, penalty] of Object.entries(coverageWeights)) {
            if (!dataCoverage[key]) {
                confidence -= penalty;
            }
        }
    }

    if (model.trainingExamples < 50) {
        confidence -= 25;
    } else if (model.trainingExamples < 150) {
        confidence -= 12;
    }

    return Math.max(10, Math.round(confidence));
}

function buildUnavailablePrediction() {
    const breakdown = Object.fromEntries(
        Object.entries(ASPECT_LABELS).map(([aspect, title]) => [
            aspect,
            {
                title,
                score: 50,
                direction: 'neutral',
                suspiciousContribution: 0,
                reassuringContribution: 0,
                suspiciousSignals: [],
                reassuringSignals: []
            }
        ])
    );

    return {
        cumulativeScore: 50,
        rating: 2,
        suspicionString: 'Model Unavailable',
        confidence: 10,
        probability: 0.5,
        contributors: [],
        breakdown,
        areaScores: breakdown,
        recommendation: ['Train the suspicious-account model before using AI scores.'],
        summary: 'No trained model is available yet.'
    };
}

async function predictBatch(subjects) {
    const predictions = [];

    for (const subject of subjects) {
        try {
            predictions.push(await predictSuspicion(subject));
        } catch (error) {
            predictions.push({
                robloxId: typeof subject === 'object' ? subject?.robloxId : subject,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    return predictions;
}

function formatFeatureValue(featureKey, value) {
    const numeric = Number(value) || 0;

    if (featureKey === 'accountAgeDays') {
        return `${numeric.toLocaleString()} days`;
    }

    if (featureKey.endsWith('Ratio')) {
        return `${Math.round(numeric * 100)}%`;
    }

    if (featureKey.includes('Spent')) {
        return `${Math.round(numeric).toLocaleString()} R$`;
    }

    if (featureKey.includes('Hours')) {
        return `${roundNumber(numeric, 2)}h`;
    }

    return roundNumber(numeric, 2).toLocaleString();
}

function roundNumber(value, digits) {
    if (!Number.isFinite(value)) {
        return value;
    }
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

function calculateLegacyLogisticPrediction(featureBundle, model) {
    const rawFeatures = featureBundle.features;
    const weights = model.weights || {};
    const normalization = model.normalization || {};
    const features = normalization.features || [];

    let z = weights.__BIAS__ || 0;
    const contributors = [];

    features.forEach((featureKey, index) => {
        const rawVal = Number(rawFeatures[featureKey]) || 0;
        const min = normalization.min?.[index] ?? 0;
        const max = normalization.max?.[index] ?? 1;
        const range = max - min;
        const normalizedValue = range === 0 ? 0 : (rawVal - min) / range;
        const contribution = normalizedValue * (weights[featureKey] || 0);
        z += contribution;

        if (Math.abs(contribution) > 0.01) {
            contributors.push({
                key: featureKey,
                label: FEATURE_CATALOG[featureKey]?.label || featureKey,
                aspect: FEATURE_CATALOG[featureKey]?.aspect || 'profile',
                rawVal,
                contribution,
                direction: contribution > 0 ? 'suspicious' : 'reassuring',
                description: `${FEATURE_CATALOG[featureKey]?.label || featureKey} shifted the legacy model score.`
            });
        }
    });

    const probability = 1 / (1 + Math.exp(-z));
    const breakdown = buildAspectBreakdown(contributors);
    const rating = probabilityToRating(probability);

    return {
        cumulativeScore: Math.round(probability * 100),
        rating,
        suspicionString: ratingToHumanReadable(rating),
        confidence: calculateConfidence(model, featureBundle.dataCoverage, probability),
        probability,
        contributors: contributors
            .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
            .slice(0, 10),
        breakdown,
        areaScores: breakdown,
        recommendation: buildRecommendations(breakdown, rating),
        summary: buildSummary(breakdown, rating)
    };
}

module.exports = {
    predictSuspicion,
    predictBatch,
    calculatePrediction,
    probabilityToRating,
    ratingToHumanReadable,
    calculateConfidence,
    buildAspectBreakdown
};
