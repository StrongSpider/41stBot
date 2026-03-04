const { PermissionsBitField } = require('discord.js')

jest.mock('../../../config.json', () => ({
    DISCORD: {
        ROLES: {
            FFCNC: 'ffc',
            HICOM: 'hicom',
            OFFICER: 'officer',
            MINOR_OFFICER: 'minor',
            CMOTW: 'cmotw'
        },
        BOT: {
            DEVELOPER_USER_ID: 'developer'
        }
    }
}))

jest.mock('../../api/database.js', () => ({
    getEventEpLock: jest.fn().mockResolvedValue(null),
    isEventEpLockError: jest.fn().mockReturnValue(false)
}))

jest.mock('../../api/logger.js', () => jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
})))

jest.mock('../../bot/utils/eventEpLock.js', () => ({
    formatEventEpLockMessage: jest.fn().mockReturnValue('Event EP is locked.')
}))

const commandHandler = require('../../bot/events/interactionCreate/command.js')
const LoggerClass = require('../../api/logger.js')

function createInteraction({ command, userId, isAdmin = false }) {
    return {
        commandName: 'secure-command',
        user: {
            id: userId,
            username: userId
        },
        member: {
            roles: {
                cache: new Map()
            },
            permissions: new PermissionsBitField(
                isAdmin ? PermissionsBitField.Flags.Administrator : undefined
            )
        },
        memberPermissions: new PermissionsBitField(
            isAdmin ? PermissionsBitField.Flags.Administrator : undefined
        ),
        client: {
            commands: new Map([['secure-command', command]])
        },
        isChatInputCommand: () => true,
        isContextMenuCommand: () => false,
        inGuild: () => true,
        isRepliable: () => true,
        reply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue(undefined)
    }
}

function createSubcommandInteraction({ groupCommand, resolvedCommand, userId, isAdmin = false, subcommandGroup = null, subcommand = 'edit' }) {
    return {
        commandName: groupCommand,
        user: {
            id: userId,
            username: userId
        },
        member: {
            roles: {
                cache: new Map()
            },
            permissions: new PermissionsBitField(
                isAdmin ? PermissionsBitField.Flags.Administrator : undefined
            )
        },
        memberPermissions: new PermissionsBitField(
            isAdmin ? PermissionsBitField.Flags.Administrator : undefined
        ),
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue(subcommandGroup),
            getSubcommand: jest.fn().mockReturnValue(subcommand)
        },
        client: {
            commands: new Map([[
                groupCommand,
                {
                    resolve: jest.fn().mockReturnValue(resolvedCommand)
                }
            ]])
        },
        isChatInputCommand: () => true,
        isContextMenuCommand: () => false,
        inGuild: () => true,
        isRepliable: () => true,
        reply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue(undefined)
    }
}

describe('interactionCreate/command', () => {
    it('lets guild administrators execute restricted slash commands', async () => {
        const command = {
            permission: 'OFFICER',
            execute: jest.fn().mockResolvedValue(undefined)
        }
        const interaction = createInteraction({
            command,
            userId: 'admin-user',
            isAdmin: true
        })

        await commandHandler(interaction)

        expect(command.execute).toHaveBeenCalledWith(interaction)
        expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('still blocks regular members from restricted slash commands', async () => {
        const command = {
            permission: 'OFFICER',
            execute: jest.fn().mockResolvedValue(undefined)
        }
        const interaction = createInteraction({
            command,
            userId: 'regular-user'
        })

        await commandHandler(interaction)

        expect(command.execute).not.toHaveBeenCalled()
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: '<:warning:1297618648810393630> You do not have permission to use this command.'
        }))
    })

    it('resolves grouped slash commands before checking permissions', async () => {
        const command = {
            permission: 'OFFICER',
            execute: jest.fn().mockResolvedValue(undefined)
        }
        const interaction = createSubcommandInteraction({
            groupCommand: 'event',
            resolvedCommand: command,
            userId: 'admin-user',
            isAdmin: true,
            subcommandGroup: 'type',
            subcommand: 'add'
        })

        await commandHandler(interaction)

        expect(command.execute).toHaveBeenCalledWith(interaction)
        expect(interaction.reply).not.toHaveBeenCalled()

        const logger = LoggerClass.mock.results[0].value
        expect(logger.info.mock.calls.at(-1)).toEqual([
            'Received command:',
            'event type add',
            'from',
            'admin-user',
            '(',
            'admin-user',
            ')'
        ])
    })
})
