'use strict';

const backgroundCheck = require('../backgroundCheck');

/**
 * Extract suspicious features from account background check data
 * Areas:
 * - badge_anomalies: Unusual badge patterns (count, suspicious places)
 * - inventory_anomalies: Suspicious items/assets
 * - gamepass_anomalies: Suspicious game pass patterns
 * - group_anomalies: Suspicious group memberships
 * - xtracker_evidence: Reported violations from xTracker
 * - connection_anomalies: Suspicious connections (linked accounts)
 * 
 * @param {number} robloxId
 * @returns {Promise<Object>} Feature object with scores for each area
 */
async function extractFeatures(robloxId) {
    // Fetch background check data
    const bgCheck = await backgroundCheck.performBackgroundCheck(robloxId);
    
    if (!bgCheck.success) {
        throw new Error(`Background check failed: ${bgCheck.error}`);
    }

    return {
        robloxId,
        username: bgCheck.username,
        features: {
            badgeAnomalies: analyzeBadgeAnomalies(bgCheck),
            inventoryAnomalies: analyzeInventoryAnomalies(bgCheck),
            gamePassAnomalies: analyzeGamePassAnomalies(bgCheck),
            groupAnomalies: analyzeGroupAnomalies(bgCheck),
            xTrackerEvidence: analyzeXTrackerEvidence(bgCheck),
            connectionAnomalies: analyzeConnectionAnomalies(bgCheck)
        },
        timestamp: new Date().toISOString(),
        createdAt: bgCheck.profile?.created ? new Date(bgCheck.profile.created).getTime() : null
    };
}

/**
 * Analyze badge anomalies
 */
function analyzeBadgeAnomalies(bgCheck) {
    const stats = bgCheck.stats || {};
    const badgeCount = stats.badgeCount || 0;
    const suspiciousBadgePlaceCount = stats.suspiciousBadgePlaceCount || 0;
    
    let score = 0;
    const flags = [];

    // Extremely high badge count suggests badge farming/exploiting
    if (badgeCount > 1000) {
        score += 50;
        flags.push('extreme_badge_count');
    } else if (badgeCount > 500) {
        score += 35;
        flags.push('very_high_badge_count');
    } else if (badgeCount > 250) {
        score += 20;
        flags.push('high_badge_count');
    }

    // Badges from suspicious places
    if (suspiciousBadgePlaceCount > 10) {
        score += 45;
        flags.push('many_suspicious_place_badges');
    } else if (suspiciousBadgePlaceCount > 5) {
        score += 30;
        flags.push('suspicious_place_badges');
    } else if (suspiciousBadgePlaceCount > 0) {
        score += 15;
        flags.push('has_suspicious_place_badges');
    }

    // No badges on mature account is slightly suspicious
    if (badgeCount === 0 && bgCheck.profile && isAccountMature(bgCheck.profile)) {
        score += 5;
        flags.push('no_badges_on_mature_account');
    }

    return {
        flagged: flags.length > 0,
        score: Math.min(100, score),
        flags,
        badgeCount,
        suspiciousBadgePlaceCount
    };
}

/**
 * Analyze inventory anomalies
 */
function analyzeInventoryAnomalies(bgCheck) {
    const stats = bgCheck.stats || {};
    const inventoryCount = stats.inventoryCount || 0;
    const developmentItemCount = stats.developmentItemCount || 0;
    
    let score = 0;
    const flags = [];

    // Extremely high inventory count suggests duping/item farming
    if (inventoryCount > 2000) {
        score += 40;
        flags.push('excessive_inventory');
    } else if (inventoryCount > 1000) {
        score += 25;
        flags.push('very_high_inventory');
    }

    // Unusually many development items (builder bases, etc.)
    if (developmentItemCount > 100) {
        score += 30;
        flags.push('excessive_development_items');
    } else if (developmentItemCount > 50) {
        score += 15;
        flags.push('many_development_items');
    }

    // High inventory value could indicate stolen account
    if (bgCheck.inventoryValue && bgCheck.inventoryValue > 1000000) {
        score += 20;
        flags.push('very_high_inventory_value');
    }

    return {
        flagged: flags.length > 0,
        score: Math.min(100, score),
        flags,
        inventoryCount,
        developmentItemCount,
        inventoryValue: bgCheck.inventoryValue || null
    };
}

/**
 * Analyze game pass anomalies
 */
function analyzeGamePassAnomalies(bgCheck) {
    const stats = bgCheck.stats || {};
    const gamePassCount = stats.gamePassCount || 0;
    const selfCreatedPricedGamePassCount = stats.selfCreatedPricedGamePassCount || 0;
    const gamePassPriceTotal = stats.gamePassPriceTotal || 0;
    
    let score = 0;
    const flags = [];

    // Many purchased game passes could indicate RBC farming account
    if (gamePassPriceTotal > 10000) {
        score += 35;
        flags.push('high_gamepass_spending');
    } else if (gamePassPriceTotal > 5000) {
        score += 20;
        flags.push('significant_gamepass_spending');
    }

    // Creating many paid game passes
    if (selfCreatedPricedGamePassCount > 50) {
        score += 30;
        flags.push('excessive_gamepass_creation');
    } else if (selfCreatedPricedGamePassCount > 20) {
        score += 15;
        flags.push('many_gamepasses_created');
    }

    return {
        flagged: flags.length > 0,
        score: Math.min(100, score),
        flags,
        gamePassCount,
        selfCreatedPricedGamePassCount,
        gamePassPriceTotal
    };
}

/**
 * Analyze group anomalies
 */
function analyzeGroupAnomalies(bgCheck) {
    const stats = bgCheck.stats || {};
    const groupCount = stats.groupCount || 0;
    const baseRankGroupCount = stats.baseRankGroupCount || 0;
    const baseRankPercentage = stats.baseRankPercentage || 0;
    
    let score = 0;
    const flags = [];

    // Very high group count suggests spam/alt in many groups
    if (groupCount > 500) {
        score += 35;
        flags.push('excessive_group_count');
    } else if (groupCount > 200) {
        score += 20;
        flags.push('very_high_group_count');
    }

    // Almost entirely base rank groups (no real ranks)
    if (baseRankPercentage > 95 && groupCount > 20) {
        score += 25;
        flags.push('mostly_base_rank_groups');
    } else if (baseRankPercentage > 80 && groupCount > 50) {
        score += 15;
        flags.push('many_base_rank_groups');
    }

    return {
        flagged: flags.length > 0,
        score: Math.min(100, score),
        flags,
        groupCount,
        baseRankGroupCount,
        baseRankPercentage
    };
}

/**
 * Analyze xTracker evidence (external reports)
 */
function analyzeXTrackerEvidence(bgCheck) {
    const xTracker = bgCheck.xTracker || null;
    
    let score = 0;
    const flags = [];

    if (!xTracker) {
        return {
            flagged: false,
            score: 0,
            flags,
            evidenceCount: 0
        };
    }

    const evidenceCount = xTracker.evidenceCount || 0;

    // Each xTracker report significantly increases suspicion
    if (evidenceCount > 5) {
        score += 60;
        flags.push('multiple_external_reports');
    } else if (evidenceCount > 2) {
        score += 40;
        flags.push('several_external_reports');
    } else if (evidenceCount > 0) {
        score += 25;
        flags.push('has_external_reports');
    }

    return {
        flagged: flags.length > 0,
        score: Math.min(100, score),
        flags,
        evidenceCount,
        evidence: xTracker.evidence || []
    };
}

/**
 * Analyze connection anomalies (linked accounts)
 */
function analyzeConnectionAnomalies(bgCheck) {
    const connections = bgCheck.connections || {};
    
    let score = 0;
    const flags = [];

    // Many linked Discord/Roblox connections could indicate account hijacking or trading
    const connCount = Object.keys(connections).length;
    
    if (connCount > 3) {
        score += 20;
        flags.push('many_linked_connections');
    } else if (connCount > 1) {
        score += 10;
        flags.push('multiple_connections');
    }

    return {
        flagged: flags.length > 0,
        score: Math.min(100, score),
        flags,
        connectionCount: connCount
    };
}

/**
 * Check if account is mature (created more than 1 year ago)
 */
function isAccountMature(profile) {
    if (!profile || !profile.created) return false;
    const createdDate = new Date(profile.created).getTime();
    const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
    return createdDate < oneYearAgo;
}

module.exports = {
    extractFeatures,
    analyzeBadgeAnomalies,
    analyzeInventoryAnomalies,
    analyzeGamePassAnomalies,
    analyzeGroupAnomalies,
    analyzeXTrackerEvidence,
    analyzeConnectionAnomalies
};
