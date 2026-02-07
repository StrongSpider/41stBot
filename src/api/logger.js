'use strict'

const { WebhookClient, EmbedBuilder } = require('discord.js')
const config = require('../../config.json')
const { ADMIN_LOGS: ADMIN_LOGS_WEBHOOK_URL } = config.DISCORD.WEBHOOKS

// Colors for console
const COLORS = {
    reset: '\x1b[0m',
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
}

// Source specific colors
const SOURCE_COLORS = {
    BOT: COLORS.cyan,
    SERVER: COLORS.green,
    UPDATER: COLORS.yellow,
    API: COLORS.magenta,
    SHARED: COLORS.blue,
    SYSTEM: COLORS.gray
}

// Webhook for system logs
let webhookClient = null
if (ADMIN_LOGS_WEBHOOK_URL) {
    try {
        webhookClient = new WebhookClient({ url: ADMIN_LOGS_WEBHOOK_URL })
    } catch (err) {
        console.error('Failed to init logger webhook client:', err)
    }
}

/**
 * Format timestamp for console
 */
function getTimestamp() {
    return new Date().toISOString()
}

/**
 * Send log to Discord Webhook
 * @param {string} level 
 * @param {string} message 
 * @param {string} source
 * @param {string} context
 */
async function sendToWebhook(level, message, source, context) {
    if (!webhookClient) return

    const colorMap = {
        INFO: 0x00b0f4, // Light Blue
        WARN: 0xffaa00, // Gold
        ERROR: 0xff0000 // Red
    }

    let description = message.length > 3900 ? message.substring(0, 3900) + '...' : message

    // Apply codeblock formatting if applicable (multi-line, error, or JSON-like)
    const isMultiLine = description.includes('\n')
    const isError = level === 'ERROR'
    const isJson = description.trim().startsWith('{') || description.trim().startsWith('[')

    if (isMultiLine || isError || isJson) {
        const lang = (isError || isJson) ? 'js' : ''
        description = `\`\`\`${lang}\n${description}\n\`\`\``
    }

    const embed = new EmbedBuilder()
        .setTitle(`[${level}] ${source} - ${context}`)
        .setDescription(description)
        .setColor(colorMap[level] || 0xcccccc)
        .setTimestamp()

    try {
        await webhookClient.send({ embeds: [embed] })
    } catch (err) {
        process.stdout.write(`[LOGGER ERROR] Failed to send webhook: ${err.message}\n`)
    }
}

class Logger {
    /**
     * Create a new Logger instance
     * @param {string} context - The context/module name (e.g., 'BlacklistUpdater', 'Command', 'Database')
     * @param {string} source - The source of the log ('BOT', 'SERVER', 'UPDATER', 'API', 'SHARED'). Defaults to 'BOT'.
     */
    constructor(context, source = 'BOT') {
        this.context = context || 'Global';
        this.source = source.toUpperCase();
    }

    info(message, ...args) {
        this._log('INFO', message, ...args)
    }

    warn(message, ...args) {
        this._log('WARN', message, ...args)
    }

    error(message, ...args) {
        this._log('ERROR', message, ...args)
    }

    debug(message, ...args) {
        if (process.env.NODE_ENV === 'development') {
            this._log('DEBUG', message, ...args)
        }
    }

    _log(level, message, ...args) {
        const timestamp = getTimestamp()

        // Determine colors
        const levelColor = level === 'ERROR' ? COLORS.red : (level === 'WARN' ? COLORS.yellow : COLORS.reset)
        const sourceColor = SOURCE_COLORS[this.source] || COLORS.reset
        const contextColor = COLORS.white // Context mostly white/reset

        // Format args safely
        const formattedArgs = args.map(arg => {
            if (arg instanceof Error) return arg.stack || arg.message
            if (typeof arg === 'object') return JSON.stringify(arg, null, 2)
            return arg
        }).join(' ')

        const fullMessage = `${message} ${formattedArgs}`.trim()

        // Standardized Format: [TIMESTAMP] [LEVEL] [SOURCE] [Context] Message
        // Colors applied to the brackets and content appropriately
        const consoleMsg = `${COLORS.gray}[${timestamp}]${COLORS.reset} ${levelColor}[${level}]${COLORS.reset} ${sourceColor}[${this.source}]${COLORS.reset} ${contextColor}[${this.context}]${COLORS.reset} ${fullMessage}`

        console.log(consoleMsg)

        // Webhook Output (skip DEBUG)
        if (level !== 'DEBUG') {
            sendToWebhook(level, fullMessage, this.source, this.context)
        }
    }

    // --- Static Methods for backward compatibility or quick usage ---

    static info(message, ...args) {
        new Logger('Global', 'SYSTEM').info(message, ...args)
    }

    static warn(message, ...args) {
        new Logger('Global', 'SYSTEM').warn(message, ...args)
    }

    static error(message, ...args) {
        new Logger('Global', 'SYSTEM').error(message, ...args)
    }

    static debug(message, ...args) {
        new Logger('Global', 'SYSTEM').debug(message, ...args)
    }
}

module.exports = Logger
