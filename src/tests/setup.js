jest.setTimeout(10000)

const path = require('node:path')

const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g
const loggerModulePath = path.resolve(__dirname, '../api/logger.js')

function normalizeArg(arg) {
    if (arg instanceof Error) {
        return arg.stack || arg.message
    }

    if (typeof arg === 'string') {
        return arg
    }

    if (arg === undefined) {
        return 'undefined'
    }

    try {
        return JSON.stringify(arg)
    } catch {
        return String(arg)
    }
}

function normalizeMessage(parts) {
    return parts
        .map(normalizeArg)
        .join(' ')
        .replace(ANSI_ESCAPE_PATTERN, '')
        .trim()
}

function matchesEntry(entry, matcher) {
    if (typeof matcher === 'string') {
        return entry.message.includes(matcher)
    }

    if (matcher instanceof RegExp) {
        return matcher.test(entry.message)
    }

    if (typeof matcher === 'function') {
        return Boolean(matcher(entry))
    }

    return false
}

function consumeAllowedEntries(entries, allowedMatchers) {
    const remainingMatchers = [...allowedMatchers]
    const unexpectedEntries = []

    for (const entry of entries) {
        const matchedIndex = remainingMatchers.findIndex(matcher => matchesEntry(entry, matcher))
        if (matchedIndex === -1) {
            unexpectedEntries.push(entry)
            continue
        }

        remainingMatchers.splice(matchedIndex, 1)
    }

    return { unexpectedEntries, remainingMatchers }
}

function createHarnessState() {
    return {
        loggerErrors: [],
        consoleErrors: [],
        allowedLoggerErrors: [],
        allowedConsoleErrors: []
    }
}

let harnessState = createHarnessState()

global.allowLoggerErrors = (...matchers) => {
    harnessState.allowedLoggerErrors.push(...matchers)
}

global.allowConsoleErrors = (...matchers) => {
    harnessState.allowedConsoleErrors.push(...matchers)
}

const originalConsoleError = console.error.bind(console)
console.error = (...args) => {
    harnessState.consoleErrors.push({
        source: 'console.error',
        message: normalizeMessage(args)
    })

    return originalConsoleError(...args)
}

jest.doMock('discord.js', () => {
    const actualDiscord = jest.requireActual('discord.js')

    return {
        ...actualDiscord,
        WebhookClient: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({ id: 'mock-webhook-message' })
        }))
    }
})

jest.doMock(loggerModulePath, () => {
    const ActualLogger = jest.requireActual(loggerModulePath)

    return class TestAwareLogger extends ActualLogger {
        _log(level, message, ...args) {
            if (level === 'ERROR') {
                harnessState.loggerErrors.push({
                    source: 'logger.error',
                    message: normalizeMessage([message, ...args]),
                    context: this.context,
                    loggerSource: this.source
                })
            }

            return super._log(level, message, ...args)
        }
    }
})

beforeEach(() => {
    harnessState = createHarnessState()
})

afterEach(() => {
    const loggerResults = consumeAllowedEntries(harnessState.loggerErrors, harnessState.allowedLoggerErrors)
    const consoleResults = consumeAllowedEntries(harnessState.consoleErrors, harnessState.allowedConsoleErrors)

    const failures = []

    if (loggerResults.unexpectedEntries.length > 0) {
        failures.push(
            ...loggerResults.unexpectedEntries.map(entry => `[logger.error] ${entry.message}`)
        )
    }

    if (consoleResults.unexpectedEntries.length > 0) {
        failures.push(
            ...consoleResults.unexpectedEntries.map(entry => `[console.error] ${entry.message}`)
        )
    }

    if (failures.length > 0) {
        throw new Error(`Unexpected error logs were emitted:\n${failures.join('\n')}`)
    }
})

afterAll(async () => {
    const databasePath = path.resolve(__dirname, '../api/database/index.js')
    const cachedDatabase = require.cache[databasePath]
    const disconnectDatabase = cachedDatabase && cachedDatabase.exports && cachedDatabase.exports.disconnectDatabase

    if (typeof disconnectDatabase === 'function') {
        await disconnectDatabase().catch(() => {})
    }
})
