'use strict';

const axios = require('axios');
const https = require('https');
const { createCanvas } = require('canvas');

const roblox = require('./roblox.js');
const assets = require('./assets.js');
const badge = require('./badge.js');
const groupsApi = require('./groups.js');
const database = require('./database.js');
const cookieManager = require('./cookieManager.js');
const inference = require('./ml/inference.js');

const config = require('../../config.json');
const { ASSET_TYPES: ROBLOX_ASSET_TYPES } = config.ROBLOX;
const { XTRACKER_API_KEY } = config.EXTERNAL;

const PER_REQUEST_TIMEOUT_MS = 5000;

// Keep connections alive for long-running lookups
const defaultHttpsAgent = new https.Agent({ keepAlive: true });

// Shared axios client (NO global timeout, per-request only)
const http = axios.create({
    httpsAgent: defaultHttpsAgent
});

// Roblox-only axios client (uses cookie manager for dynamic cookie updates)
const robloxHttp = axios.create({
    httpsAgent: defaultHttpsAgent,
    headers: { Cookie: cookieManager.getCookieHeader() }
});

// Attach response interceptor to handle Set-Cookie headers
cookieManager.attachResponseInterceptor(robloxHttp);

const LoggerClass = require('./logger.js')
const logger = new LoggerClass('BackgroundCheck', 'API')

function toErrMsg(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err instanceof Error && err.message) return err.message;
    return String(err);
}

/**
 * Per-request hard timeout wrapper for axios requests.
 * This attaches a 5s timeout to THIS request only, and aborts stalled sockets.
 */
async function axiosRequest(client, label, config) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
        try {
            controller.abort(new Error(`${label} timed out after ${PER_REQUEST_TIMEOUT_MS}ms`));
        } catch {
            controller.abort();
        }
    }, PER_REQUEST_TIMEOUT_MS);

    try {
        return await client.request({
            ...config,
            timeout: PER_REQUEST_TIMEOUT_MS,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Run a section safely so one failure does not block the whole check.
 */
async function safe(label, fn) {
    try {
        const data = await fn();
        return { ok: true, data };
    } catch (err) {
        return { ok: false, error: `${label}: ${toErrMsg(err)}` };
    }
}

/**
 * Fetch all game passes for a user with pagination.
 * Each page is a separate request with a 5s hard timeout.
 * If any page fails or times out, the entire section fails.
 */
async function fetchAllUserGamePasses(userId) {
    const all = [];
    let exclusiveStartId = "";

    const MAX_PAGES = 200;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
        const url = `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100&exclusiveStartId=${exclusiveStartId}`;

        const res = await axiosRequest(
            robloxHttp,
            'gamepasses page',
            { method: 'GET', url }
        );

        const page = Array.isArray(res?.data?.gamePasses) ? res.data.gamePasses : [];
        all.push(...page);

        const last = page[page.length - 1];
        if (page.length === 100 && last && last.gamePassId) {
            exclusiveStartId = String(last.gamePassId);
            continue;
        }

        break;
    }

    return all;
}

/**
 * Fetch inventory value from Rolimons.
 * Single request with a 5s hard timeout.
 */
async function fetchInventoryValue(robloxId) {
    try {
        const rolimonsAgent = new https.Agent({ keepAlive: true, family: 4 });

        const res = await axiosRequest(
            http,
            'rolimons',
            {
                method: 'GET',
                url: `https://api.rolimons.com/players/v1/playerinfo/${robloxId}`,
                httpsAgent: rolimonsAgent
            }
        );

        if (res.data && res.data.success && typeof res.data.value === 'number') {
            return res.data.value;
        }
    } catch (e) {
        logger.warn('Rolimons fetch failed:', toErrMsg(e));
    }

    return null;
}

/**
 * Fetch all favorite games for a user.
 * Each page is a separate request with a 5s hard timeout.
 * If any page fails or times out, the entire section fails.
 */
async function fetchAllFavoriteGames(robloxId) {
    let cursor = "";
    const all = [];

    const MAX_PAGES = 500;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
        const url = `https://games.roblox.com/v2/users/${robloxId}/favorite/games?accessFilter=1&limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

        const res = await axiosRequest(
            robloxHttp,
            'favorites page',
            { method: 'GET', url }
        );

        const data = Array.isArray(res?.data?.data) ? res.data.data : [];
        all.push(...data);

        const next = res?.data?.nextPageCursor;
        if (!next) break;

        cursor = String(next);
    }

    return all;
}

/**
 * Fetch xTracker data for a user.
 * Single request with a 5s hard timeout.
 */
async function fetchXTrackerData(robloxId) {
    if (!XTRACKER_API_KEY) {
        return null;
    }

    try {
        const res = await axiosRequest(
            http,
            'xtracker',
            {
                method: 'GET',
                url: `https://api.xtracker.xyz/api/registry/user?id=${robloxId}`,
                headers: {
                    Authorization: XTRACKER_API_KEY
                },
                validateStatus: (status) => status === 200 || status === 404
            }
        );

        // 404 means clean record
        if (res.status === 404) {
            return null;
        }

        return res.data;
    } catch (e) {
        logger.warn('xTracker fetch failed:', toErrMsg(e));
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

    const placeIds = [...new Set(badges.map(b => Number(b.placeId)).filter(Number.isFinite))];

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

    const suspiciousPlaceIds = new Set(suspiciousPlaces.filter(s => s.reason === 'Badge Runner').map(s => s.placeId));

    const sorted = [...badges].sort((a, b) => a.awardedDate - b.awardedDate);

    const width = 1200;
    const height = 600;
    const marginLeft = 80;
    const marginRight = 40;
    const marginTop = 70;
    const marginBottom = 70;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "white";
    ctx.font = "30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`${username} • Badge Timeline`, width / 2, 15);

    ctx.font = "20px sans-serif";
    ctx.fillText(`${sorted.length} total badges`, width / 2, 50);

    if (sorted.length > 0) {
        const times = sorted.map(b => new Date(b.awardedDate * 1000).getTime());
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const spanTime = maxTime - minTime || 1;
        const maxTotal = sorted.length;

        const xForTime = (t) =>
            marginLeft +
            ((t - minTime) / spanTime) *
            (width - marginLeft - marginRight);

        const yForTotal = (total) =>
            height - marginBottom -
            ((total - 1) / (maxTotal - 1 || 1)) *
            (height - marginTop - marginBottom);

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

        for (let i = 0; i < sorted.length; i++) {
            const b = sorted[i];
            const t = new Date(b.awardedDate * 1000).getTime();
            const total = i + 1;
            const x = xForTime(t);
            const y = yForTotal(total);

            const isSuspicious = suspiciousPlaceIds.has(b.placeId);

            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);

            if (isSuspicious) {
                ctx.fillStyle = "rgba(255, 85, 85, 0.5)";
                ctx.fill();
                ctx.strokeStyle = "rgba(255, 85, 85, 1)";
            } else {
                ctx.fillStyle = "rgba(0, 255, 90, 0.35)";
                ctx.fill();
                ctx.strokeStyle = "rgba(0, 255, 90, 0.9)";
            }

            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

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
 * Generate AI Risk Visualization
 * @param {Object} prediction - Prediction object from inference.js
 * @returns {Buffer|null} PNG buffer
 */
function generateRiskVisual(prediction) {
    if (!prediction) return null;

    const width = 600;
    const height = 150;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("AI Suspicion Analysis", 20, 35);

    // Score Bar (Gradient)
    const barX = 20;
    const barY = 60;
    const barW = width - 40;
    const barH = 30;

    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, "#4caf50"); // Green
    grad.addColorStop(0.5, "#ffeb3b"); // Yellow
    grad.addColorStop(1, "#f44336"); // Red

    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, barW, barH);

    // Marker
    const score = prediction.cumulativeScore || 0; // 0-100
    const markerX = barX + (score / 100) * barW;

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(markerX, barY - 5);
    ctx.lineTo(markerX, barY + barH + 5);
    ctx.stroke();

    // Rating Text
    ctx.font = "bold 24px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(`${prediction.suspicionString} (${score}%)`, 20, 130);

    // Confidence Text
    ctx.textAlign = "right";
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#aaaaaa";
    ctx.fillText(`Confidence: ${prediction.confidence}%`, width - 20, 130);

    return canvas.toBuffer("image/png");
}

/**
 * Perform a complete background check on a Roblox user
 *
 * IMPORTANT NOTE:
 * This module enforces 5s per-request timeouts for requests made in THIS file
 * (Rolimons, xTracker, favorites/gamepasses pagination via robloxHttp/http).
 * If roblox.js/assets.js/badge.js/groups.js internally make HTTP requests without per-request timeouts,
 * you must update those modules similarly to guarantee the same 5s per-request rule everywhere.
 *
 * @param {string|number} usernameOrId - Roblox username or ID
 * @returns {Promise<Object>} Background check results
 */
async function performBackgroundCheck(usernameOrId) {
    const startTime = Date.now();

    let robloxId = Number(usernameOrId);
    let username = null;

    if (!Number.isFinite(robloxId)) {
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
        username = await roblox.getUsernameFromId(robloxId);
    }

    const tasks = {
        profile: () => safe('profile', () => roblox.getUserProfile(robloxId)),
        connections: () => safe('connections', () => roblox.getConnections(robloxId)),
        groups: () => safe('groups', () => groupsApi.getGroupInformation(robloxId)),
        inventory: () => safe('inventory', () => assets.getAssetsInformation(robloxId)),
        gamePasses: () => safe('gamepasses', () => fetchAllUserGamePasses(robloxId)),
        inventoryValue: () => safe('rolimons', () => fetchInventoryValue(robloxId)),
        xTracker: () => safe('xtracker', () => fetchXTrackerData(robloxId)),
        badges: () => safe('badges', () => badge.getUserBadges(robloxId)),
        favorites: () => safe('favorites', () => fetchAllFavoriteGames(robloxId))
    };

    const keys = Object.keys(tasks);
    const settled = await Promise.allSettled(keys.map(k => tasks[k]()));

    const results = {};
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const r = settled[i];
        results[k] = (r.status === 'fulfilled') ? r.value : { ok: false, error: `${k}: ${toErrMsg(r.reason)}` };
    }

    const profile = results.profile.ok ? results.profile.data : { error: results.profile.error };
    const connections = results.connections.ok ? results.connections.data : { error: results.connections.error };
    const groups = results.groups.ok && Array.isArray(results.groups.data) ? results.groups.data : (results.groups.ok ? [] : { error: results.groups.error });
    const inventory = results.inventory.ok && Array.isArray(results.inventory.data) ? results.inventory.data : (results.inventory.ok ? [] : { error: results.inventory.error });
    const gamePasses = results.gamePasses.ok && Array.isArray(results.gamePasses.data) ? results.gamePasses.data : (results.gamePasses.ok ? [] : { error: results.gamePasses.error });
    const inventoryValue = results.inventoryValue.ok ? results.inventoryValue.data : null;
    const xTrackerData = results.xTracker.ok ? results.xTracker.data : null;
    const badgesData = results.badges.ok && Array.isArray(results.badges.data) ? results.badges.data : (results.badges.ok ? [] : { error: results.badges.error });
    const favoritesData = results.favorites.ok ? results.favorites.data : null;

    const badgeSuspicious = Array.isArray(badgesData)
        ? await checkSuspiciousBadgePlaces(badgesData)
        : { hasSuspicious: false, suspicious: [] };

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

    let xTrackerEvidence = [];
    if (xTrackerData && xTrackerData.evidence) {
        const year = 31556952000;
        for (const submission of xTrackerData.evidence) {
            const ts = new Date(submission.date).getTime();
            if (Number.isFinite(ts) && ts >= (Date.now() - year)) {
                xTrackerEvidence.push({
                    reason: submission.reason,
                    date: submission.date,
                    url: submission.url
                });
            }
        }
    }

    const elapsedMs = Date.now() - startTime;

    const finalResult = {
        success: true,
        robloxId,
        username,
        elapsedMs,

        profile,
        connections,
        groups,
        inventory,
        gamePasses,
        badges: Array.isArray(badgesData) ? {
            data: badgesData,
            ...badgeSuspicious
        } : badgesData,
        favorites: results.favorites.ok ? favoritesData : { error: results.favorites.error },
        inventoryValue,
        xTracker: xTrackerEvidence.length > 0 ? {
            evidenceCount: xTrackerEvidence.length,
            evidence: xTrackerEvidence
        } : null,

        badgeGraph: Array.isArray(badgesData) && badgesData.length > 0 ? {
            buffer: generateBadgeGraph(badgesData, username, badgeSuspicious.suspicious),
            filename: `badge_graph_${username}.png`
        } : null,

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
            favoriteGamesCount: Array.isArray(favoritesData) ? favoritesData.length : 0,
            badgeCount: Array.isArray(badgesData) ? badgesData.length : 0,
            suspiciousBadgePlaceCount: badgeSuspicious.suspicious.length
        }
    };

    // Calculate AI Prediction using the data we just gathered
    const predictionCheck = await safe('ai', () => inference.predictSuspicion(finalResult));

    // Attach prediction
    finalResult.aiPrediction = predictionCheck.ok ? predictionCheck.data : null;

    // Attach visual
    finalResult.riskVisual = (finalResult.aiPrediction) ? {
        buffer: generateRiskVisual(finalResult.aiPrediction),
        filename: `risk_visual_${username}.png`
    } : null;

    return finalResult;
}

/**
 * Perform a "Hybrid" background check for AI analysis.
 *
 * Strategy:
 * - Badges: DB ONLY (avoid heavy paging)
 * - Assets/Inventory: DB ONLY (avoid heavy paging)
 * - Profile: DB (cache) -> Live Fallback
 * - Groups: Live (Permission granted)
 * - Connections: Live (Permission granted)
 * - GamePasses: Live (Permission granted)
 * - Favorites: Live (Permission granted)
 * - xTracker: SKIP (No permission)
 * - Rolimons: SKIP (No permission)
 *
 * @param {string|number} usernameOrId
 * @returns {Promise<Object>} Background check results suitable for featureExtractor
 */
async function getAIBackgroundCheck(usernameOrId) {
    const startTime = Date.now();

    let robloxId = Number(usernameOrId);
    let username = null;

    // 1. Resolve ID/Username (Try DB first for username)
    if (!Number.isFinite(robloxId)) {
        username = String(usernameOrId);
        // Try to get ID from DB cache first
        const cachedUser = await database.getUserByUsername(username);
        if (cachedUser) {
            robloxId = cachedUser.robloxId;
        } else {
            // Fallback to live lookup
            robloxId = await roblox.getIdFromUsername(username);
        }

        if (!robloxId) {
            return {
                success: false,
                error: 'Username not found',
                elapsedMs: Date.now() - startTime
            };
        }
    } else {
        // Try to get Username from DB cache first
        const cachedUser = await database.getUserById(robloxId);
        if (cachedUser) {
            username = cachedUser.username;
        } else {
            // Fallback to live lookup
            username = await roblox.getUsernameFromId(robloxId);
        }
    }

    // 2. Define Tasks
    // DB Tasks (Safe, fast)
    const dbTasks = {
        inventory: () => safe('inventory_db', () => database.getUserAssets(robloxId)),
        badges: () => safe('badges_db', () => database.getUserBadges(robloxId))
    };

    // Live Tasks (Permission granted) - using existing safe() wrapper with timeouts
    const liveTasks = {
        // Profile helps confirm account age, etc
        profile: () => safe('profile', () => roblox.getUserProfile(robloxId)),
        connections: () => safe('connections', () => roblox.getConnections(robloxId)),
        groups: () => safe('groups', () => groupsApi.getGroupInformation(robloxId)),
        gamePasses: () => safe('gamepasses', () => fetchAllUserGamePasses(robloxId)),
        favorites: () => safe('favorites', () => fetchAllFavoriteGames(robloxId))
    };

    // Execute concurrently
    const [dbResults, liveResults] = await Promise.all([
        Promise.allSettled(Object.values(dbTasks).map(fn => fn())),
        Promise.allSettled(Object.values(liveTasks).map(fn => fn()))
    ]);

    // Helper to extract result
    const unwrap = (settled, index) => {
        if (settled[index].status === 'fulfilled') return settled[index].value;
        return { ok: false, error: 'Internal Error' };
    };

    // Map results back to keys
    const dbKeys = Object.keys(dbTasks);
    const liveKeys = Object.keys(liveTasks);

    const data = {};
    dbKeys.forEach((k, i) => { data[k] = unwrap(dbResults, i); });
    liveKeys.forEach((k, i) => { data[k] = unwrap(liveResults, i); });

    // Process Data (Similar to performBackgroundCheck but handling missing/skipped)

    const profile = data.profile.ok ? data.profile.data : { error: data.profile.error };
    const connections = data.connections.ok ? data.connections.data : { error: data.connections.error };
    const groups = data.groups.ok && Array.isArray(data.groups.data) ? data.groups.data : [];
    const inventory = data.inventory.ok && Array.isArray(data.inventory.data) ? data.inventory.data : []; // DB
    const gamePasses = data.gamePasses.ok && Array.isArray(data.gamePasses.data) ? data.gamePasses.data : [];
    const badgesData = data.badges.ok && Array.isArray(data.badges.data) ? data.badges.data : []; // DB
    const favoritesData = data.favorites.ok ? data.favorites.data : [];

    // Suspicious Places Logic (DB check on badges)
    const badgeSuspicious = Array.isArray(badgesData)
        ? await checkSuspiciousBadgePlaces(badgesData)
        : { hasSuspicious: false, suspicious: [] };

    // Derived Stats
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

    const elapsedMs = Date.now() - startTime;

    const finalResult = {
        success: true,
        robloxId,
        username,
        elapsedMs,

        profile,
        connections,
        groups,
        inventory, // from DB
        gamePasses,
        badges: Array.isArray(badgesData) ? {
            data: badgesData,
            ...badgeSuspicious
        } : badgesData, // from DB
        favorites: data.favorites.ok ? favoritesData : { error: data.favorites.error },
        inventoryValue: null, // SKIPPED
        xTracker: null, // SKIPPED

        // Graph is still useful if badges exist
        badgeGraph: Array.isArray(badgesData) && badgesData.length > 0 ? {
            buffer: generateBadgeGraph(badgesData, username, badgeSuspicious.suspicious),
            filename: `badge_graph_${username}.png`
        } : null,

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
            favoriteGamesCount: Array.isArray(favoritesData) ? favoritesData.length : 0,
            badgeCount: Array.isArray(badgesData) ? badgesData.length : 0,
            suspiciousBadgePlaceCount: badgeSuspicious.suspicious.length
        }
    };

    // Calculate AI Prediction
    const predictionCheck = await safe('ai', () => inference.predictSuspicion(finalResult));
    finalResult.aiPrediction = predictionCheck.ok ? predictionCheck.data : null;

    // Attach visual
    finalResult.riskVisual = (finalResult.aiPrediction) ? {
        buffer: generateRiskVisual(finalResult.aiPrediction),
        filename: `risk_visual_${username}.png`
    } : null;

    return finalResult;
}


module.exports = {
    performBackgroundCheck,
    getAIBackgroundCheck,
    generateBadgeGraph,
    generateRiskVisual,
    axiosRequest,
    PER_REQUEST_TIMEOUT_MS
};