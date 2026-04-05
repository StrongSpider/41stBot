const path = require('node:path')
const { loadCommandRegistry, normalizeCommandName } = require('../../bot/commandRegistry.js')

describe('commandRegistry', () => {
    it('removes dashes from command and subcommand names', () => {
        expect(normalizeCommandName('verify-force')).toBe('verifyforce')
        expect(normalizeCommandName('id-from-message')).toBe('idfrommessage')
    })

    it('leaves names without dashes unchanged', () => {
        expect(normalizeCommandName('event')).toBe('event')
        expect(normalizeCommandName('type')).toBe('type')
        expect(normalizeCommandName('8ball')).toBe('8ball')
    })

    it('splits dashed command names into grouped slash commands where configured', () => {
        const logger = { warn: jest.fn(), error: jest.fn() }
        const registry = loadCommandRegistry(path.join(process.cwd(), 'src/bot/commands'), logger)

        const verify = registry.deploymentCommands.find(command => command.name === 'verify')
        expect(verify).toBeTruthy()
        expect(verify.options.map(option => option.name)).toEqual(expect.arrayContaining(['start', 'force']))

        const event = registry.deploymentCommands.find(command => command.name === 'event')
        expect(event).toBeTruthy()
        expect(event.options.map(option => option.name)).toEqual(expect.arrayContaining(['get', 'log', 'list', 'type']))

        const reviewer = registry.deploymentCommands.find(command => command.name === 'reviewer')
        expect(reviewer).toBeTruthy()
        expect(reviewer.options.map(option => option.name)).toEqual(expect.arrayContaining(['top', 'list', 'reset']))
    })
})
