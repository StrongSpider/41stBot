/**
 * Configuration for ML Model Training
 * 
 * Adjust these biases to manually influence the model's weights.
 * 
 * Positive Bias (+) = Increases Suspicion (makes feature look more like an alt)
 * Negative Bias (-) = Increases Trust (makes feature look more like a real player)
 * 
 * The values are added to the learned weights.
 * - Small adjustments: 0.1 to 0.5
 * - Strong adjustments: 1.0 to 2.0
 */
module.exports = {
    biases: {
        // BADGE INDICATORS
        // Strong indicators of botting/farming behaviors
        badgeClusterCount: 1.5,          // heavily suspicious if badges earned in seconds
        suspiciousBadgePlaceCount: 1.5,  // heavily suspicious if from farming games
        suspiciousBadgeCount: 1.5,       // ensure this key matches feature extractor
        badgeAvgTimeGap: -0.5,           // larger gap = more normal, so negative bias to trust larger gaps? 
        // ACTUALLY: The feature is "Average Gap". 
        // Small gap = sus. Large gap = normal.
        // Features are standardized. 
        // Let's assume the ML learns the sign. Use biases carefully.
        // For counts, it's safer.

        // GROUP INDICATORS
        // Groups with rank > 0 are a strong sign of a real human
        rankedGroupCount: -2.0,          // Strong trust signal
        groupCount: -0.2,                // Mild trust signal

        // SPENDING INDICATORS
        // Real money spent is the gold standard for real accounts
        gamePassTotalSpent: -0.05,       // Trust signal (value can be high, so small multiplier/bias)
        gamePassCount: -0.5,             // Trust signal

        // ACCOUNT AGE
        // Older accounts are generally more trusted
        accountAge: -0.1                 // Trust signal
    },

    // Scaling factors (multipliers) to dampen or amplify specific features
    // Useful for features that are noisy or have high variance
    scales: {
        badgeTimeVariance: 0.2           // Dampen this feature significantly (only 20% impact)
    }
};
