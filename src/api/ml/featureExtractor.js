'use strict';

const SNAPSHOT_SCHEMA_VERSION = 'suspicious-account-snapshot-v1';

const FEATURE_CATALOG = {
    accountAgeDays: { aspect: 'profile', label: 'Account age' },

    badgeCount: { aspect: 'badges', label: 'Badge count' },
    suspiciousBadgeCount: { aspect: 'badges', label: 'Flagged badge places' },
    suspiciousBadgeRatio: { aspect: 'badges', label: 'Flagged badge ratio' },
    badgeClusterCount: { aspect: 'badges', label: 'Badge clusters' },
    badgeGapMedianHours: { aspect: 'badges', label: 'Median badge gap' },
    badgeGapStdHours: { aspect: 'badges', label: 'Badge gap variance' },
    badgePerYear: { aspect: 'badges', label: 'Badges per year' },

    totalItems: { aspect: 'inventory', label: 'Inventory size' },
    inventoryDistinctTypes: { aspect: 'inventory', label: 'Inventory variety' },
    developmentItemCount: { aspect: 'inventory', label: 'Development items' },
    developmentItemRatio: { aspect: 'inventory', label: 'Development item ratio' },
    inv_Hat: { aspect: 'inventory', label: 'Hats' },
    inv_Hair: { aspect: 'inventory', label: 'Hair items' },
    inv_Face: { aspect: 'inventory', label: 'Face items' },
    inv_Shirt: { aspect: 'inventory', label: 'Shirts' },
    inv_Pants: { aspect: 'inventory', label: 'Pants' },
    inv_Accessory: { aspect: 'inventory', label: 'Accessories' },
    inv_Gear: { aspect: 'inventory', label: 'Gear' },

    gamePassCount: { aspect: 'gamePasses', label: 'Game pass count' },
    pricedGamePassCount: { aspect: 'gamePasses', label: 'Priced game passes' },
    selfCreatedPricedGamePassCount: { aspect: 'gamePasses', label: 'Self-created priced passes' },
    gamePassTotalSpent: { aspect: 'gamePasses', label: 'Robux spent on game passes' },

    groupCount: { aspect: 'groups', label: 'Group count' },
    groupBaseRankCount: { aspect: 'groups', label: 'Base-rank groups' },
    groupBaseRankRatio: { aspect: 'groups', label: 'Base-rank group ratio' },
    rankedGroupCount: { aspect: 'groups', label: 'Ranked groups' },

    friendCount: { aspect: 'connections', label: 'Friend count' },
    followerCount: { aspect: 'connections', label: 'Follower count' },
    followingCount: { aspect: 'connections', label: 'Following count' },
    socialConnectionTotal: { aspect: 'connections', label: 'Total social links' },
    followerToFollowingRatio: { aspect: 'connections', label: 'Follower/following ratio' }
};

function toFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function safeDivide(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return 0;
    }
    return numerator / denominator;
}

function uniqueCount(values) {
    return new Set(values.filter(Boolean)).size;
}

function extractFeatures(bgCheck) {
    if (!bgCheck || typeof bgCheck !== 'object') {
        throw new Error('Background check data is required for feature extraction');
    }

    const normalized = sanitizeTrainingBackgroundCheck(bgCheck);
    const createdAt = normalized.profile?.created ? new Date(normalized.profile.created).getTime() : null;

    const features = {
        ...analyzeProfileFeatures(normalized),
        ...analyzeBadgeFeatures(normalized),
        ...analyzeInventoryFeatures(normalized),
        ...analyzeGamePassFeatures(normalized),
        ...analyzeGroupFeatures(normalized),
        ...analyzeConnectionFeatures(normalized)
    };

    return {
        robloxId: normalized.robloxId,
        username: normalized.username,
        features,
        timestamp: new Date().toISOString(),
        createdAt,
        dataCoverage: {
            profile: !!normalized.profile && !normalized.profile.error,
            badges: Array.isArray(normalized.badges?.data),
            inventory: Array.isArray(normalized.inventory),
            gamePasses: Array.isArray(normalized.gamePasses),
            groups: Array.isArray(normalized.groups),
            connections: !!normalized.connections && !normalized.connections.error
        }
    };
}

function analyzeProfileFeatures(bgCheck) {
    const createdAt = bgCheck.profile?.created ? new Date(bgCheck.profile.created).getTime() : null;
    const ageDays = createdAt ? Math.max(0, Math.round((Date.now() - createdAt) / 86400000)) : 0;

    return {
        accountAgeDays: ageDays
    };
}

function analyzeBadgeFeatures(bgCheck) {
    const badges = Array.isArray(bgCheck.badges?.data) ? bgCheck.badges.data : [];
    const suspiciousBadgeCount = Array.isArray(bgCheck.badges?.suspicious)
        ? bgCheck.badges.suspicious.length
        : toFiniteNumber(bgCheck.stats?.suspiciousBadgePlaceCount, 0);

    let badgeClusterCount = 0;
    let badgeGapMedianHours = 0;
    let badgeGapStdHours = 0;

    if (badges.length > 1) {
        const sorted = [...badges].sort((a, b) => a.awardedDate - b.awardedDate);
        const gaps = [];
        let clusterSize = 1;
        let clusterStart = sorted[0].awardedDate;

        for (let i = 1; i < sorted.length; i++) {
            const gapSeconds = Math.max(0, sorted[i].awardedDate - sorted[i - 1].awardedDate);
            gaps.push(gapSeconds / 3600);

            if ((sorted[i].awardedDate - clusterStart) <= 60) {
                clusterSize += 1;
            } else {
                if (clusterSize >= 5) badgeClusterCount += 1;
                clusterSize = 1;
                clusterStart = sorted[i].awardedDate;
            }
        }

        if (clusterSize >= 5) {
            badgeClusterCount += 1;
        }

        const orderedGaps = [...gaps].sort((a, b) => a - b);
        const middle = Math.floor(orderedGaps.length / 2);
        badgeGapMedianHours = orderedGaps.length % 2 === 0
            ? (orderedGaps[middle - 1] + orderedGaps[middle]) / 2
            : orderedGaps[middle];

        const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
        const variance = gaps.reduce((sum, gap) => sum + Math.pow(gap - meanGap, 2), 0) / gaps.length;
        badgeGapStdHours = Math.sqrt(variance);
    }

    const accountAgeDays = toFiniteNumber(analyzeProfileFeatures(bgCheck).accountAgeDays, 0);
    const badgePerYear = safeDivide(badges.length, Math.max(accountAgeDays / 365, 0.1));

    return {
        badgeCount: badges.length,
        suspiciousBadgeCount,
        suspiciousBadgeRatio: safeDivide(suspiciousBadgeCount, Math.max(badges.length, 1)),
        badgeClusterCount,
        badgeGapMedianHours,
        badgeGapStdHours,
        badgePerYear
    };
}

function analyzeInventoryFeatures(bgCheck) {
    const inventory = Array.isArray(bgCheck.inventory) ? bgCheck.inventory : [];
    const trackedCategories = ['Hat', 'Hair', 'Face', 'Shirt', 'Pants', 'Accessory', 'Gear'];
    const developmentTypes = new Set(['Plugin', 'Model', 'Decal', 'Audio', 'MeshPart']);
    const categoryCounts = {};

    for (const item of inventory) {
        const type = item?.type || 'Unknown';
        categoryCounts[type] = (categoryCounts[type] || 0) + 1;
    }

    const developmentItemCount = inventory.filter(item => developmentTypes.has(item?.type)).length;
    const features = {
        totalItems: inventory.length,
        inventoryDistinctTypes: uniqueCount(inventory.map(item => item?.type)),
        developmentItemCount,
        developmentItemRatio: safeDivide(developmentItemCount, Math.max(inventory.length, 1))
    };

    for (const category of trackedCategories) {
        features[`inv_${category}`] = categoryCounts[category] || 0;
    }

    return features;
}

function analyzeGamePassFeatures(bgCheck) {
    const gamePasses = Array.isArray(bgCheck.gamePasses) ? bgCheck.gamePasses : [];
    const robloxId = bgCheck.robloxId;

    let pricedGamePassCount = 0;
    let selfCreatedPricedGamePassCount = 0;
    let gamePassTotalSpent = 0;

    for (const gamePass of gamePasses) {
        const price = toFiniteNumber(gamePass?.price, NaN);
        if (!Number.isFinite(price)) {
            continue;
        }

        pricedGamePassCount += 1;

        if (Number(gamePass?.creator?.creatorId) === Number(robloxId)) {
            selfCreatedPricedGamePassCount += 1;
            continue;
        }

        gamePassTotalSpent += price;
    }

    return {
        gamePassCount: gamePasses.length,
        pricedGamePassCount,
        selfCreatedPricedGamePassCount,
        gamePassTotalSpent
    };
}

function analyzeGroupFeatures(bgCheck) {
    const groups = Array.isArray(bgCheck.groups) ? bgCheck.groups : [];
    const groupBaseRankCount = groups.filter(group => !!group?.IsBaseRank).length;

    return {
        groupCount: groups.length,
        groupBaseRankCount,
        groupBaseRankRatio: safeDivide(groupBaseRankCount, Math.max(groups.length, 1)),
        rankedGroupCount: Math.max(0, groups.length - groupBaseRankCount)
    };
}

function analyzeConnectionFeatures(bgCheck) {
    const connections = bgCheck.connections || {};
    const friendCount = toFiniteNumber(connections.friendCount, 0);
    const followerCount = toFiniteNumber(connections.followerCount, 0);
    const followingCount = toFiniteNumber(connections.followingCount, 0);

    return {
        friendCount,
        followerCount,
        followingCount,
        socialConnectionTotal: friendCount + followerCount + followingCount,
        followerToFollowingRatio: clamp(safeDivide(followerCount, Math.max(followingCount, 1)), 0, 10)
    };
}

function sanitizeTrainingBackgroundCheck(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Background check data is required');
    }

    const robloxId = toFiniteNumber(raw.robloxId, null);
    if (!Number.isFinite(robloxId)) {
        throw new Error('robloxId is required for training snapshots');
    }

    const username = raw.username ? String(raw.username) : String(raw.profile?.name || robloxId);
    const badges = normalizeBadgesSection(raw.badges);
    const inventory = normalizeInventory(raw.inventory);
    const gamePasses = normalizeGamePasses(raw.gamePasses);
    const groups = normalizeGroups(raw.groups);
    const connections = normalizeConnections(raw.connections);
    const profile = normalizeProfile(raw.profile, robloxId, username);

    return {
        success: true,
        robloxId,
        username,
        profile,
        connections,
        groups,
        inventory,
        gamePasses,
        badges,
        stats: normalizeStats(raw.stats, {
            badges,
            inventory,
            gamePasses,
            groups
        })
    };
}

function normalizeProfile(profile, robloxId, username) {
    if (profile?.error) {
        return { error: String(profile.error) };
    }

    const created = profile?.created ? new Date(profile.created).toISOString() : null;
    const createdAt = created ? new Date(created).getTime() : null;
    const ageDays = createdAt ? Math.max(0, Math.round((Date.now() - createdAt) / 86400000)) : 0;

    return {
        id: toFiniteNumber(profile?.id, robloxId),
        name: profile?.name ? String(profile.name) : username,
        displayName: profile?.displayName ? String(profile.displayName) : username,
        created,
        ageDays,
        hasVerifiedBadge: !!profile?.hasVerifiedBadge,
        isBanned: !!profile?.isBanned,
        description: typeof profile?.description === 'string' ? profile.description : '',
        externalAppDisplayName: profile?.externalAppDisplayName ? String(profile.externalAppDisplayName) : null
    };
}

function normalizeConnections(connections) {
    if (connections?.error) {
        return { error: String(connections.error) };
    }

    return {
        friendCount: toFiniteNumber(connections?.friendCount, 0),
        followerCount: toFiniteNumber(connections?.followerCount, 0),
        followingCount: toFiniteNumber(connections?.followingCount, 0)
    };
}

function normalizeGroups(groups) {
    if (!Array.isArray(groups)) {
        return [];
    }

    return groups
        .map(group => {
            if (!group || typeof group !== 'object') {
                return null;
            }

            return {
                Id: toFiniteNumber(group.Id ?? group.id ?? group.groupId, 0),
                Name: group.Name ? String(group.Name) : String(group.name || 'Unknown Group'),
                Role: group.Role ? String(group.Role) : String(group.role || 'Unknown Role'),
                Rank: toFiniteNumber(group.Rank ?? group.rank ?? group.roleRank, 0),
                IsBaseRank: !!(group.IsBaseRank ?? group.isBaseRank),
                IsPrimary: !!(group.IsPrimary ?? group.isPrimary)
            };
        })
        .filter(Boolean);
}

function normalizeInventory(inventory) {
    if (!Array.isArray(inventory)) {
        return [];
    }

    return inventory
        .map(item => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const assetId = toFiniteNumber(item.assetId ?? item.id, NaN);
            const type = item.type ? String(item.type) : '';
            if (!Number.isFinite(assetId) || !type) {
                return null;
            }

            return {
                assetId,
                type
            };
        })
        .filter(Boolean);
}

function normalizeGamePasses(gamePasses) {
    if (!Array.isArray(gamePasses)) {
        return [];
    }

    return gamePasses
        .map(gamePass => {
            if (!gamePass || typeof gamePass !== 'object') {
                return null;
            }

            const price = gamePass.price === null || gamePass.price === undefined
                ? null
                : toFiniteNumber(gamePass.price, null);

            return {
                gamePassId: toFiniteNumber(gamePass.gamePassId ?? gamePass.id, 0),
                price,
                creator: {
                    creatorId: toFiniteNumber(gamePass?.creator?.creatorId, 0)
                }
            };
        })
        .filter(Boolean);
}

function normalizeBadgesSection(badges) {
    const badgeData = Array.isArray(badges?.data)
        ? badges.data
        : (Array.isArray(badges) ? badges : []);

    const normalizedBadges = badgeData
        .map(badge => {
            if (!badge || typeof badge !== 'object') {
                return null;
            }

            const awardedDate = toFiniteNumber(badge.awardedDate, NaN);
            const badgeId = toFiniteNumber(badge.badgeId ?? badge.id, NaN);
            const placeId = toFiniteNumber(badge.placeId, NaN);
            if (!Number.isFinite(awardedDate) || !Number.isFinite(badgeId) || !Number.isFinite(placeId)) {
                return null;
            }

            return {
                badgeId,
                placeId,
                awardedDate
            };
        })
        .filter(Boolean);

    const suspicious = Array.isArray(badges?.suspicious)
        ? badges.suspicious
            .map(entry => {
                const placeId = toFiniteNumber(entry?.placeId, NaN);
                if (!Number.isFinite(placeId)) {
                    return null;
                }
                return {
                    placeId,
                    reason: entry?.reason ? String(entry.reason) : null
                };
            })
            .filter(Boolean)
        : [];

    return {
        data: normalizedBadges,
        hasSuspicious: suspicious.length > 0,
        suspicious
    };
}

function normalizeStats(stats, context) {
    const badgeCount = Array.isArray(context.badges?.data) ? context.badges.data.length : 0;
    const inventoryCount = Array.isArray(context.inventory) ? context.inventory.length : 0;
    const groupCount = Array.isArray(context.groups) ? context.groups.length : 0;
    const gamePassCount = Array.isArray(context.gamePasses) ? context.gamePasses.length : 0;
    const baseRankGroupCount = Array.isArray(context.groups)
        ? context.groups.filter(group => !!group?.IsBaseRank).length
        : 0;
    const suspiciousBadgePlaceCount = Array.isArray(context.badges?.suspicious) ? context.badges.suspicious.length : 0;

    return {
        badgeCount: toFiniteNumber(stats?.badgeCount, badgeCount),
        suspiciousBadgePlaceCount: toFiniteNumber(stats?.suspiciousBadgePlaceCount, suspiciousBadgePlaceCount),
        inventoryCount: toFiniteNumber(stats?.inventoryCount, inventoryCount),
        developmentItemCount: toFiniteNumber(stats?.developmentItemCount, 0),
        groupCount: toFiniteNumber(stats?.groupCount, groupCount),
        baseRankGroupCount: toFiniteNumber(stats?.baseRankGroupCount, baseRankGroupCount),
        gamePassCount: toFiniteNumber(stats?.gamePassCount, gamePassCount),
        pricedGamePassCount: toFiniteNumber(stats?.pricedGamePassCount, 0),
        selfCreatedPricedGamePassCount: toFiniteNumber(stats?.selfCreatedPricedGamePassCount, 0),
        gamePassPriceTotal: toFiniteNumber(stats?.gamePassPriceTotal, 0)
    };
}

function createTrainingSnapshot(bgCheck) {
    const backgroundCheck = sanitizeTrainingBackgroundCheck(bgCheck);
    const extractedFeatures = extractFeatures(backgroundCheck);

    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        capturedAt: new Date().toISOString(),
        backgroundCheck,
        extractedFeatures
    };
}

function extractFeaturesFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('Snapshot data is required');
    }

    if (snapshot.extractedFeatures?.features) {
        return {
            robloxId: toFiniteNumber(snapshot.extractedFeatures.robloxId ?? snapshot.backgroundCheck?.robloxId, null),
            username: snapshot.extractedFeatures.username || snapshot.backgroundCheck?.username || 'Unknown',
            features: { ...snapshot.extractedFeatures.features },
            timestamp: snapshot.extractedFeatures.timestamp || new Date().toISOString(),
            createdAt: snapshot.extractedFeatures.createdAt ?? null,
            dataCoverage: {
                profile: !!snapshot.extractedFeatures.dataCoverage?.profile,
                badges: !!snapshot.extractedFeatures.dataCoverage?.badges,
                inventory: !!snapshot.extractedFeatures.dataCoverage?.inventory,
                gamePasses: !!snapshot.extractedFeatures.dataCoverage?.gamePasses,
                groups: !!snapshot.extractedFeatures.dataCoverage?.groups,
                connections: !!snapshot.extractedFeatures.dataCoverage?.connections
            }
        };
    }

    if (snapshot.backgroundCheck) {
        return extractFeatures(snapshot.backgroundCheck);
    }

    return extractFeatures(snapshot);
}

function getFeatureCatalog() {
    return FEATURE_CATALOG;
}

module.exports = {
    SNAPSHOT_SCHEMA_VERSION,
    FEATURE_CATALOG,
    extractFeatures,
    createTrainingSnapshot,
    extractFeaturesFromSnapshot,
    sanitizeTrainingBackgroundCheck,
    getFeatureCatalog
};
