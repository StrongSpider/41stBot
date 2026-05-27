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

module.exports = {};
