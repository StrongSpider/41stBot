const { DISCORD_PURGE_DEFCON_ROLE_ID, DISCORD_DEFAULT_QUOTA_ROLE_ID } = require('../../config.json');
const { getRoleQuota, getCurrentEventPoints, getWeeklyEventIdsForUser, getWeeklyEventsBatch, getRobloxIdByDiscord } = require('./database');

/**
 * @typedef {Object} EventCap
 * @property {string} alias
 * @property {string[]} types
 * @property {number} count
 */

/**
 * Quota configuration for a role.
 * @typedef {Object} RoleQuota
 * @property {number} quotaEP
 * @property {EventCap[]} eventCaps
 * @property {string} [exclusive] - If set, this quota only applies when the member also has this role id.
 * @property {('all'|string)} [overwrites] - If 'all', it overrides all other quotas. If a role id, it overrides that role's quota.
 * @property {boolean} [purges] - If true (default), this quota counts toward purge compliance.
 */

/**
 * Lightweight Discord member shape used by this module.
 * @typedef {Object} Member
 * @property {string} id
 * @property {string} username
 * @property {string[]} [roles]
 */

/**
 * Result entry for a single event cap evaluation.
 * @typedef {Object} QuotaEventCapResult
 * @property {string} alias
 * @property {string[]} types
 * @property {number} cap
 * @property {number} actual
 * @property {boolean} passed
 * @property {number} delta
 */

/**
 * Result for a single role quota evaluation.
 * @typedef {Object} QuotaEntry
 * @property {string} roleId
 * @property {RoleQuota['overwrites']} [overwrites]
 * @property {string} [exclusive]
 * @property {number} quotaEP
 * @property {number} actualEP
 * @property {boolean} passed
 * @property {number} deltaEP
 * @property {QuotaEventCapResult[]} eventCaps
 * @property {boolean} purges
 */

/**
 * The final report returned when a quota check is performed successfully.
 * @typedef {Object} QuotaReport
 * @property {string} userId
 * @property {string} username
 * @property {boolean} met
 * @property {boolean} metPurgeQuotas
 * @property {QuotaEntry[]} quotas
 * @property {boolean} purge
 */

/**
 * Alternate report shapes returned for special cases.
 * @typedef {Object} QuotaReportStatus
 * @property {string} userId
 * @property {string} username
 * @property {'EXEMPT'|'NOT VERIFIED'} status
 */

/**
 * Expand typed patterns with wildcard support (e.g., 'CT*').
 * @param {string[]} types
 * @param {Record<string, number>} counts
 * @returns {number}
 */
function countMatching(types, counts) {
  let actual = 0;
  for (const type of types || []) {
    if (type.endsWith('*')) {
      const prefix = type.slice(0, -1);
      for (const [eventType, count] of Object.entries(counts)) {
        if (eventType.startsWith(prefix)) actual += count;
      }
    } else {
      actual += counts[type] || 0;
    }
  }
  return actual;
}

/**
 * Builds a quota report entry for a role.
 * @param {RoleQuota} quota
 * @param {string} roleId
 * @param {Record<string, number>} counts
 * @param {number} actualEP
 * @returns {QuotaEntry}
 */
function buildQuotaEntry(quota, roleId, counts, actualEP) {
  /** @type {QuotaEventCapResult[]} */
  const eventCaps = quota.eventCaps.map(cap => {
    const actual = countMatching(cap.types, counts);
    const passed = actual >= cap.count;
    return { alias: cap.alias, types: cap.types, cap: cap.count, actual, passed, delta: actual - cap.count };
  });

  const passedAll = actualEP >= quota.quotaEP && eventCaps.every(ec => ec.passed);

  return {
    roleId,
    overwrites: quota.overwrites,
    exclusive: quota.exclusive,
    quotaEP: quota.quotaEP,
    actualEP,
    passed: passedAll,
    deltaEP: actualEP - quota.quotaEP,
    eventCaps,
    purges: quota.purges ?? true
  };
}

/**
 * Compute per-type event counts for a user's weekly event details.
 * @param {Array<{type?: string}>} details
 * @returns {Record<string, number>}
 */
function computeEventTypeCounts(details) {
  return details.reduce((acc, e) => {
    if (e && e.type) acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */({}));
}

/**
 * Checks all quotas for a given Discord member.
 * @param {Member} member
 * @returns {Promise<QuotaReport|QuotaReportStatus>}
 */
async function checkQuota(member) {
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const roleIds = new Set(roles.map(r => String(r)));
  let hadExclusiveButNotHeld = false;

  // Admin bypass
  if (roles.includes('admin')) {
    return { userId: member.id, username: member.username, status: 'EXEMPT' };
  }

  const userId = member.id;
  const username = member.username;
  const robloxId = await getRobloxIdByDiscord(userId);

  if (robloxId == null) {
    return { userId, username, status: 'NOT VERIFIED' };
  }

  // Fetch activity once
  const actualEP = await getCurrentEventPoints(robloxId);
  const eventIds = await getWeeklyEventIdsForUser(robloxId);
  const details = await getWeeklyEventsBatch(eventIds);
  const counts = computeEventTypeCounts(details);

  // Evaluate quotas for each role present
  const quotaChecks = await Promise.all(
    roles.map(async roleId => {
      const quota = await getRoleQuota(roleId);
      if (!quota) return null;
      if (quota.exclusive != null && !roleIds.has(String(quota.exclusive))) { hadExclusiveButNotHeld = true; return null; }
      return buildQuotaEntry(quota, roleId, counts, actualEP);
    })
  );

  /** @type {QuotaEntry[]} */
  let results = quotaChecks.filter(Boolean);

  // Fallback to default quota when none matched
  if (results.length === 0) {
    // Do NOT fall back to default quota if any role quota was gated by an unmet `exclusive`.
    if (!hadExclusiveButNotHeld) {
      const defaultQuota = await getRoleQuota(DISCORD_DEFAULT_QUOTA_ROLE_ID);
      if (defaultQuota) {
        results = [buildQuotaEntry(defaultQuota, DISCORD_DEFAULT_QUOTA_ROLE_ID, counts, actualEP)];
      }
    }
  }

  // Resolve overwrites
  const overwriteAll = results.find(q => q.overwrites === 'all');
  const effectiveQuotas = overwriteAll
    ? [overwriteAll]
    : results.filter(q => !results.some(other => other.overwrites === q.roleId));

  const purgeEligible = effectiveQuotas.filter(q => q.purges);
  const metPurgeQuotas = purgeEligible.length === 0 ? true : purgeEligible.every(r => r.passed);

  // Hard-coded bypass for a single user id
  if (userId === '530196357823201280') {
    return { userId, username, met: true, metPurgeQuotas: true, quotas: [], purge: false };
  }

  return {
    userId,
    username,
    met: effectiveQuotas.every(r => r.passed),
    metPurgeQuotas,
    quotas: effectiveQuotas,
    purge: roles.includes(DISCORD_PURGE_DEFCON_ROLE_ID)
  };
}

module.exports = { checkQuota };