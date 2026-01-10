'use strict';

const axios = require('axios');
const https = require('https');
const { createCanvas } = require('canvas');

const roblox = require('./roblox.js');
const assets = require('./assets.js');
const badge = require('./badge.js');
const groupsApi = require('./groups.js');
const database = require('./database.js');

const { ROBLOX_ASSET_TYPES, XTRACKER_API_KEY, ROBLOX_COOKIE } = require('../../config.json');

const REQUEST_TIMEOUT_MS = 55000;

// Keep connections alive for long-running lookups
const defaultHttpsAgent = new https.Agent({ keepAlive: true });

// Shared axios client with a 55s timeout
const http = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    httpsAgent: defaultHttpsAgent
});

// Roblox-only axios client (ensures ROBLOX_COOKIE is only sent to Roblox domains)
const ROBLOX_COOKIE_HEADER = `.ROBLOSECURITY=${ROBLOX_COOKIE}`;

const robloxHttp = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    httpsAgent: defaultHttpsAgent,
    headers: { Cookie: ROBLOX_COOKIE_HEADER }
});

/**
 * Wrap a promise to return {ok, data} or {ok, error}
 */
async function wrap(promise) {
    try {
        const data = await Promise.resolve(promise);
        return { ok: true, data };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error && err.message ? err.message : String(err)
        };
    }
}

/**
 * Add timeout to a promise
 */
function withTimeout(promise, ms, label = 'request') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        timeout
    ]);
}

/**
 * Fetch all game passes for a user with pagination
 */
async function fetchAllUserGamePasses(userId) {
    const all = [];
    let exclusiveStartId = "";

    while (true) {
        const url = `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100&exclusiveStartId=${exclusiveStartId}`;
        const res = await robloxHttp.get(url);
        const page = Array.isArray(res?.data?.gamePasses) ? res.data.gamePasses : [];

        all.push(...page);

        if (page.length === 100 && page[page.length - 1] && page[page.length - 1].gamePassId) {
            exclusiveStartId = String(page[page.length - 1].gamePassId);
            continue;
        }

        break;
    }

    return all;
}

/**
 * Fetch inventory value from Rolimons
 */
async function fetchInventoryValue(robloxId) {
    try {
        const rolimonsResponse = await http.get(
            `https://api.rolimons.com/players/v1/playerinfo/${robloxId}`,
            {
                httpsAgent: new https.Agent({ keepAlive: true, family: 4 }),
                timeout: REQUEST_TIMEOUT_MS
            }
        );
        if (rolimonsResponse.data && rolimonsResponse.data.success && typeof rolimonsResponse.data.value === 'number') {
            return rolimonsResponse.data.value;
        }
    } catch (e) {
        console.log('[backgroundCheck] Rolimons fetch failed:', e.message);
    }
    return null;
}

/**
 * Fetch all favorite games for a user (paginates through all results)
 */
async function fetchAllFavoriteGames(robloxId) {
    let cursor = "";
    const all = [];

    // Safety guard to avoid infinite loops if Roblox returns a bad cursor
    const MAX_PAGES = 500;
    let pages = 0;

    while (pages < MAX_PAGES) {
        const url = `https://games.roblox.com/v2/users/${robloxId}/favorite/games?accessFilter=1&limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

        try {
            const res = await robloxHttp.get(url);
            const data = Array.isArray(res?.data?.data) ? res.data.data : [];
            all.push(...data);

            const next = res?.data?.nextPageCursor;
            if (!next) break;

            cursor = String(next);
            pages++;
        } catch (e) {
            console.log('[backgroundCheck] Favorites fetch failed:', e.message);
            return null;
        }
    }

    return all;
}

/**
 * Fetch xTracker data for a user
 */
async function fetchXTrackerData(robloxId) {
    if (!XTRACKER_API_KEY) {
        return null;
    }

    try {
        const response = await http.get(
            `https://api.xtracker.xyz/api/registry/user?id=${robloxId}`,
            {
                headers: {
                    "Authorization": XTRACKER_API_KEY
                },
                validateStatus: (status) => status === 200 || status === 404,
                timeout: 5000
            }
        );

        // 404 means clean record
        if (response.status === 404) {
            return null;
        }
        return response.data;
    } catch (e) {
        console.log('[backgroundCheck] xTracker fetch failed:', e.message);
        return null;
    }
}

/**
 * Check badges against suspicious places database
 */
async function checkSuspiciousBadgePlaces(badges) {
    if (!Array.isArray(badges) || badges.length === 0) {
        return { hasSuspicious: false, suspicious: [] };
    }

    // Get unique place IDs from badges
    const placeIds = [...new Set(badges.map(b => Number(b.placeId)).filter(Number.isFinite))];

    // Check each against database
    const suspicious = [];
    for (const placeId of placeIds) {
        const result = await database.isSuspiciousPlace(placeId);
        if (result.isSuspicious) {
            suspicious.push({
                placeId,
                reason: result.reason
            });
        }
    }

    return {
        hasSuspicious: suspicious.length > 0,
        suspicious
    };
}

/**
 * Generate badge timeline graph as PNG
 * @param {Array} badges - Badge data
 * @param {string} username - Username for title
 * @param {Array} suspiciousPlaces - Array of suspicious place objects {placeId, reason}
 * @returns {Buffer|null} PNG buffer or null if no badges
 */
function generateBadgeGraph(badges, username, suspiciousPlaces = []) {
    if (!Array.isArray(badges) || badges.length === 0) {
        return null;
    }

    // Create a set of suspicious place IDs for fast lookup
    const suspiciousPlaceIds = new Set(suspiciousPlaces.filter(s => s.reason === 'Badge Runner').map(s => s.placeId));

    // Sort by awardedDate ascending
    const sorted = [...badges].sort((a, b) => a.awardedDate - b.awardedDate);

    const width = 1200;
    const height = 600;
    const marginLeft = 80;
    const marginRight = 40;
    const marginTop = 70;
    const marginBottom = 70;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.fillStyle = "white";
    ctx.font = "30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`${username} • Badge Timeline`, width / 2, 15);

    // Subtitle
    ctx.font = "20px sans-serif";
    ctx.fillText(`${sorted.length} total badges`, width / 2, 50);

    if (sorted.length > 0) {
        // Build data
        const times = sorted.map(b => new Date(b.awardedDate * 1000).getTime());
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const spanTime = maxTime - minTime || 1;
        const maxTotal = sorted.length;

        // Helper to map time and total to canvas coords
        const xForTime = (t) =>
            marginLeft +
            ((t - minTime) / spanTime) *
            (width - marginLeft - marginRight);

        const yForTotal = (total) =>
            height - marginBottom -
            ((total - 1) / (maxTotal - 1 || 1)) *
            (height - marginTop - marginBottom);

        // Grid - X (years)
        const minYear = new Date(minTime).getUTCFullYear();
        const maxYear = new Date(maxTime).getUTCFullYear();
        ctx.strokeStyle = "#222222";
        ctx.lineWidth = 1;
        ctx.font = "18px sans-serif";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        for (let year = minYear; year <= maxYear; year++) {
            const t = Date.UTC(year, 0, 1);
            if (t < minTime || t > maxTime) continue;
            const x = xForTime(t);

            ctx.beginPath();
            ctx.moveTo(x, marginTop);
            ctx.lineTo(x, height - marginBottom);
            ctx.stroke();

            ctx.fillText(String(year), x, height - marginBottom + 5);
        }

        // Grid - Y (totals)
        const steps = 6;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        for (let i = 0; i <= steps; i++) {
            const total = 1 + Math.round((maxTotal - 1) * (i / steps));
            const y = yForTotal(Math.min(total, maxTotal));

            ctx.beginPath();
            ctx.moveTo(marginLeft, y);
            ctx.lineTo(width - marginRight, y);
            ctx.stroke();

            ctx.fillText(String(total), marginLeft - 10, y);
        }

        // Draw points
        for (let i = 0; i < sorted.length; i++) {
            const b = sorted[i];
            const t = new Date(b.awardedDate * 1000).getTime();
            const total = i + 1;
            const x = xForTime(t);
            const y = yForTotal(total);

            // Check if this badge is from a suspicious place
            const isSuspicious = suspiciousPlaceIds.has(b.placeId);

            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);

            if (isSuspicious) {
                // Red for suspicious places
                ctx.fillStyle = "rgba(255, 85, 85, 0.5)";
                ctx.fill();
                ctx.strokeStyle = "rgba(255, 85, 85, 1)";
            } else {
                // Green for normal badges
                ctx.fillStyle = "rgba(0, 255, 90, 0.35)";
                ctx.fill();
                ctx.strokeStyle = "rgba(0, 255, 90, 0.9)";
            }

            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Suspicious places warning at bottom center if any
    if (suspiciousPlaceIds.size > 0) {
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#ff5555";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(`*Known suspicious badges are shown in red`, width / 2, height - 10);
    }

    return canvas.toBuffer("image/png");
}

/**
 * Perform a complete background check on a Roblox user
 * 
 * @param {string|number} usernameOrId - Roblox username or ID
 * @returns {Promise<Object>} Background check results
 */
async function performBackgroundCheck(usernameOrId) {
    const startTime = Date.now();

    // Step 1: Resolve username to ID if needed
    let robloxId = Number(usernameOrId);
    let username = null;

    if (!Number.isFinite(robloxId)) {
        // It's a username, resolve to ID
        username = String(usernameOrId);
        robloxId = await roblox.getIdFromUsername(username);

        if (!robloxId) {
            return {
                success: false,
                error: 'Username not found',
                elapsedMs: Date.now() - startTime
            };
        }
    } else {
        // It's an ID, get username
        username = await roblox.getUsernameFromId(robloxId);
    }

    // Step 2: Run all data fetches in parallel
    const [
        profileRes,
        connectionsRes,
        groupsRes,
        inventoryRes,
        gamePassesRes,
        inventoryValueRes,
        xTrackerRes,
        badgesRes,
        favoritesRes
    ] = await Promise.all([
        wrap(withTimeout(roblox.getUserProfile(robloxId), REQUEST_TIMEOUT_MS, 'profile')),
        wrap(withTimeout(roblox.getConnections(robloxId), REQUEST_TIMEOUT_MS, 'connections')),
        wrap(withTimeout(groupsApi.getGroupInformation(robloxId), REQUEST_TIMEOUT_MS, 'groups')),
        wrap(withTimeout(assets.getAssetsInformation(robloxId), REQUEST_TIMEOUT_MS, 'inventory')),
        wrap(withTimeout(fetchAllUserGamePasses(robloxId), REQUEST_TIMEOUT_MS, 'gamepasses')),
        wrap(fetchInventoryValue(robloxId)),
        wrap(fetchXTrackerData(robloxId)),
        wrap(withTimeout(badge.getUserBadges(robloxId), REQUEST_TIMEOUT_MS, 'badges')),
        wrap(withTimeout(fetchAllFavoriteGames(robloxId), REQUEST_TIMEOUT_MS, 'favorites')),
    ]);

    // Step 3: Extract data or errors
    const profile = profileRes.ok ? profileRes.data : { error: profileRes.error };
    const connections = connectionsRes.ok ? connectionsRes.data : { error: connectionsRes.error };
    const groups = groupsRes.ok && Array.isArray(groupsRes.data) ? groupsRes.data : (groupsRes.ok ? [] : { error: groupsRes.error });
    const inventory = inventoryRes.ok && Array.isArray(inventoryRes.data) ? inventoryRes.data : (inventoryRes.ok ? [] : { error: inventoryRes.error });
    const gamePasses = gamePassesRes.ok && Array.isArray(gamePassesRes.data) ? gamePassesRes.data : (gamePassesRes.ok ? [] : { error: gamePassesRes.error });
    const inventoryValue = inventoryValueRes.ok ? inventoryValueRes.data : null;
    const xTrackerData = xTrackerRes.ok ? xTrackerRes.data : null;
    const badgesData = badgesRes.ok && Array.isArray(badgesRes.data) ? badgesRes.data : (badgesRes.ok ? [] : { error: badgesRes.error });
    const favoritesCount = favoritesRes.ok ? favoritesRes.data : null;

    // Step 4: Check for suspicious badge places
    const badgeSuspicious = Array.isArray(badgesData)
        ? await checkSuspiciousBadgePlaces(badgesData)
        : { hasSuspicious: false, suspicious: [] };

    // Step 5: Compute stats
    const baseRankGroups = Array.isArray(groups) ? groups.filter(g => g.IsBaseRank) : [];
    const developmentItems = Array.isArray(inventory)
        ? inventory.filter(i => ROBLOX_ASSET_TYPES.DEVELOPMENT.find(type => type == i.type))
        : [];

    const isCreatedByCheckedUser = (gp) => Number(gp?.creator?.creatorId) === Number(robloxId);

    const pricedGamePassCount = Array.isArray(gamePasses)
        ? gamePasses.reduce((acc, gp) => acc + (typeof gp.price === "number" ? 1 : 0), 0)
        : 0;

    const selfCreatedPricedGamePassCount = Array.isArray(gamePasses)
        ? gamePasses.reduce((acc, gp) => acc + (typeof gp.price === "number" && isCreatedByCheckedUser(gp) ? 1 : 0), 0)
        : 0;

    const gamePassPriceTotal = Array.isArray(gamePasses)
        ? gamePasses.reduce((acc, gp) => acc + (typeof gp.price === "number" && !isCreatedByCheckedUser(gp) ? gp.price : 0), 0)
        : 0;

    // Step 6: Process xTracker evidence
    let xTrackerEvidence = [];
    if (xTrackerData && xTrackerData.evidence) {
        const year = 31556952000; // 1 year in ms
        for (const submission of xTrackerData.evidence) {
            const ts = new Date(submission.date).getTime();
            if (Number.isFinite(ts) && ts >= (Date.now() - year)) {
                xTrackerEvidence.push({
                    reason: submission.reason,
                    date: submission.date,
                    url: submission.url // Include evidence URL if available
                });
            }
        }
    }

    const elapsedMs = Date.now() - startTime;

    // Step 7: Return structured data
    return {
        success: true,
        robloxId,
        username,
        elapsedMs,

        // Raw data
        profile,
        connections,
        groups,
        inventory,
        gamePasses,
        badges: Array.isArray(badgesData) ? {
            data: badgesData,
            ...badgeSuspicious
        } : badgesData,
        favorites: favoritesRes.ok ? favoritesRes.data : { error: favoritesRes.error },
        inventoryValue,
        xTracker: xTrackerEvidence.length > 0 ? {
            evidenceCount: xTrackerEvidence.length,
            evidence: xTrackerEvidence
        } : null,

        // Badge graph (PNG buffer)
        badgeGraph: Array.isArray(badgesData) && badgesData.length > 0 ? {
            buffer: generateBadgeGraph(badgesData, username, badgeSuspicious.suspicious),
            filename: `badge_graph_${username}.png`
        } : null,

        // Computed stats
        stats: {
            groupCount: Array.isArray(groups) ? groups.length : 0,
            baseRankGroupCount: baseRankGroups.length,
            baseRankPercentage: Array.isArray(groups) && groups.length > 0
                ? Math.round((baseRankGroups.length / groups.length) * 100)
                : 0,
            inventoryCount: Array.isArray(inventory) ? inventory.length : 0,
            developmentItemCount: developmentItems.length,
            gamePassCount: Array.isArray(gamePasses) ? gamePasses.length : 0,
            pricedGamePassCount,
            selfCreatedPricedGamePassCount,
            gamePassPriceTotal,
            favoriteGamesCount: Array.isArray(favoritesRes.data) ? favoritesRes.data.length : 0,
            badgeCount: Array.isArray(badgesData) ? badgesData.length : 0,
            suspiciousBadgePlaceCount: badgeSuspicious.suspicious.length
        }
    };
}

module.exports = {
    performBackgroundCheck,
    generateBadgeGraph
};
