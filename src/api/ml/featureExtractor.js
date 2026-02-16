'use strict';



/**
 * Extract raw features for ML model
 * Returns a flat object of numerical features.
 * 
 * @param {Object} bgCheck - Background check result object
 * @returns {Object} Feature object
 */
function extractFeatures(bgCheck) {
    if (!bgCheck) {
        throw new Error('Background check data is required for feature extraction');
    }

    const features = {
        ...analyzeBadgeFeatures(bgCheck),
        ...analyzeInventoryFeatures(bgCheck),
        ...analyzeGamePassFeatures(bgCheck),
        ...analyzeGroupFeatures(bgCheck),
        ...analyzeConnectionFeatures(bgCheck)
    };

    return {
        robloxId: bgCheck.robloxId,
        username: bgCheck.username,
        features, // Flat object of numbers
        timestamp: new Date().toISOString(),
        createdAt: bgCheck.profile?.created ? new Date(bgCheck.profile.created).getTime() : null
    };
}

/**
 * Extract Badge Features
 */
function analyzeBadgeFeatures(bgCheck) {
    const badges = bgCheck.badges?.data || [];
    const suspiciousBadgeCount = bgCheck.stats?.suspiciousBadgePlaceCount || 0;

    // 1. Time based metrics
    let avgTimeGap = 0;
    let timeVariance = 0;
    let clusterCount = 0; // Clusters of 5+ badges in 1 minute

    if (badges.length > 1) {
        // Sort by awarded date
        const sorted = [...badges].sort((a, b) => a.awardedDate - b.awardedDate);

        const gaps = [];
        let clusterBadges = 0;
        let clusterStartTime = sorted[0].awardedDate;

        for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].awardedDate - sorted[i - 1].awardedDate;
            gaps.push(gap);

            // Clustering logic (60s window)
            if (sorted[i].awardedDate - clusterStartTime <= 60) {
                clusterBadges++;
            } else {
                if (clusterBadges >= 5) clusterCount++;
                clusterBadges = 0;
                clusterStartTime = sorted[i].awardedDate;
            }
        }
        if (clusterBadges >= 5) clusterCount++;

        // Avg Gap
        const totalGap = gaps.reduce((a, b) => a + b, 0);
        avgTimeGap = totalGap / gaps.length;

        // Variance
        const mean = avgTimeGap;
        const squaredDiffs = gaps.map(g => Math.pow(g - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
        timeVariance = Math.sqrt(avgSquaredDiff); // Std Dev
    }

    return {
        badgeCount: badges.length,
        suspiciousBadgeCount,
        badgeAvgTimeGap: avgTimeGap,
        badgeTimeVariance: timeVariance,
        badgeClusterCount: clusterCount
    };
}

/**
 * Extract Inventory Features
 */
function analyzeInventoryFeatures(bgCheck) {
    const inventory = bgCheck.inventory || [];

    // Count per category
    const categoryCounts = {};
    const trackedCategories = [
        'Hat', 'Hair', 'Face', 'Shirt', 'Pants', 'Accessory', 'Gear'
    ];

    for (const item of inventory) {
        const type = item.type || 'Unknown';
        categoryCounts[type] = (categoryCounts[type] || 0) + 1;
    }

    const features = {
        totalItems: inventory.length
    };

    // Flatten specific categories we care about
    for (const cat of trackedCategories) {
        features[`inv_${cat}`] = categoryCounts[cat] || 0;
    }

    return features;
}

/**
 * Extract GamePass Features
 */
function analyzeGamePassFeatures(bgCheck) {
    const gamePasses = bgCheck.gamePasses || [];
    const robloxId = bgCheck.robloxId;

    let purchasedCount = 0;
    let totalSpent = 0;

    for (const gp of gamePasses) {
        const isSelfCreated = Number(gp?.creator?.creatorId) === Number(robloxId);

        if (!isSelfCreated && gp.price) {
            purchasedCount++;
            totalSpent += Number(gp.price) || 0;
        }
    }

    return {
        gamePassCount: purchasedCount, // Only counts ones they bought/own that aren't theirs? 
        // Actually gamePasses is list of owned passes.
        // We usually want to know how much they SPENT.
        gamePassTotalSpent: totalSpent
    };
}

/**
 * Extract Group Features
 */
function analyzeGroupFeatures(bgCheck) {
    const groups = bgCheck.groups || [];

    let baseRankCount = 0;
    for (const g of groups) {
        if (g.IsBaseRank) baseRankCount++;
    }

    return {
        groupCount: groups.length,
        groupBaseRankCount: baseRankCount,
        rankedGroupCount: groups.length - baseRankCount // Groups where rank > 0
    };
}

/**
 * Extract Connection Features
 */
function analyzeConnectionFeatures(bgCheck) {
    const conn = bgCheck.connections || {};

    return {
        friendCount: conn.friendCount || 0,
        followerCount: conn.followerCount || 0,
        followingCount: conn.followingCount || 0
    };
}

module.exports = {
    extractFeatures
};
