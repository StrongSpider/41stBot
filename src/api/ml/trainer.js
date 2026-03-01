'use strict';

const fs = require('fs');
const path = require('path');
const database = require('../database');
const {
    extractFeatures,
    extractFeaturesFromSnapshot
} = require('./featureExtractor');

const MODEL_DIR = path.join(__dirname, '..', '..', 'models');
const MODEL_FILE = path.join(MODEL_DIR, 'suspicious_account_model.json');

const LABEL_SCORE_MAP = {
    REAL: 0.0,
    LIKELY_REAL: 0.33,
    LIKELY_ALT: 0.67,
    ALT: 1.0
};

function getAIBackgroundCheck(usernameOrId) {
    return require('../backgroundCheck').getAIBackgroundCheck(usernameOrId);
}

function ensureModelDir() {
    if (!fs.existsSync(MODEL_DIR)) {
        fs.mkdirSync(MODEL_DIR, { recursive: true });
    }
}

async function trainModel(options = {}) {
    const slow = options.slow === true;
    const delayMs = options.delay || 1000;
    const limit = options.limit || null;

    ensureModelDir();

    console.log('Fetching officer labels from database...');
    const allLabels = await database.getOfficerLabels();
    if (!allLabels.length) {
        console.warn('No officer labels found. Using default model.');
        return getDefaultModel();
    }

    const aggregatedAccounts = aggregateOfficerLabels(allLabels)
        .slice(0, limit || allLabels.length);

    console.log(`Found ${allLabels.length} raw labels across ${aggregatedAccounts.length} unique accounts.`);
    console.log('Preparing training examples from saved snapshots and fallback background checks...');

    const trainingExamples = [];
    let snapshotCount = 0;
    let liveFallbackCount = 0;
    let failureCount = 0;

    for (let index = 0; index < aggregatedAccounts.length; index++) {
        const account = aggregatedAccounts[index];

        try {
            if (slow && liveFallbackCount > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            const example = await buildTrainingExample(account);
            if (!example) {
                continue;
            }

            trainingExamples.push(example);
            if (example.source === 'snapshot') snapshotCount += 1;
            if (example.source === 'live_fallback') liveFallbackCount += 1;

            console.log(
                `  [${trainingExamples.length}/${aggregatedAccounts.length}] ` +
                `${example.robloxId} ${example.username} (${example.consensusLabel}, ${example.source})`
            );
        } catch (error) {
            failureCount += 1;
            console.warn(`  Failed to prepare ${account.robloxId}: ${error.message}`);
        }
    }

    if (!trainingExamples.length) {
        console.warn('No usable training examples were produced. Using default model.');
        return getDefaultModel();
    }

    const network = trainNeuralNetwork(trainingExamples, options.training || {});
    const stats = calculateStats(trainingExamples);
    const featureInsights = buildFeatureInsights(trainingExamples, network.normalization.features);
    const labelDistribution = getLabelDistribution(allLabels);
    const evaluation = evaluateModel(network, trainingExamples);

    const model = {
        version: '3.0.0',
        type: 'neural_network',
        trainedAt: new Date().toISOString(),
        trainingExamples: trainingExamples.length,
        rawLabelCount: allLabels.length,
        sourceCounts: {
            snapshot: snapshotCount,
            liveFallback: liveFallbackCount,
            failed: failureCount
        },
        architecture: {
            inputSize: network.normalization.features.length,
            hiddenSize: network.hiddenSize,
            activation: 'relu',
            output: 'sigmoid'
        },
        normalization: network.normalization,
        network: network.network,
        stats,
        evaluation,
        featureInsights,
        labelDistribution
    };

    fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2));
    console.log(`Saved neural suspicious-account model to ${MODEL_FILE}`);

    return model;
}

function loadModel() {
    if (!fs.existsSync(MODEL_FILE)) {
        return null;
    }

    const raw = fs.readFileSync(MODEL_FILE, 'utf8');
    return JSON.parse(raw);
}

function getOrLoadModel() {
    const model = loadModel();
    if (model) {
        return model;
    }

    console.warn('No trained suspicious-account model found. Falling back to neutral default.');
    return getDefaultModel();
}

function aggregateOfficerLabels(labels) {
    const grouped = new Map();

    for (const labelRow of labels) {
        const robloxId = Number(labelRow.targetRobloxId);
        if (!Number.isFinite(robloxId)) {
            continue;
        }

        let entry = grouped.get(robloxId);
        if (!entry) {
            entry = {
                robloxId,
                labels: [],
                latestCreatedAt: 0
            };
            grouped.set(robloxId, entry);
        }

        const createdAt = labelRow.createdAt ? new Date(labelRow.createdAt).getTime() : 0;
        entry.labels.push({
            label: labelRow.label,
            createdAt,
            featuresSnapshot: labelRow.featuresSnapshot || null
        });
        entry.latestCreatedAt = Math.max(entry.latestCreatedAt, createdAt);
    }

    return Array.from(grouped.values())
        .map(entry => {
            const votes = entry.labels
                .map(item => LABEL_SCORE_MAP[item.label])
                .filter(Number.isFinite);

            if (!votes.length) {
                return null;
            }

            const targetScore = votes.reduce((sum, value) => sum + value, 0) / votes.length;
            const latestSnapshot = entry.labels
                .filter(item => item.featuresSnapshot)
                .sort((a, b) => b.createdAt - a.createdAt)[0]?.featuresSnapshot || null;

            return {
                robloxId: entry.robloxId,
                targetScore,
                consensusLabel: scoreToConsensusLabel(targetScore),
                voteCount: votes.length,
                latestCreatedAt: entry.latestCreatedAt,
                labelCounts: entry.labels.reduce((counts, item) => {
                    counts[item.label] = (counts[item.label] || 0) + 1;
                    return counts;
                }, { REAL: 0, LIKELY_REAL: 0, LIKELY_ALT: 0, ALT: 0 }),
                snapshot: latestSnapshot
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
}

async function buildTrainingExample(account) {
    let featureBundle = null;
    let username = `User ${account.robloxId}`;
    let source = 'snapshot';

    if (account.snapshot) {
        try {
            featureBundle = extractFeaturesFromSnapshot(account.snapshot);
            username = featureBundle.username || username;
        } catch (error) {
            console.warn(`  Snapshot load failed for ${account.robloxId}, falling back to live data: ${error.message}`);
        }
    }

    if (!featureBundle) {
        const bgCheck = await getAIBackgroundCheck(account.robloxId);
        if (!bgCheck?.success) {
            throw new Error(bgCheck?.error || 'Background check failed');
        }

        featureBundle = extractFeatures(bgCheck);
        username = featureBundle.username || username;
        source = 'live_fallback';
    }

    return {
        robloxId: account.robloxId,
        username,
        source,
        targetScore: account.targetScore,
        consensusLabel: account.consensusLabel,
        voteCount: account.voteCount,
        labelCounts: account.labelCounts,
        features: featureBundle
    };
}

function trainNeuralNetwork(examples, options = {}) {
    const prepared = prepareDataset(examples);
    const { normalizedMatrix, targets, normalization } = prepared;
    const sampleCount = normalizedMatrix.length;
    const inputSize = normalization.features.length;

    const hiddenSize = clampInteger(
        options.hiddenSize || Math.ceil(inputSize / 2),
        6,
        18
    );
    const iterations = options.iterations || 1800;
    const learningRate = options.learningRate || 0.04;
    const regularization = options.regularization || 0.0005;
    const random = createPrng(options.seed || 1337);

    const network = initializeNetwork(inputSize, hiddenSize, random);
    const classWeights = getClassWeights(targets);
    let lastLoss = null;

    for (let epoch = 0; epoch < iterations; epoch++) {
        const gradients = {
            inputHidden: makeMatrix(hiddenSize, inputSize, 0),
            hiddenBias: new Array(hiddenSize).fill(0),
            hiddenOutput: new Array(hiddenSize).fill(0),
            outputBias: 0
        };

        let loss = 0;

        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
            const x = normalizedMatrix[sampleIndex];
            const y = targets[sampleIndex];
            const sampleWeight = y >= 0.5 ? classWeights.suspicious : classWeights.legitimate;
            const forward = forwardPass(network, x);
            const prediction = clampProbability(forward.output);

            loss += sampleWeight * binaryCrossEntropy(y, prediction);

            const outputDelta = sampleWeight * (prediction - y);

            for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex++) {
                gradients.hiddenOutput[hiddenIndex] += outputDelta * forward.hiddenActivations[hiddenIndex];
            }
            gradients.outputBias += outputDelta;

            for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex++) {
                const hiddenDelta = forward.hiddenPreActivations[hiddenIndex] > 0
                    ? network.hiddenOutputWeights[hiddenIndex] * outputDelta
                    : 0;

                gradients.hiddenBias[hiddenIndex] += hiddenDelta;

                for (let inputIndex = 0; inputIndex < inputSize; inputIndex++) {
                    gradients.inputHidden[hiddenIndex][inputIndex] += hiddenDelta * x[inputIndex];
                }
            }
        }

        for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex++) {
            gradients.hiddenOutput[hiddenIndex] = (gradients.hiddenOutput[hiddenIndex] / sampleCount) +
                (regularization * network.hiddenOutputWeights[hiddenIndex]);

            network.hiddenOutputWeights[hiddenIndex] -= learningRate * gradients.hiddenOutput[hiddenIndex];
            network.hiddenBiases[hiddenIndex] -= learningRate * (gradients.hiddenBias[hiddenIndex] / sampleCount);

            for (let inputIndex = 0; inputIndex < inputSize; inputIndex++) {
                gradients.inputHidden[hiddenIndex][inputIndex] = (gradients.inputHidden[hiddenIndex][inputIndex] / sampleCount) +
                    (regularization * network.inputHiddenWeights[hiddenIndex][inputIndex]);

                network.inputHiddenWeights[hiddenIndex][inputIndex] -= learningRate * gradients.inputHidden[hiddenIndex][inputIndex];
            }
        }

        network.outputBias -= learningRate * (gradients.outputBias / sampleCount);
        lastLoss = loss / sampleCount;
    }

    return {
        hiddenSize,
        normalization,
        finalLoss: lastLoss,
        network
    };
}

function prepareDataset(examples) {
    const featureKeys = new Set();
    examples.forEach(example => {
        Object.keys(example.features.features).forEach(key => featureKeys.add(key));
    });

    const features = Array.from(featureKeys).sort();
    const rawMatrix = examples.map(example => features.map(key => toFinite(example.features.features[key])));
    const targets = examples.map(example => clampProbability(example.targetScore));

    const mean = features.map((_, index) => {
        const sum = rawMatrix.reduce((acc, row) => acc + row[index], 0);
        return sum / Math.max(rawMatrix.length, 1);
    });

    const std = features.map((_, index) => {
        const variance = rawMatrix.reduce((acc, row) => acc + Math.pow(row[index] - mean[index], 2), 0) / Math.max(rawMatrix.length, 1);
        const deviation = Math.sqrt(variance);
        return deviation < 1e-6 ? 1 : deviation;
    });

    const normalizedMatrix = rawMatrix.map(row =>
        row.map((value, index) => (value - mean[index]) / std[index])
    );

    return {
        normalizedMatrix,
        targets,
        normalization: {
            features,
            mean,
            std
        }
    };
}

function forwardPass(network, inputVector) {
    const hiddenPreActivations = network.inputHiddenWeights.map((weights, hiddenIndex) => {
        let value = network.hiddenBiases[hiddenIndex];
        for (let inputIndex = 0; inputIndex < inputVector.length; inputIndex++) {
            value += weights[inputIndex] * inputVector[inputIndex];
        }
        return value;
    });

    const hiddenActivations = hiddenPreActivations.map(value => Math.max(0, value));
    let outputLogit = network.outputBias;
    for (let hiddenIndex = 0; hiddenIndex < hiddenActivations.length; hiddenIndex++) {
        outputLogit += hiddenActivations[hiddenIndex] * network.hiddenOutputWeights[hiddenIndex];
    }

    return {
        hiddenPreActivations,
        hiddenActivations,
        outputLogit,
        output: sigmoid(outputLogit)
    };
}

function initializeNetwork(inputSize, hiddenSize, random) {
    const inputHiddenWeights = makeMatrix(hiddenSize, inputSize, 0);
    const hiddenBiases = new Array(hiddenSize).fill(0);
    const hiddenOutputWeights = new Array(hiddenSize).fill(0);
    const outputBias = 0;

    const inputScale = Math.sqrt(6 / Math.max(inputSize + hiddenSize, 1));
    const outputScale = Math.sqrt(6 / Math.max(hiddenSize + 1, 1));

    for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex++) {
        hiddenOutputWeights[hiddenIndex] = randomBetween(random, -outputScale, outputScale);
        for (let inputIndex = 0; inputIndex < inputSize; inputIndex++) {
            inputHiddenWeights[hiddenIndex][inputIndex] = randomBetween(random, -inputScale, inputScale);
        }
    }

    return {
        inputHiddenWeights,
        hiddenBiases,
        hiddenOutputWeights,
        outputBias
    };
}

function evaluateModel(modelInfo, examples) {
    const predictions = examples.map(example => {
        const normalized = normalizeFeatureVector(example.features.features, modelInfo.normalization);
        const probability = clampProbability(forwardPass(modelInfo.network, normalized).output);
        return {
            actual: example.targetScore,
            predicted: probability
        };
    });

    const mae = predictions.reduce((sum, item) => sum + Math.abs(item.actual - item.predicted), 0) / Math.max(predictions.length, 1);
    const bucketAccuracy = predictions.reduce((sum, item) => {
        return sum + (scoreToBucket(item.actual) === scoreToBucket(item.predicted) ? 1 : 0);
    }, 0) / Math.max(predictions.length, 1);

    return {
        finalLoss: modelInfo.finalLoss,
        meanAbsoluteError: roundNumber(mae, 4),
        bucketAccuracy: roundNumber(bucketAccuracy, 4)
    };
}

function calculateStats(examples) {
    const stats = {
        suspiciousExamples: 0,
        legitimateExamples: 0,
        averageVoteCount: 0,
        meanFeaturesSuspicious: {},
        meanFeaturesLegitimate: {}
    };

    const suspiciousSums = {};
    const legitimateSums = {};
    let totalVoteCount = 0;

    for (const example of examples) {
        const bucket = example.targetScore >= 0.5 ? 'suspicious' : 'legitimate';
        stats[`${bucket}Examples`] += 1;
        totalVoteCount += example.voteCount;

        for (const [feature, value] of Object.entries(example.features.features)) {
            const target = bucket === 'suspicious' ? suspiciousSums : legitimateSums;
            target[feature] = (target[feature] || 0) + toFinite(value);
        }
    }

    stats.averageVoteCount = roundNumber(totalVoteCount / Math.max(examples.length, 1), 2);

    for (const [feature, value] of Object.entries(suspiciousSums)) {
        stats.meanFeaturesSuspicious[feature] = roundNumber(value / Math.max(stats.suspiciousExamples, 1), 4);
    }

    for (const [feature, value] of Object.entries(legitimateSums)) {
        stats.meanFeaturesLegitimate[feature] = roundNumber(value / Math.max(stats.legitimateExamples, 1), 4);
    }

    return stats;
}

function buildFeatureInsights(examples, features) {
    const suspiciousExamples = examples.filter(example => example.targetScore >= 0.5);
    const legitimateExamples = examples.filter(example => example.targetScore < 0.5);

    return features.reduce((insights, feature) => {
        const suspiciousMean = averageFeatureValue(suspiciousExamples, feature);
        const legitimateMean = averageFeatureValue(legitimateExamples, feature);
        const delta = suspiciousMean - legitimateMean;

        insights[feature] = {
            suspiciousMean: roundNumber(suspiciousMean, 4),
            legitimateMean: roundNumber(legitimateMean, 4),
            suspiciousDirection: delta > 0.001 ? 'high' : (delta < -0.001 ? 'low' : 'neutral')
        };

        return insights;
    }, {});
}

function getLabelDistribution(labels) {
    const distribution = {
        REAL: 0,
        LIKELY_REAL: 0,
        LIKELY_ALT: 0,
        ALT: 0
    };

    for (const label of labels) {
        if (distribution[label.label] !== undefined) {
            distribution[label.label] += 1;
        }
    }

    return distribution;
}

function getDefaultModel() {
    return {
        version: '3.0.0',
        type: 'neural_network',
        trainedAt: new Date().toISOString(),
        trainingExamples: 0,
        rawLabelCount: 0,
        isDefault: true,
        sourceCounts: {
            snapshot: 0,
            liveFallback: 0,
            failed: 0
        },
        architecture: {
            inputSize: 0,
            hiddenSize: 0,
            activation: 'relu',
            output: 'sigmoid'
        },
        normalization: {
            features: [],
            mean: [],
            std: []
        },
        network: {
            inputHiddenWeights: [],
            hiddenBiases: [],
            hiddenOutputWeights: [],
            outputBias: 0
        },
        stats: {
            suspiciousExamples: 0,
            legitimateExamples: 0,
            averageVoteCount: 0,
            meanFeaturesSuspicious: {},
            meanFeaturesLegitimate: {}
        },
        evaluation: {
            finalLoss: null,
            meanAbsoluteError: null,
            bucketAccuracy: null
        },
        featureInsights: {},
        labelDistribution: {
            REAL: 0,
            LIKELY_REAL: 0,
            LIKELY_ALT: 0,
            ALT: 0
        }
    };
}

function getModelInfo() {
    const model = getOrLoadModel();
    return {
        version: model.version,
        trainedAt: model.trainedAt,
        trainingExamples: model.trainingExamples || 0,
        isDefault: !!model.isDefault,
        labelDistribution: model.labelDistribution || {},
        sourceCounts: model.sourceCounts || {}
    };
}

function normalizeFeatureVector(featureValues, normalization) {
    return normalization.features.map((feature, index) => {
        const value = toFinite(featureValues[feature]);
        return (value - normalization.mean[index]) / normalization.std[index];
    });
}

function averageFeatureValue(examples, feature) {
    if (!examples.length) {
        return 0;
    }

    const total = examples.reduce((sum, example) => sum + toFinite(example.features.features[feature]), 0);
    return total / examples.length;
}

function getClassWeights(targets) {
    const suspiciousCount = targets.filter(score => score >= 0.5).length;
    const legitimateCount = Math.max(targets.length - suspiciousCount, 0);

    return {
        suspicious: suspiciousCount ? targets.length / (2 * suspiciousCount) : 1,
        legitimate: legitimateCount ? targets.length / (2 * legitimateCount) : 1
    };
}

function scoreToConsensusLabel(score) {
    if (score >= 0.85) return 'ALT';
    if (score >= 0.55) return 'LIKELY_ALT';
    if (score >= 0.25) return 'LIKELY_REAL';
    return 'REAL';
}

function scoreToBucket(score) {
    if (score >= 0.8) return 4;
    if (score >= 0.6) return 3;
    if (score >= 0.4) return 2;
    if (score >= 0.2) return 1;
    return 0;
}

function binaryCrossEntropy(target, prediction) {
    const y = clampProbability(target);
    const p = clampProbability(prediction);
    return -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

function sigmoid(value) {
    return 1 / (1 + Math.exp(-value));
}

function clampProbability(value) {
    return Math.min(1 - 1e-7, Math.max(1e-7, value));
}

function createPrng(seed) {
    let state = Number(seed) || 1337;
    return function nextRandom() {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function randomBetween(random, min, max) {
    return min + (max - min) * random();
}

function makeMatrix(rows, columns, fillValue) {
    return Array.from({ length: rows }, () => new Array(columns).fill(fillValue));
}

function toFinite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function roundNumber(value, digits) {
    if (!Number.isFinite(value)) {
        return value;
    }
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

function clampInteger(value, min, max) {
    const number = Math.round(Number(value) || 0);
    return Math.max(min, Math.min(max, number));
}

module.exports = {
    MODEL_FILE,
    trainModel,
    loadModel,
    getOrLoadModel,
    getModelInfo,
    ensureModelDir,
    aggregateOfficerLabels,
    buildTrainingExample,
    trainNeuralNetwork,
    prepareDataset,
    normalizeFeatureVector,
    forwardPass,
    scoreToConsensusLabel
};
