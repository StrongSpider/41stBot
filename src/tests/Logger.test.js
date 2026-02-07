const { WebhookClient, EmbedBuilder } = require('discord.js')

const mockSend = jest.fn().mockResolvedValue({ id: '123' })
const mockWebhookInstance = {
    send: mockSend
}

const mockSetDescription = jest.fn().mockReturnThis()

// Mock discord.js
jest.mock('discord.js', () => ({
    WebhookClient: jest.fn().mockImplementation(() => mockWebhookInstance),
    EmbedBuilder: jest.fn().mockImplementation(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setDescription: mockSetDescription,
        setColor: jest.fn().mockReturnThis(),
        setTimestamp: jest.fn().mockReturnThis()
    }))
}))

// Mock config to avoid missing property errors
jest.mock('../../config.json', () => ({
    DISCORD: {
        WEBHOOKS: {
            ADMIN_LOGS: 'https://discord.com/api/webhooks/mock'
        }
    }
}))

describe('Logger', () => {
    let logSpy
    let Logger

    beforeEach(() => {
        jest.resetModules()
        Logger = require('../api/logger')
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => { })
        mockSend.mockClear()
        mockSetDescription.mockClear()
    })

    afterEach(() => {
        logSpy.mockRestore()
    })

    it('should initialize with correct context and source', () => {
        const logger = new Logger('TestContext', 'SERVER')
        expect(logger.context).toBe('TestContext')
        expect(logger.source).toBe('SERVER')
    })

    it('should default source to BOT and context to Global', () => {
        const logger = new Logger()
        expect(logger.context).toBe('Global')
        expect(logger.source).toBe('BOT')
    })

    it('should log info messages to console and webhook', async () => {
        const logger = new Logger('TestContext', 'SERVER')
        logger.info('Hello World')

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('INFO'))
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SERVER'))
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('TestContext'))
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Hello World'))

        // Check if webhook was called (next tick since it's async)
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(mockSend).toHaveBeenCalled()
    })

    it('should format object arguments as JSON', () => {
        const logger = new Logger('TestContext', 'SERVER')
        logger.info('Data:', { foo: 'bar' })

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"foo": "bar"'))
    })

    it('should format Error arguments as stacks and use js codeblock', async () => {
        const logger = new Logger('TestContext', 'SERVER')
        const error = new Error('Test Error')
        logger.error('Caught error:', error)

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Error'))

        await new Promise(resolve => setTimeout(resolve, 10))
        expect(mockSetDescription).toHaveBeenCalledWith(expect.stringMatching(/```js\nCaught error: Error: Test Error/))
    })

    it('should wrap multi-line messages in codeblocks', async () => {
        const logger = new Logger('TestContext', 'SERVER')
        logger.info('Line 1\nLine 2')

        await new Promise(resolve => setTimeout(resolve, 10))
        expect(mockSetDescription).toHaveBeenCalledWith(expect.stringMatching(/```\nLine 1\nLine 2\n```/))
    })

    it('should wrap JSON strings in js codeblocks', async () => {
        const logger = new Logger('TestContext', 'SERVER')
        logger.info('{ "status": "ok" }')

        await new Promise(resolve => setTimeout(resolve, 10))
        expect(mockSetDescription).toHaveBeenCalledWith(expect.stringMatching(/```js\n\{ "status": "ok" \}\n```/))
    })

    it('should not log debug in production', () => {
        const originalEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'

        const logger = new Logger('TestContext', 'SERVER')
        logger.debug('Debug message')

        expect(logSpy).not.toHaveBeenCalled()

        process.env.NODE_ENV = originalEnv
    })

    it('should log debug in development', () => {
        const originalEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'development'

        const logger = new Logger('TestContext', 'SERVER')
        logger.debug('Debug message')

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG'))
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Debug message'))

        process.env.NODE_ENV = originalEnv
    })

    it('should not send debug logs to webhook', async () => {
        const originalEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'development'

        const logger = new Logger('TestContext', 'SERVER')
        logger.debug('Debug message')

        await new Promise(resolve => setTimeout(resolve, 10))
        expect(mockSend).not.toHaveBeenCalled()

        process.env.NODE_ENV = originalEnv
    })

    describe('Static Methods', () => {
        it('should log info statically', () => {
            Logger.info('Static Info')
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Static Info'))
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SYSTEM'))
        })

        it('should log warn statically', () => {
            Logger.warn('Static Warn')
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('WARN'))
        })

        it('should log error statically', () => {
            Logger.error('Static Error')
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR'))
        })
    })
})
