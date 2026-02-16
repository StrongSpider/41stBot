"use strict"

const axios = require("axios")
const { HttpsProxyAgent } = require("https-proxy-agent")
const path = require("path")
const fs = require("fs")
const Logger = require("./logger.js")

const config = require("../../config.json")

const WEBSHARE_API_KEY = config.WEBSHARE.API_KEY // used by updater script, not here
const WEBSHARE_PROXIES = config.WEBSHARE.PROXIES // optional: array of full proxy URLs like "http://user:pass@host:port"

const WEBSHARE_USERNAME = config.WEBSHARE.USERNAME
const WEBSHARE_PASSWORD = config.WEBSHARE.PASSWORD
const WEBSHARE_HOST = config.WEBSHARE.HOST
const WEBSHARE_PORT = config.WEBSHARE.PORT

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

const axiosInstance = axios.create({
  headers: {
    "User-Agent": DEFAULT_USER_AGENT,
  },
})

if (
  !Array.isArray(WEBSHARE_PROXIES) &&
  !WEBSHARE_API_KEY &&
  (!WEBSHARE_USERNAME || !WEBSHARE_PASSWORD || !WEBSHARE_HOST || !WEBSHARE_PORT)
) {
  Logger.warn(
    "[proxy] Webshare proxy is not fully configured. Set WEBSHARE_PROXIES, WEBSHARE_API_KEY, or WEBSHARE_USERNAME/WEBSHARE_PASSWORD/WEBSHARE_HOST/WEBSHARE_PORT."
  )
}

const proxyAgents = []
let nextProxyIndex = 0

const CACHE_DIR = path.join(__dirname, "../cache")
const PROXY_CACHE_FILE = path.join(CACHE_DIR, "webshare_proxies.json")

/**
 * Ensure logic cache directory exists
 */
function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
  } catch (err) {
    Logger.warn("[proxy] Failed to ensure cache dir: " + err.message)
  }
}

/**
 * Create a new HTTPS proxy agent from a URL
 * @param {string} url Proxy URL
 */
function createProxyAgent(url) {
  if (!url || typeof url !== "string") return

  try {
    proxyAgents.push(new HttpsProxyAgent(url))
  } catch (err) {
    Logger.warn(`[proxy] Failed to create proxy agent for URL ${url}: ${err.message}`)
  }
}

/**
 * Initialize proxy agents from config (Env vars)
 */
function initProxiesFromConfig() {
  if (Array.isArray(WEBSHARE_PROXIES) && WEBSHARE_PROXIES.length > 0) {
    for (const url of WEBSHARE_PROXIES) {
      createProxyAgent(url)
    }
    return
  }

  if (WEBSHARE_USERNAME && WEBSHARE_PASSWORD && WEBSHARE_HOST && WEBSHARE_PORT) {
    const url = `http://${WEBSHARE_USERNAME}:${WEBSHARE_PASSWORD}@${WEBSHARE_HOST}:${WEBSHARE_PORT}`
    createProxyAgent(url)
  }
}

/**
 * Load proxies from JSON cache file
 */
function loadProxiesFromCache() {
  ensureCacheDir()

  if (!fs.existsSync(PROXY_CACHE_FILE)) {
    return
  }

  try {
    const raw = fs.readFileSync(PROXY_CACHE_FILE, "utf8")
    if (!raw) return

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      Logger.warn("[proxy] Cache file is not an array, ignoring")
      return
    }

    let added = 0
    for (const entry of parsed) {
      const url = typeof entry === "string" ? entry : entry && entry.url
      if (!url || typeof url !== "string") continue

      const alreadyHave = proxyAgents.some(agent => agent.proxy && agent.proxy.href === url)
      if (alreadyHave) continue

      createProxyAgent(url)
      added++
    }

    if (added > 0) {
      Logger.info(`[proxy] Loaded ${added} proxies from cache`)
    }
  } catch (err) {
    Logger.warn("[proxy] Failed to read proxy cache file: " + err.message)
  }
}

/**
 * Log current size of proxy pool
 */
function logProxyPool() {
  if (proxyAgents.length === 0) {
    Logger.warn("[proxy] Proxy pool is empty, requests will go direct")
  } else {
    Logger.info("[proxy] Proxy pool size: " + proxyAgents.length)
  }
}

/**
 * Check if a URL is a Roblox URL
 * @param {string} url 
 * @returns {boolean}
 */
function isRobloxUrl(url) {
  if (typeof url !== "string") return false
  return /(^https?:\/\/)?([^.]+\.)*roblox\.com(\/|$)/i.test(url)
}

/**
 * Check if an error is a network or TLS error (retryable)
 * @param {Error} err 
 * @returns {boolean}
 */
function isNetworkOrTlsError(err) {
  if (!err) return false

  const code = err.code
  const msg = err.message || ""

  const networkCodes = [
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "EAI_AGAIN",
  ]

  if (code && networkCodes.includes(code)) {
    return true
  }

  if (msg.includes("Client network socket disconnected before secure TLS connection was established")) {
    return true
  }

  return false
}

/**
 * Remove a proxy agent from the pool
 * @param {any} agent 
 */
function removeProxyAgent(agent) {
  if (!agent) return
  const index = proxyAgents.indexOf(agent)
  if (index === -1) return

  proxyAgents.splice(index, 1)

  if (proxyAgents.length === 0) {
    nextProxyIndex = 0
    Logger.warn("[proxy] All proxy agents removed, no proxies left in pool")
    return
  }

  if (nextProxyIndex >= proxyAgents.length) {
    nextProxyIndex = 0
  }
}

/**
 * Get the next proxy agent in round-robin
 * @returns {any} Proxy Agent or undefined
 */
function getNextProxyAgent() {
  if (proxyAgents.length === 0) return undefined
  const agent = proxyAgents[nextProxyIndex]
  nextProxyIndex = (nextProxyIndex + 1) % proxyAgents.length
  return agent
}

// Initialize proxies once at module load
// initProxiesFromConfig() // DISABLED: Only use proxies from the json file
loadProxiesFromCache()
logProxyPool()

/**
 * Make an HTTP request using a proxy
 * @param {import('axios').AxiosRequestConfig} config 
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function request(config) {
  let attempt = 0

  while (true) {
    attempt += 1

    const proxyAgent = getNextProxyAgent()

    const finalConfig = {
      timeout: 15000,
      ...config,
    }

    if (proxyAgent) {
      finalConfig.httpAgent = proxyAgent
      finalConfig.httpsAgent = proxyAgent
    }

    if (!finalConfig.headers) {
      finalConfig.headers = {}
    }

    if (!finalConfig.headers["User-Agent"]) {
      finalConfig.headers["User-Agent"] = DEFAULT_USER_AGENT
    }

    const attemptStart = Date.now()
    const method = (finalConfig.method || "GET").toUpperCase()
    const url = finalConfig.url

    try {
      const res = await axiosInstance(finalConfig)
      const duration = Date.now() - attemptStart

      // console.log(
      //   "[proxy] request success",
      //   { method, url, status: res.status, attempt, duration }
      // )

      return res
    } catch (err) {
      const duration = Date.now() - attemptStart
      const status = err && err.response && err.response.status

      Logger.warn(
        "[proxy] request error " +
        JSON.stringify({
          method,
          url,
          status,
          attempt,
          duration,
          code: err && err.code,
          message: err && err.message ? err.message : err,
        })
      )

      if ((status === 407 || status === 427) && proxyAgent) {
        Logger.warn(`[proxy] Got ${status} through proxy, removing bad proxy and retrying`)
        removeProxyAgent(proxyAgent)

        if (proxyAgents.length > 0) {
          continue
        }
      } else if (proxyAgent && isNetworkOrTlsError(err)) {
        Logger.warn("[proxy] Network/TLS error through proxy, removing proxy and retrying " + JSON.stringify({
          code: err.code,
          message: err.message,
        }))
        removeProxyAgent(proxyAgent)

        if (proxyAgents.length > 0) {
          continue
        }
      }

      throw err
    }
  }
}

/**
 * Helper to perform GET request with proxy
 * @param {string} url 
 * @param {import('axios').AxiosRequestConfig} [options] 
 * @returns {Promise<any>} Response Data
 */
async function get(url, options = {}) {
  const res = await request({
    method: "GET",
    url,
    ...options,
  })

  return res.data
}

/**
 * Helper to perform POST request with proxy
 * @param {string} url 
 * @param {any} data 
 * @param {import('axios').AxiosRequestConfig} [options] 
 * @returns {Promise<any>} Response Data
 */
async function post(url, data, options = {}) {
  const res = await request({
    method: "POST",
    url,
    data,
    ...options,
  })

  return res.data
}

/**
 * Batch GET requests with concurrency control and retries
 * @param {string[]} urls 
 * @param {import('axios').AxiosRequestConfig} [options] 
 * @param {number} [maxRetries] 
 * @param {number} [maxConcurrent] 
 * @param {number} [perAttemptTimeoutMs] 
 * @param {boolean} [protect429] 
 * @returns {Promise<any[]>}
 */
async function batchGet(
  urls,
  options = {},
  maxRetries = 2,
  maxConcurrent = 100,
  perAttemptTimeoutMs = 5000,
  protect429 = false
) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  async function getWithRetry(url, attempt = 0) {
    const attemptLabel = attempt + 1

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), perAttemptTimeoutMs)

      try {
        const result = await get(url, {
          ...options,
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        return result
      } catch (err) {
        clearTimeout(timeoutId)

        if (controller.signal.aborted) {
          const timeoutError = new Error(
            `batchGet timeout after ${perAttemptTimeoutMs}ms on attempt ${attemptLabel} for URL: ${url}`
          )
          timeoutError.cause = err
          throw timeoutError
        }

        throw err
      }
    } catch (err) {
      const status = err && err.response && err.response.status

      if (protect429 && status === 429 && attempt < maxRetries) {
        let backoff = Math.min(60000, 1000 * Math.pow(2, attempt))

        try {
          const headers = err && err.response && err.response.headers
          if (headers) {
            const retryAfterRaw = headers["retry-after"] || headers["Retry-After"]
            if (retryAfterRaw) {
              let retryMs = NaN

              const seconds = parseInt(retryAfterRaw, 10)
              if (!Number.isNaN(seconds) && seconds >= 0) {
                retryMs = seconds * 1000
              } else {
                const retryDate = Date.parse(retryAfterRaw)
                if (!Number.isNaN(retryDate)) {
                  const diff = retryDate - Date.now()
                  if (diff > 0) {
                    retryMs = diff
                  }
                }
              }

              if (!Number.isNaN(retryMs)) {
                backoff = Math.min(60000, retryMs)
              }
            }
          }
        } catch (parseErr) {
          Logger.warn("[proxy] Failed to parse Retry-After header " + JSON.stringify({
            url,
            attempt: attemptLabel,
            error: parseErr && parseErr.message ? parseErr.message : parseErr,
          }))
        }

        Logger.warn(
          "[proxy] batchGet 429, backing off " +
          JSON.stringify({ url, attempt: attemptLabel, backoff })
        )
        await sleep(backoff)
        return getWithRetry(url, attempt + 1)
      }

      if (attempt < maxRetries) {
        Logger.warn(
          "[proxy] batchGet attempt failed, retrying " +
          JSON.stringify({
            url,
            attempt: attemptLabel,
            status,
            message: err && err.message ? err.message : err,
          })
        )
        return getWithRetry(url, attempt + 1)
      }

      Logger.warn(
        "[proxy] batchGet giving up after attempts " +
        JSON.stringify({
          url,
          attempts: attemptLabel,
          status,
          message: err && err.message ? err.message : err,
        })
      )
      throw err
    }
  }

  if (!Array.isArray(urls) || urls.length === 0) {
    return []
  }

  const results = new Array(urls.length)
  let index = 0
  const workers = []
  const workerCount = Math.min(maxConcurrent, urls.length)

  async function worker() {
    while (true) {
      const currentIndex = index++
      if (currentIndex >= urls.length) {
        return
      }

      const url = urls[currentIndex]
      results[currentIndex] = await getWithRetry(url)
    }
  }

  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }

  await Promise.all(workers)

  return results
}

module.exports = {
  request,
  get,
  post,
  batchGet,
}