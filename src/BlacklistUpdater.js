

const { updateCache } = require('./api/blacklists')
const config = require('../config.json')

// Board ID for the Trello blacklist board. Prefer config, fall back to env.
const BLACKLIST_BOARD_ID = config.BLACKLIST_BOARD_ID

if (!BLACKLIST_BOARD_ID) {
  throw new Error('BLACKLIST_BOARD_ID is not set in config.json or environment')
}

const ONE_HOUR_MS = 60 * 60 * 1000

async function runUpdateOnce() {
  const start = new Date()
  console.log(`[BlacklistUpdater] Starting cache update at ${start.toISOString()}`)

  try {
    const cache = await updateCache(BLACKLIST_BOARD_ID)
    console.log(
      `[BlacklistUpdater] Cache updated successfully at ${cache.updatedAt} for board ${cache.boardId}`
    )
  } catch (err) {
    console.error('[BlacklistUpdater] Error updating cache:', err && err.stack ? err.stack : err)
  }
}

// Handle unhandled promise rejections so the process does not crash silently
process.on('unhandledRejection', err => {
  console.error('[BlacklistUpdater] Unhandled rejection:', err && err.stack ? err.stack : err)
})

// Run immediately on start
runUpdateOnce()

// Then run every 1 hour
setInterval(runUpdateOnce, ONE_HOUR_MS)