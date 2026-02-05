'use strict';

const featureExtractor = require('./featureExtractor');
const trainer = require('./trainer');
const inference = require('./inference');

/**
 * Initialize ML system
 */
async function initialize() {
    console.log('🤖 Initializing suspicious account detector...');
    trainer.ensureModelDir();
    
    const modelInfo = trainer.getModelInfo();
    console.log(`📦 Model info:`, {
        version: modelInfo.version,
        trainedAt: modelInfo.trainedAt,
        trainingExamples: modelInfo.trainingExamples,
        isDefault: modelInfo.isDefault
    });

    return {
        featureExtractor,
        trainer,
        inference,
        modelInfo
    };
}

/**
 * Train the model on all officer labels
 */
async function train() {
    console.log('🚀 Starting model training...');
    const model = await trainer.trainModel();
    console.log('✅ Training complete');
    return model;
}

/**
 * Predict suspicion for an account
 */
async function predict(robloxId) {
    return await inference.predictSuspicion(robloxId);
}

/**
 * Predict suspicion for multiple accounts
 */
async function predictBatch(robloxIds) {
    return await inference.predictBatch(robloxIds);
}

module.exports = {
    initialize,
    train,
    predict,
    predictBatch,
    featureExtractor,
    trainer,
    inference
};
