

const { updateCache } = require('./api/blacklists')
const Logger = require('./api/logger')
const config = require('../config.json')

// Board ID for the Trello blacklist board. Prefer config, fall back to env.
const BLACKLIST_BOARD_ID = config.BLACKLIST_BOARD_ID

if (!BLACKLIST_BOARD_ID) {
  throw new Error('BLACKLIST_BOARD_ID is not set in config.json or environment')
}

const ONE_HOUR_MS = 60 * 60 * 1000

/**
 * Run a single update cycle for the blacklist cache.
 */
async function runUpdateOnce() {
  const logger = new Logger('BlacklistUpdater', 'UPDATER')
  const start = new Date()
  logger.info(`Starting cache update at ${start.toISOString()}`)

  try {
    const cache = await updateCache(BLACKLIST_BOARD_ID)
    logger.info(
      `Cache updated successfully at ${cache.updatedAt} for board ${cache.boardId}`
    )
  } catch (err) {
    logger.error('Error updating cache:', err && err.stack ? err.stack : err)
  }
}

// Handle unhandled promise rejections so the process does not crash silently
process.on('unhandledRejection', err => {
  new Logger('BlacklistUpdater', 'UPDATER').error('Unhandled rejection:', err && err.stack ? err.stack : err)
})

// Run immediately on start
runUpdateOnce()

// Then run every 1 hour
setInterval(runUpdateOnce, ONE_HOUR_MS)