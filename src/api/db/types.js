/**
 * @typedef {Object} User
 * @property {string} robloxId
 * @property {string|null} discordId
 */

/**
 * @typedef {Object} InactivityNotice
 * @property {string} discordId
 * @property {number} date Timestamp
 * @property {string} reason
 */

/**
 * @typedef {Object} BadgeData
 * @property {number} id
 * @property {string} name
 */

/**
 * @typedef {Object} AssetData
 * @property {number} id
 * @property {string} name
 */

/**
 * @typedef {Object} Event
 * @property {string} eventId
 * @property {number[]} attendees Roblox IDs
 * @property {number} host Roblox ID
 * @property {number} supervisor Roblox ID
 * @property {number} timestamp Unix timestamp in ms
 * @property {string} type Event type name
 * @property {string|null} message Discord message link
 */

/**
 * @typedef {Object} EventCap
 * @property {string[]} types Array of event type names
 * @property {number} count Max count allowed
 */

/**
 * @typedef {Object} RoleQuota
 * @property {string} roleId Discord Role ID
 * @property {number} quotaEP Required EP
 * @property {EventCap[]} eventCaps
 * @property {string} overwrites Comma-separated role IDs that this quota overwrites/replaces
 * @property {string} exclusive Comma-separated role IDs that are mutually exclusive with this one
 * @property {boolean} purges Whether this role triggers a purge if quota not met
 */

/**
 * @typedef {Object} GroupRole
 * @property {string} id
 * @property {number} rank
 */

/**
 * @typedef {Object} Group
 * @property {string} groupid
 * @property {GroupRole[]} roles
 * @property {string} expires ISO timestamp
 */

/**
 * @typedef {Object} SuspiciousPlace
 * @property {number} placeId
 * @property {string} reason
 * @property {string} addedBy Discord ID
 * @property {number} dateAdded Timestamp
 */

/**
 * @typedef {Object} OfficerLabel
 * @property {number} id Label ID
 * @property {string} target_roblox_id
 * @property {string} officer_discord_id
 * @property {string} label Label text (REAL, ALT, etc.)
 * @property {Object} featuresSnapshot JSON snapshot of data/features at time of labeling
 * @property {string} created_at ISO timestamp
 */

module.exports = {};
