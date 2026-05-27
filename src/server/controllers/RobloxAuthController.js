const axios = require('axios').default;
const crypto = require('crypto');
const qs = require('querystring');
const config = require('../../../config.json');
const Logger = require('../../api/logger.js');
const database = require('../../api/database');
const { verifyAuthenticationToken } = require('../../api/authenticator.js');

const logger = new Logger('RobloxAuthController', 'SERVER');

const ROBLOX_OAUTH_AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const ROBLOX_OAUTH_TOKEN_URL = 'https://apis.roblox.com/oauth/v1/token';
const ROBLOX_OAUTH_USERINFO_URL = 'https://apis.roblox.com/oauth/v1/userinfo';
const ROBLOX_CLOUD_USERS_URL = 'https://apis.roblox.com/cloud/v2/users';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const USED_VERIFY_NONCES = new Map();

function normalizeScopes(scopesConfig) {
    if (Array.isArray(scopesConfig)) {
        return scopesConfig
            .map(scope => String(scope).trim())
            .filter(Boolean);
    }

    if (typeof scopesConfig === 'string') {
        return scopesConfig
            .split(/\s+/g)
            .map(scope => scope.trim())
            .filter(Boolean);
    }

    return ['openid', 'profile'];
}

function getOAuthConfig() {
    const oauth = (config.ROBLOX && config.ROBLOX.OAUTH) ? config.ROBLOX.OAUTH : {};
    return {
        appId: String(oauth.APP_ID || '').trim(),
        appSecret: String(oauth.APP_SECRET || '').trim(),
        redirectUri: String(oauth.REDIRECT_URI || '').trim(),
        scopes: normalizeScopes(oauth.SCOPES)
    };
}

function isOAuthConfigured(oauthConfig) {
    return Boolean(oauthConfig.appId && oauthConfig.appSecret && oauthConfig.redirectUri);
}

function maskSecret(secret) {
    if (!secret) return '';
    if (secret.length <= 8) return '********';
    return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function extractError(err) {
    if (!err) return 'Unknown error';
    if (err.response && err.response.data) {
        if (typeof err.response.data === 'string') return err.response.data;
        try {
            return JSON.stringify(err.response.data);
        } catch (_) {
            return String(err.response.data);
        }
    }
    return err.message || String(err);
}

function sanitizeNextPath(nextPath) {
    if (typeof nextPath !== 'string') return '/';
    if (!nextPath.startsWith('/')) return '/';
    if (nextPath.startsWith('//')) return '/';
    return nextPath;
}

function cleanupUsedVerifyNonces() {
    const now = Date.now();
    for (const [nonce, exp] of USED_VERIFY_NONCES.entries()) {
        if (!exp || exp < now) USED_VERIFY_NONCES.delete(nonce);
    }
}

function isVerifyNonceUsed(nonce) {
    cleanupUsedVerifyNonces();
    if (!nonce) return false;
    return USED_VERIFY_NONCES.has(nonce);
}

function markVerifyNonceUsed(nonce, exp) {
    if (!nonce) return;
    cleanupUsedVerifyNonces();
    USED_VERIFY_NONCES.set(nonce, Number(exp) || (Date.now() + OAUTH_STATE_TTL_MS));
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderResultPage({ title, message, subtitle, success }) {
    const accent = success ? '#0f766e' : '#b91c1c';
    const bg = success ? '#f0fdfa' : '#fef2f2';
    const text = success ? '#134e4a' : '#7f1d1d';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#0b1220; color:#0b1220; display:grid; place-items:center; min-height:100vh; }
    .card { max-width:560px; width:92%; background:${bg}; border:2px solid ${accent}; border-radius:16px; padding:28px 24px; box-shadow:0 18px 36px rgba(0,0,0,.28); }
    h1 { margin:0 0 10px; font-size:1.4rem; color:${accent}; }
    p { margin:8px 0; line-height:1.45; color:${text}; }
    .small { font-size:.92rem; opacity:.92; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${subtitle ? `<p class="small">${escapeHtml(subtitle)}</p>` : ''}
  </main>
</body>
</html>`;
}

function parseRobloxId(raw) {
    if (raw == null) return null;
    const value = String(raw).trim();
    if (!value) return null;

    if (/^\d+$/.test(value)) return value;

    const pathMatch = value.match(/users\/(\d+)/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1];

    return null;
}

function extractRobloxIdFromOAuth(userInfo, cloudUser) {
    const candidates = [
        userInfo && userInfo.sub,
        userInfo && userInfo.user_id,
        userInfo && userInfo.userId,
        cloudUser && cloudUser.path,
        cloudUser && cloudUser.user
    ];

    for (const candidate of candidates) {
        const parsed = parseRobloxId(candidate);
        if (parsed) return parsed;
    }

    return null;
}

function extractUsername(userInfo, cloudUser) {
    const candidates = [
        userInfo && userInfo.preferred_username,
        userInfo && userInfo.name,
        userInfo && userInfo.username,
        cloudUser && cloudUser.name,
        cloudUser && cloudUser.displayName
    ];

    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        if (value) return value;
    }

    return null;
}

function shouldRenderHtml(req, verifyToken) {
    if (verifyToken) return true;
    const accept = String(req.headers.accept || '').toLowerCase();
    return accept.includes('text/html');
}

function sendErrorResponse(req, res, statusCode, message, details, verifyToken) {
    if (shouldRenderHtml(req, verifyToken)) {
        return res
            .status(statusCode)
            .send(renderResultPage({
                title: 'Verification Failed',
                message,
                subtitle: details || 'Please run /verify start in Discord to generate a new link.',
                success: false
            }));
    }

    return res.status(statusCode).json({
        success: false,
        message,
        details
    });
}

const RobloxAuthController = {
    robloxStart: (req, res) => {
        const oauthConfig = getOAuthConfig();
        if (!isOAuthConfigured(oauthConfig)) {
            logger.error('Roblox OAuth start blocked: missing ROBLOX.OAUTH config.');
            return sendErrorResponse(req, res, 500, 'Roblox OAuth is not configured on this server.');
        }

        const verifyToken = typeof req.query.verify === 'string' ? req.query.verify.trim() : '';
        if (verifyToken) {
            let claims;
            try {
                claims = verifyAuthenticationToken(verifyToken);
            } catch (err) {
                const details = err instanceof Error ? err.message : String(err);
                return sendErrorResponse(req, res, 400, 'Verification link is invalid.', details, verifyToken);
            }

            if (isVerifyNonceUsed(claims.nonce)) {
                return sendErrorResponse(req, res, 400, 'Verification link was already used.', 'Please run /verify start in Discord for a fresh link.', verifyToken);
            }
        }

        const state = crypto.randomBytes(24).toString('hex');
        const nextPath = sanitizeNextPath(req.query.next);

        req.session.robloxOAuth = {
            state,
            createdAt: Date.now(),
            nextPath,
            verifyToken: verifyToken || null
        };

        const params = qs.stringify({
            client_id: oauthConfig.appId,
            redirect_uri: oauthConfig.redirectUri,
            response_type: 'code',
            scope: oauthConfig.scopes.join(' '),
            state
        });

        return res.redirect(`${ROBLOX_OAUTH_AUTHORIZE_URL}?${params}`);
    },

    robloxCallback: async (req, res) => {
        const oauthConfig = getOAuthConfig();
        if (!isOAuthConfigured(oauthConfig)) {
            logger.error('Roblox OAuth callback blocked: missing ROBLOX.OAUTH config.');
            return sendErrorResponse(req, res, 500, 'Roblox OAuth is not configured on this server.');
        }

        const { code, state, error, error_description: errorDescription } = req.query;
        const saved = req.session.robloxOAuth || null;
        delete req.session.robloxOAuth;

        const verifyToken = saved && saved.verifyToken ? String(saved.verifyToken) : '';

        if (error) {
            logger.warn(`Roblox OAuth callback returned error "${error}" (${errorDescription || 'no description'}).`);
            return sendErrorResponse(req, res, 400, 'Roblox authorization was denied or failed.', errorDescription || String(error), verifyToken);
        }

        if (!code || !state) {
            return sendErrorResponse(req, res, 400, 'Missing OAuth callback parameters (code/state).', null, verifyToken);
        }

        if (!saved || !saved.state || saved.state !== state) {
            return sendErrorResponse(req, res, 400, 'OAuth state validation failed.', null, verifyToken);
        }

        if (!saved.createdAt || (Date.now() - Number(saved.createdAt)) > OAUTH_STATE_TTL_MS) {
            return sendErrorResponse(req, res, 400, 'OAuth state expired.', 'Please run /verify start again.', verifyToken);
        }

        let tokenResp;
        try {
            tokenResp = await axios.post(
                ROBLOX_OAUTH_TOKEN_URL,
                qs.stringify({
                    grant_type: 'authorization_code',
                    client_id: oauthConfig.appId,
                    client_secret: oauthConfig.appSecret,
                    code,
                    redirect_uri: oauthConfig.redirectUri
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
        } catch (err) {
            logger.error(`Roblox token exchange failed for app ${oauthConfig.appId} (${maskSecret(oauthConfig.appSecret)}): ${extractError(err)}`);
            return sendErrorResponse(req, res, 502, 'Failed to exchange authorization code for token.', extractError(err), verifyToken);
        }

        const accessToken = tokenResp.data && tokenResp.data.access_token;
        if (!accessToken) {
            logger.error('Roblox token exchange succeeded but response had no access_token.');
            return sendErrorResponse(req, res, 502, 'OAuth token response was missing access_token.', null, verifyToken);
        }

        let userInfo = null;
        try {
            const userInfoResp = await axios.get(ROBLOX_OAUTH_USERINFO_URL, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            userInfo = userInfoResp.data || null;
        } catch (err) {
            logger.warn(`Roblox userinfo fetch failed after token exchange: ${extractError(err)}`);
        }

        let cloudUser = null;
        const userIdFromUserInfo = parseRobloxId(userInfo && userInfo.sub);
        if (userIdFromUserInfo) {
            try {
                const cloudResp = await axios.get(`${ROBLOX_CLOUD_USERS_URL}/${encodeURIComponent(userIdFromUserInfo)}`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                cloudUser = cloudResp.data || null;
            } catch (err) {
                logger.warn(`Roblox Cloud_GetUser failed for user ${userIdFromUserInfo}: ${extractError(err)}`);
            }
        }

        const robloxId = extractRobloxIdFromOAuth(userInfo, cloudUser);
        const username = extractUsername(userInfo, cloudUser);

        if (!verifyToken) {
            return res.json({
                success: true,
                message: 'Roblox OAuth callback completed.',
                userInfo,
                cloudUser,
                robloxId,
                username,
                hasRefreshToken: Boolean(tokenResp.data.refresh_token),
                scope: tokenResp.data.scope || oauthConfig.scopes.join(' '),
                tokenType: tokenResp.data.token_type || null,
                expiresIn: tokenResp.data.expires_in || null,
                nextPath: sanitizeNextPath(saved.nextPath)
            });
        }

        let verifyClaims;
        try {
            verifyClaims = verifyAuthenticationToken(verifyToken);
        } catch (err) {
            const details = err instanceof Error ? err.message : String(err);
            return sendErrorResponse(req, res, 400, 'Verification link is invalid.', details, verifyToken);
        }

        if (isVerifyNonceUsed(verifyClaims.nonce)) {
            return sendErrorResponse(req, res, 400, 'Verification link was already used.', 'Please run /verify start in Discord for a fresh link.', verifyToken);
        }

        if (!robloxId) {
            return sendErrorResponse(req, res, 502, 'Could not determine the Roblox account from OAuth response.', 'Please run /verify start again.', verifyToken);
        }

        try {
            const linkedDiscordId = await database.getDiscordIdByRoblox(robloxId);
            if (linkedDiscordId && String(linkedDiscordId) !== String(verifyClaims.discordId)) {
                return sendErrorResponse(
                    req,
                    res,
                    409,
                    'That Roblox account is already linked to another Discord user.',
                    'If this seems wrong, contact an officer.',
                    verifyToken
                );
            }

            await database.upsertRobloxId(verifyClaims.discordId, robloxId);
            if (username) {
                await database.upsertUser(robloxId, username).catch(err => {
                    logger.warn(`Failed to cache Roblox username for ${robloxId}: ${extractError(err)}`);
                });
            }
        } catch (err) {
            const details = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to link Discord ${verifyClaims.discordId} to Roblox ${robloxId}: ${details}`);
            return sendErrorResponse(req, res, 500, 'Failed to complete account linking.', details, verifyToken);
        }

        markVerifyNonceUsed(verifyClaims.nonce, verifyClaims.exp);

        return res.status(200).send(renderResultPage({
            title: 'Verification Complete',
            message: username
                ? `Your Discord account (${verifyClaims.discordId}) is now linked to Roblox user ${username} (${robloxId}).`
                : `Your Discord account (${verifyClaims.discordId}) is now linked to Roblox user (${robloxId}).`,
            subtitle: 'You can close this page and return to Discord.',
            success: true
        }));
    }
};

module.exports = RobloxAuthController;
