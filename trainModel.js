#!/usr/bin/env node
'use strict';

/**
 * CLI tool for suspicious account detection model training
 * Usage: node trainModel.js
 */

const ml = require('./src/api/ml');

async function main() {
    try {
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║    Suspicious Account Detection - Model Trainer          ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');

        // Initialize
        const system = await ml.initialize();
        console.log();

        // Train
        console.log('📚 Starting training from officer labels...\n');
        const model = await ml.train();

        console.log('\n📊 Training Results:');
        console.log(`   • Training examples: ${model.trainingExamples}`);
        console.log(`   • Label distribution:`, model.labelDistribution);
        console.log(`   • Model version: ${model.version}`);
        console.log(`   • Trained at: ${model.trainedAt}`);

        console.log('\n✨ Model is ready for predictions!');
        console.log('\nExample usage:');
        console.log('  const ml = require("./src/api/ml");');
        console.log('  const result = await ml.predict(12345);');
        console.log('  console.log(result.prediction);');

    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

main();
