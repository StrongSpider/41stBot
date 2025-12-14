"use strict"

const axios = require("axios")
const { HttpsProxyAgent } = require("https-proxy-agent")
const path = require("path")
const fs = require("fs")

const config = require("../../config.json")

const WEBSHARE_API_KEY = config.WEBSHARE_API_KEY // used by updater script, not here
const WEBSHARE_PROXIES = config.WEBSHARE_PROXIES // optional: array of full proxy URLs like "http://user:pass@host:port"

const WEBSHARE_USERNAME = config.WEBSHARE_USERNAME
const WEBSHARE_PASSWORD = config.WEBSHARE_PASSWORD
const WEBSHARE_HOST = config.WEBSHARE_HOST
const WEBSHARE_PORT = config.WEBSHARE_PORT

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
  console.warn(
    "[proxy] Webshare proxy is not fully configured. Set WEBSHARE_PROXIES, WEBSHARE_API_KEY, or WEBSHARE_USERNAME/WEBSHARE_PASSWORD/WEBSHARE_HOST/WEBSHARE_PORT."
  )
}

const proxyAgents = []
let nextProxyIndex = 0

const CACHE_DIR = path.join(__dirname, "../cache")
const PROXY_CACHE_FILE = path.join(CACHE_DIR, "webshare_proxies.json")

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
  } catch (err) {
    console.warn("[proxy] Failed to ensure cache dir:", err.message)
  }
}

function createProxyAgent(url) {
  if (!url || typeof url !== "string") return

  try {
    proxyAgents.push(new HttpsProxyAgent(url))
  } catch (err) {
    console.warn(`[proxy] Failed to create proxy agent for URL ${url}:`, err.message)
  }
}

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
      console.warn("[proxy] Cache file is not an array, ignoring")
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
      console.log(`[proxy] Loaded ${added} proxies from cache`)
    }
  } catch (err) {
    console.warn("[proxy] Failed to read proxy cache file:", err.message)
  }
}

function logProxyPool() {
  if (proxyAgents.length === 0) {
    console.warn("[proxy] Proxy pool is empty, requests will go direct")
  } else {
    console.log("[proxy] Proxy pool size:", proxyAgents.length)
  }
}

// Helper to detect Roblox API URLs
function isRobloxUrl(url) {
  if (typeof url !== "string") return false
  return /(^https?:\/\/)?([^.]+\.)*roblox\.com(\/|$)/i.test(url)
}

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

function removeProxyAgent(agent) {
  if (!agent) return
  const index = proxyAgents.indexOf(agent)
  if (index === -1) return

  proxyAgents.splice(index, 1)

  if (proxyAgents.length === 0) {
    nextProxyIndex = 0
    console.warn("[proxy] All proxy agents removed, no proxies left in pool")
    return
  }

  if (nextProxyIndex >= proxyAgents.length) {
    nextProxyIndex = 0
  }
}

function getNextProxyAgent() {
  if (proxyAgents.length === 0) return undefined
  const agent = proxyAgents[nextProxyIndex]
  nextProxyIndex = (nextProxyIndex + 1) % proxyAgents.length
  return agent
}

// Initialize proxies once at module load
initProxiesFromConfig()
loadProxiesFromCache()
logProxyPool()

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

      console.warn(
        "[proxy] request error",
        {
          method,
          url,
          status,
          attempt,
          duration,
          code: err && err.code,
          message: err && err.message ? err.message : err,
        }
      )

      if (status === 407 && proxyAgent) {
        console.warn("[proxy] Got 407 Proxy Authentication Required, removing bad proxy and retrying")
        removeProxyAgent(proxyAgent)

        if (proxyAgents.length > 0) {
          continue
        }
      } else if (proxyAgent && isNetworkOrTlsError(err)) {
        console.warn("[proxy] Network/TLS error through proxy, removing proxy and retrying", {
          code: err.code,
          message: err.message,
        })
        removeProxyAgent(proxyAgent)

        if (proxyAgents.length > 0) {
          continue
        }
      }

      throw err
    }
  }
}

async function get(url, options = {}) {
  const res = await request({
    method: "GET",
    url,
    ...options,
  })

  return res.data
}

async function post(url, data, options = {}) {
  const res = await request({
    method: "POST",
    url,
    data,
    ...options,
  })

  return res.data
}

async function batchGet(
  urls,
  options = {},
  maxRetries = 2,
  maxConcurrent = 100,
  perAttemptTimeoutMs = 30000,
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
          console.warn("[proxy] Failed to parse Retry-After header", {
            url,
            attempt: attemptLabel,
            error: parseErr && parseErr.message ? parseErr.message : parseErr,
          })
        }

        console.warn(
          "[proxy] batchGet 429, backing off",
          { url, attempt: attemptLabel, backoff }
        )
        await sleep(backoff)
        return getWithRetry(url, attempt + 1)
      }

      if (attempt < maxRetries) {
        console.warn(
          "[proxy] batchGet attempt failed, retrying",
          {
            url,
            attempt: attemptLabel,
            status,
            message: err && err.message ? err.message : err,
          }
        )
        return getWithRetry(url, attempt + 1)
      }

      console.warn(
        "[proxy] batchGet giving up after attempts",
        {
          url,
          attempts: attemptLabel,
          status,
          message: err && err.message ? err.message : err,
        }
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