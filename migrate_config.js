const fs = require('fs');
const path = require('path');

// Usage: node src/scripts/migrate_config.js [path/to/old_config.json]
// Defaults to 'config.json' if not specified.
// Outputs to 'config_migrated.json'

const inputPath = process.argv[2] || path.join(__dirname, './config.json');
const templatePath = path.join(__dirname, './configTemplate.json');
const outputPath = path.join(__dirname, './config_migrated.json');

if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
}

const oldConfig = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const newConfigTemplate = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

// Clone the template to preserve structure and defaults
const newConfig = JSON.parse(JSON.stringify(newConfigTemplate));

// --- MAPPING LOGIC ---

// Helper to safely get value or return undefined
const get = (key) => oldConfig[key];

// 1. DISCORD.BOT
if (get('BOT_TOKEN')) newConfig.DISCORD.BOT.TOKEN = get('BOT_TOKEN');
if (get('BOT_CLIENT_ID')) newConfig.DISCORD.BOT.CLIENT_ID = get('BOT_CLIENT_ID');
if (get('BOT_GUILD_ID')) newConfig.DISCORD.BOT.GUILD_ID = get('BOT_GUILD_ID');
if (get('GAR_BOT_USER_ID')) newConfig.DISCORD.BOT.GAR_USER_ID = get('GAR_BOT_USER_ID');
if (get('DEVELOPER_DISCORD_USER_ID')) newConfig.DISCORD.BOT.DEVELOPER_USER_ID = get('DEVELOPER_DISCORD_USER_ID');
// Fallback for developer ID if explicit key missing but DEVELOPER_USER_ID exists
if (!get('DEVELOPER_DISCORD_USER_ID') && get('DEVELOPER_USER_ID')) newConfig.DISCORD.BOT.DEVELOPER_USER_ID = get('DEVELOPER_USER_ID');


// 2. DISCORD.AUTH
if (get('DISCORD_AUTH_CLIENT_SECRET')) newConfig.DISCORD.AUTH.CLIENT_SECRET = get('DISCORD_AUTH_CLIENT_SECRET');
// Handle legacy keys if they exist differently
if (get('AUTH_CLIENT_SECRET') && !newConfig.DISCORD.AUTH.CLIENT_SECRET) newConfig.DISCORD.AUTH.CLIENT_SECRET = get('AUTH_CLIENT_SECRET');

if (get('DISCORD_AUTH_REDIRECT_URI')) newConfig.DISCORD.AUTH.REDIRECT_URI = get('DISCORD_AUTH_REDIRECT_URI');
if (get('AUTH_REDIRECT_URI') && !newConfig.DISCORD.AUTH.REDIRECT_URI) newConfig.DISCORD.AUTH.REDIRECT_URI = get('AUTH_REDIRECT_URI');

// 3. DISCORD.ROLES
const roles = newConfig.DISCORD.ROLES;
if (get('DISCORD_FFCNC_ROLE_ID')) roles.FFCNC = get('DISCORD_FFCNC_ROLE_ID');
if (get('DISCORD_HICOM_ROLE_ID')) roles.HICOM = get('DISCORD_HICOM_ROLE_ID');
if (get('DISCORD_OFFICER_ROLE_ID')) roles.OFFICER = get('DISCORD_OFFICER_ROLE_ID');
if (get('DISCORD_MINOR_OFFICER_ROLE_ID')) roles.MINOR_OFFICER = get('DISCORD_MINOR_OFFICER_ROLE_ID');
if (get('DISCORD_CMOTW_ROLE_ID')) roles.CMOTW = get('DISCORD_CMOTW_ROLE_ID');
if (get('DISCORD_VIP_PING_ROLE_ID')) roles.VIP_PING = get('DISCORD_VIP_PING_ROLE_ID');
if (get('DISCORD_DEFAULT_QUOTA_ROLE_ID')) roles.DEFAULT_QUOTA = get('DISCORD_DEFAULT_QUOTA_ROLE_ID');
if (get('DISCORD_PURGE_DEFCON_ROLE_ID')) roles.PURGE_DEFCON = get('DISCORD_PURGE_DEFCON_ROLE_ID');
if (get('INACTIVITY_MANAGEMENT_ROLE_ID')) roles.INACTIVITY_MANAGEMENT = get('INACTIVITY_MANAGEMENT_ROLE_ID');
if (get('INACTIVITY_NOTICE_ROLE_ID')) roles.INACTIVITY_NOTICE = get('INACTIVITY_NOTICE_ROLE_ID');
if (get('EXEMPT_DISCORD_ROLE_ID')) roles.EXEMPT = get('EXEMPT_DISCORD_ROLE_ID');
if (get('DISCORD_ERT_OFFICER_ROLE_IDS')) roles.ERT_OFFICER = get('DISCORD_ERT_OFFICER_ROLE_IDS');

// Nested Objects in ROLES
if (get('DISCORD_MEDAL_ROLES')) {
    roles.MEDAL.PLATINUM = get('DISCORD_MEDAL_ROLES').PLATINUM_ROLE || "";
    roles.MEDAL.GOLD = get('DISCORD_MEDAL_ROLES').GOLD_ROLE || "";
    roles.MEDAL.SILVER = get('DISCORD_MEDAL_ROLES').SILVER_ROLE || "";
    roles.MEDAL.BRONZE = get('DISCORD_MEDAL_ROLES').BRONZE_ROLE || "";
}

if (get('UNIT_ROLES')) roles.UNIT = get('UNIT_ROLES');
if (get('COMPANY_DISCORD_ROLES')) roles.COMPANY = get('COMPANY_DISCORD_ROLES');
if (get('RANK_DISCORD_ROLES')) roles.RANK = get('RANK_DISCORD_ROLES');

// 4. DISCORD.CHANNELS
const channels = newConfig.DISCORD.CHANNELS;
const oldChannels = get('DISCORD_CHANNEL_IDS') || {};
if (oldChannels.COUNTER_RAID_LOGS) channels.COUNTER_RAID_LOGS = oldChannels.COUNTER_RAID_LOGS;
if (oldChannels.WELCOME_CHANNEL) channels.WELCOME = oldChannels.WELCOME_CHANNEL;
if (oldChannels.MINOR_OFFICER_EVENT_LOGS) channels.MINOR_OFFICER_EVENT_LOGS = oldChannels.MINOR_OFFICER_EVENT_LOGS;
if (oldChannels.OFFICER_EVENT_LOGS) channels.OFFICER_EVENT_LOGS = oldChannels.OFFICER_EVENT_LOGS;
if (oldChannels.GAR_BOT_LOGS) channels.GAR_BOT_LOGS = oldChannels.GAR_BOT_LOGS;
if (oldChannels.OFFICER_BOT_COMMANDS) channels.OFFICER_BOT_COMMANDS = oldChannels.OFFICER_BOT_COMMANDS;

// 5. DISCORD.WEBHOOKS
const webhooks = newConfig.DISCORD.WEBHOOKS;
if (get('ADMIN_LOGS_WEBHOOK_URL')) webhooks.ADMIN_LOGS = get('ADMIN_LOGS_WEBHOOK_URL');
if (get('GUARDING_TRACKER_WEBHOOK_URL')) webhooks.GUARDING_TRACKER = get('GUARDING_TRACKER_WEBHOOK_URL');

// 6. PORTAL
if (get('PORTAL_SECRET')) newConfig.PORTAL.SECRET = get('PORTAL_SECRET');
if (get('PORTAL_PORT')) newConfig.PORTAL.PORT = get('PORTAL_PORT');
if (get('PORTAL_CORS_PORT')) newConfig.PORTAL.CORS_PORT = get('PORTAL_CORS_PORT');

// 7. POSTGRES
if (get('POSTGRES_USER')) newConfig.POSTGRES.USER = get('POSTGRES_USER');
if (get('POSTGRES_PASSWORD')) newConfig.POSTGRES.PASSWORD = get('POSTGRES_PASSWORD');
if (get('POSTGRES_HOST')) newConfig.POSTGRES.HOST = get('POSTGRES_HOST');
if (get('POSTGRES_PORT')) newConfig.POSTGRES.PORT = get('POSTGRES_PORT');
if (get('POSTGRES_DATABASE')) newConfig.POSTGRES.DATABASE = get('POSTGRES_DATABASE');

// 8. ROBLOX
if (get('ROBLOX_GROUP_ID')) newConfig.ROBLOX.GROUP_ID = get('ROBLOX_GROUP_ID');
if (get('GAR_GROUP_ID')) newConfig.ROBLOX.GAR_GROUP_ID = get('GAR_GROUP_ID');
if (get('ROBLOX_GROUP_GUARDING_RANKS')) newConfig.ROBLOX.GROUP_GUARDING_RANKS = get('ROBLOX_GROUP_GUARDING_RANKS');
if (get('ROBLOX_COOKIE')) newConfig.ROBLOX.COOKIE = get('ROBLOX_COOKIE');
if (get('ROBLOX_PLACE_ID')) newConfig.ROBLOX.PLACE_ID = get('ROBLOX_PLACE_ID');
if (get('ROBLOX_ASSET_TYPES')) newConfig.ROBLOX.ASSET_TYPES = get('ROBLOX_ASSET_TYPES');

// 9. WEBSHARE
if (get('WEBSHARE_PROXIES')) newConfig.WEBSHARE.PROXIES = get('WEBSHARE_PROXIES');
if (get('WEBSHARE_USERNAME')) newConfig.WEBSHARE.USERNAME = get('WEBSHARE_USERNAME');
if (get('WEBSHARE_PASSWORD')) newConfig.WEBSHARE.PASSWORD = get('WEBSHARE_PASSWORD');
if (get('WEBSHARE_HOST')) newConfig.WEBSHARE.HOST = get('WEBSHARE_HOST');
if (get('WEBSHARE_PORT')) newConfig.WEBSHARE.PORT = get('WEBSHARE_PORT');
if (get('WEBSHARE_PROXY_LIST_URL')) newConfig.WEBSHARE.PROXY_LIST_URL = get('WEBSHARE_PROXY_LIST_URL');
if (get('WEBSHARE_API_KEY')) newConfig.WEBSHARE.API_KEY = get('WEBSHARE_API_KEY');

// 10. EXTERNAL
if (get('XTRACKER_API_KEY')) newConfig.EXTERNAL.XTRACKER_API_KEY = get('XTRACKER_API_KEY');

// 11. GENERAL
if (get('EMBED_COLOR')) newConfig.GENERAL.EMBED_COLOR = get('EMBED_COLOR');
if (get('ACCENT_COLOR')) newConfig.GENERAL.ACCENT_COLOR = get('ACCENT_COLOR');
if (get('GROUP_NAME')) newConfig.GENERAL.GROUP_NAME = get('GROUP_NAME');
if (get('TROOPER_RANK_LABEL')) newConfig.GENERAL.TROOPER_RANK_LABEL = get('TROOPER_RANK_LABEL');


console.log('Migration complete.');
console.log(`Writing to ${outputPath}...`);
fs.writeFileSync(outputPath, JSON.stringify(newConfig, null, 2));
console.log('Done.');
