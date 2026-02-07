"use strict"

const axios = require("axios")
const fs = require("fs")
const path = require("path")
const Logger = require("../api/logger")
const config = require("../../config.json")
const { API_KEY: WEBSHARE_API_KEY, PROXY_LIST_URL: WEBSHARE_PROXY_LIST_URL, USERNAME: WEBSHARE_USERNAME, PASSWORD: WEBSHARE_PASSWORD, HOST: WEBSHARE_HOST, PORT: WEBSHARE_PORT } = config.WEBSHARE

const CACHE_DIR = path.join(__dirname, "..", "cache")
const PROXY_CACHE_FILE = path.join(CACHE_DIR, "webshare_proxies.json")

const logger = new Logger('ProxyUpdater', 'UPDATER')

if (!WEBSHARE_API_KEY || !WEBSHARE_PROXY_LIST_URL) {
  logger.error("WEBSHARE_API_KEY and WEBSHARE_PROXY_LIST_URL must be set in config.json")
  process.exit(1)
}

/**
 * Ensure the cache directory exists
 */
function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
  } catch (err) {
    logger.error("Failed to ensure cache dir:", err.message)
    process.exit(1)
  }
}

/**
 * Fetch all pages of proxies from the Webshare API
 * @param {number} maxPages Maximum number of pages to fetch
 * @returns {Promise<string[]>} Array of proxy URLs
 */
async function fetchAllProxies(maxPages = 4) {
  const urls = []

  for (let page = 1; page <= maxPages; page++) {
    try {
      const response = await axios.get(WEBSHARE_PROXY_LIST_URL, {
        headers: { Authorization: `Token ${WEBSHARE_API_KEY}` },
        timeout: 15000,
        params: { page },
      })

      const results = response.data && response.data.results
      if (!Array.isArray(results) || results.length === 0) {
        logger.info(`No results on page ${page}, stopping pagination`)
        break
      }

      logger.info(`Loaded ${results.length} proxies from API page ${page}`)

      for (const p of results) {
        const username = p.username || WEBSHARE_USERNAME
        const password = p.password || WEBSHARE_PASSWORD
        const host = p.proxy_address || WEBSHARE_HOST
        const port = p.port || WEBSHARE_PORT

        if (!username || !password || !host || !port) continue

        const url = `http://${username}:${password}@${host}:${port}`
        urls.push(url)
      }
    } catch (err) {
      logger.error("Failed to fetch Webshare proxy list page", page, ":", err.message)
      break
    }
  }

  // Deduplicate
  const unique = Array.from(new Set(urls))
  logger.info(`Total unique proxies collected: ${unique.length}`)
  return unique
}

/**
 * Main entry point for the proxy updater script
 */
async function main() {
  ensureCacheDir()

  const urls = await fetchAllProxies(4)

  try {
    fs.writeFileSync(PROXY_CACHE_FILE, JSON.stringify(urls, null, 2), "utf8")
    logger.info(`Wrote ${urls.length} proxies to ${PROXY_CACHE_FILE}`)
  } catch (err) {
    logger.error("Failed to write proxy cache file:", err.message)
    process.exit(1)
  }
}

main().catch(err => {
  logger.error("Unhandled error:", err)
  process.exit(1)
})
