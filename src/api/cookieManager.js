'use strict'

const fs = require('fs')
const path = require('path')
const Logger = require('./logger.js')

const config = require('../../config.json')

const logger = new Logger('CookieManager', 'API')

// In-memory cookie storage
let currentCookie = config.ROBLOX_COOKIE || ''

// Path to persist cookie updates
const COOKIE_CACHE_PATH = path.join(__dirname, '../../.cookie_cache')

/**
 * Initialize cookie from config or cache
 */
function initCookie() {
    // Try to load from cache first (previous updates)
    if (fs.existsSync(COOKIE_CACHE_PATH)) {
        try {
            const cached = fs.readFileSync(COOKIE_CACHE_PATH, 'utf-8').trim()
            if (cached) {
                currentCookie = cached
                logger.info('Loaded cookie from cache')
                return
            }
        } catch (e) {
            logger.warn('Failed to load cached cookie:', e.message)
        }
    }
    
    // Fall back to config
    if (currentCookie) {
        logger.info('Using cookie from config.json')
    } else {
        logger.warn('No ROBLOX_COOKIE found in config or cache')
    }
}

/**
 * Get the current cookie value
 * @returns {string}
 */
function getCookie() {
    return currentCookie
}

/**
 * Get the current cookie in header format
 * @returns {string}
 */
function getCookieHeader() {
    return `.ROBLOSECURITY=${currentCookie}`
}

/**
 * Update the cookie value and persist to cache
 * @param {string} newCookie - The new cookie value
 * @returns {boolean} - True if cookie was updated, false if invalid
 */
function updateCookie(newCookie) {
    if (!newCookie || typeof newCookie !== 'string') {
        logger.warn('Invalid cookie update attempted')
        return false
    }

    const trimmed = newCookie.trim()
    
    // Basic validation: new cookie should be different and not empty
    if (!trimmed || trimmed === currentCookie) {
        return false
    }

    currentCookie = trimmed
    
    // Persist to cache file
    try {
        fs.writeFileSync(COOKIE_CACHE_PATH, currentCookie, 'utf-8')
        logger.info('Cookie updated and cached')
        return true
    } catch (e) {
        logger.error('Failed to cache cookie update:', e.message)
        // Still return true since cookie is updated in memory
        return true
    }
}

/**
 * Parse Set-Cookie header and extract ROBLOSECURITY cookie value
 * Handles formats like: .ROBLOSECURITY=value; Path=/; secure; HttpOnly
 * @param {string|string[]} setCookieHeader - The Set-Cookie header value(s)
 * @returns {string|null} - The extracted cookie value or null
 */
function extractCookieFromSetCookieHeader(setCookieHeader) {
    if (!setCookieHeader) return null

    // Handle both string and array of strings
    const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]

    for (const header of headers) {
        if (typeof header !== 'string') continue

        // Look for .ROBLOSECURITY=... pattern
        const match = header.match(/^\.ROBLOSECURITY=([^;]+)/)
        if (match && match[1]) {
            return match[1].trim()
        }
    }

    return null
}

/**
 * Create an axios response interceptor for handling Set-Cookie headers
 * @param {import('axios').AxiosInstance} axiosInstance
 */
function attachResponseInterceptor(axiosInstance) {
    axiosInstance.interceptors.response.use(
        response => {
            const setCookieHeader = response.headers['set-cookie']
            if (setCookieHeader) {
                const newCookie = extractCookieFromSetCookieHeader(setCookieHeader)
                if (newCookie) {
                    logger.info('Received Set-Cookie header with new ROBLOSECURITY cookie')
                    updateCookie(newCookie)
                    // Update the header for subsequent requests
                    axiosInstance.defaults.headers.Cookie = getCookieHeader()
                }
            }
            return response
        },
        error => {
            // Also check for Set-Cookie in error responses
            if (error.response && error.response.headers) {
                const setCookieHeader = error.response.headers['set-cookie']
                if (setCookieHeader) {
                    const newCookie = extractCookieFromSetCookieHeader(setCookieHeader)
                    if (newCookie) {
                        logger.info('Received Set-Cookie header in error response with new ROBLOSECURITY cookie')
                        updateCookie(newCookie)
                        // Update the header for subsequent requests
                        axiosInstance.defaults.headers.Cookie = getCookieHeader()
                    }
                }
            }
            return Promise.reject(error)
        }
    )
}

// Initialize on module load
initCookie()

module.exports = {
    getCookie,
    getCookieHeader,
    updateCookie,
    extractCookieFromSetCookieHeader,
    attachResponseInterceptor
}
