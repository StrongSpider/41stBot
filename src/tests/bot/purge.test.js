const { Collection, PermissionsBitField } = require('discord.js')

const mockCheckQuota = jest.fn()
jest.mock('../../api/quota.js', () => ({
    checkQuota: mockCheckQuota
}))

const mockDatabase = {
    setEventEpLock: jest.fn(),
    getRobloxIdByDiscord: jest.fn()
}
jest.mock('../../api/database', () => mockDatabase)

const mockRoblox = {
    getUsernameFromId: jest.fn()
}
jest.mock('../../api/roblox.js', () => mockRoblox)

jest.mock('../../../config.json', () => ({
    DISCORD: {
        ROLES: {
            FFCNC: 'ffc-role',
            EXEMPT: 'exempt-role',
            PURGE_DEFCON: 'purge-role',
            RECRUIT: 'recruit-role',
            COMPANY: {
                'trooper-company-role': 'Trooper'
            },
            RANK: {
                'personnel-role': '41st Personnel',
                'squad-leader-role': 'Squad Leader'
            },
            UNIT: []
        }
    },
    GENERAL: {
        GROUP_NAME: '41st',
        TROOPER_RANK_COMMAND: 'Trooper',
        PURGE_DEMOTION_REASON: 'Failed quota',
        PURGE_KICK_REASON: 'Failed quota',
        BYPASS_USER_IDS: ['bypass-recruit']
    }
}))

jest.mock('../../api/logger.js', () => jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
})))

const purgeCommand = require('../../bot/commands/purge.js')

function createRoleCache(roleIds) {
    return new Collection(roleIds.map(id => [id, { id }]))
}

function createMember(id, roleIds = [], options = {}) {
    const roleCache = createRoleCache(roleIds)

    return {
        id,
        nickname: options.nickname || null,
        user: {
            id,
            bot: false,
            username: `${id}Discord`,
            displayName: `${id}Display`
        },
        roles: {
            cache: roleCache,
            add: jest.fn().mockResolvedValue(true),
            remove: jest.fn().mockResolvedValue(true)
        },
        permissions: new PermissionsBitField()
    }
}

function createInteraction(members) {
    const memberCache = new Collection(members.map(member => [member.id, member]))
    const channel = {
        id: 'purge-channel',
        send: jest.fn().mockResolvedValue({ id: 'sent-message' }),
        awaitMessages: jest.fn().mockResolvedValue({
            first: () => ({
                author: { id: 'runner' },
                content: 'confirm'
            })
        })
    }

    return {
        user: { id: 'runner' },
        options: {
            getBoolean: jest.fn().mockReturnValue(true)
        },
        guild: {
            id: 'guild',
            members: {
                cache: memberCache,
                fetch: jest.fn().mockResolvedValue(memberCache)
            }
        },
        channel,
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue(undefined)
    }
}

function quotaReportFor(member, overrides = {}) {
    const roles = member.roles.cache.map(role => role.id)

    return {
        userId: member.id,
        username: `${member.id}Roblox`,
        met: true,
        metPurgeQuotas: true,
        quotas: [],
        purge: roles.includes('purge-role'),
        ...overrides
    }
}

function sentChannelText(interaction) {
    return interaction.channel.send.mock.calls.map(([payload]) => {
        if (typeof payload === 'string') return payload
        return payload?.content || ''
    })
}

function kickPrompts(interaction) {
    return sentChannelText(interaction).filter(text => text.includes('Run this slash command and also kick them from Discord'))
}

describe('purge recruit kick queue', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDatabase.setEventEpLock.mockResolvedValue(undefined)
        mockDatabase.getRobloxIdByDiscord.mockResolvedValue(null)
        mockRoblox.getUsernameFromId.mockResolvedValue('RobloxUser')
    })

    it('queues a non-exempt recruit for kicking even when quota passes', async () => {
        const recruit = createMember('regular-recruit', ['recruit-role'])
        const interaction = createInteraction([recruit])
        mockCheckQuota.mockResolvedValue(quotaReportFor(recruit))

        await purgeCommand.execute(interaction)

        expect(kickPrompts(interaction)).toEqual([
            expect.stringContaining('Kick **regular-recruitRoblox** [Recruit]')
        ])
        expect(sentChannelText(interaction)).toEqual(expect.arrayContaining([
            expect.stringContaining('# Starting kicks for 1 users.')
        ]))
    })

    it('continues with the Discord nickname fallback when Roblox username lookup misses', async () => {
        const recruit = createMember('lookup-miss-recruit', ['recruit-role'], { nickname: '[IN] Nick Recruit' })
        const interaction = createInteraction([recruit])
        mockDatabase.getRobloxIdByDiscord.mockResolvedValue(77725758)
        mockRoblox.getUsernameFromId.mockRejectedValue(new Error('User not found'))
        mockCheckQuota.mockResolvedValue({
            userId: recruit.id,
            met: true,
            metPurgeQuotas: true,
            quotas: [],
            purge: false
        })

        await purgeCommand.execute(interaction)

        expect(kickPrompts(interaction)).toEqual([
            expect.stringContaining('Kick **NickRecruit** [Recruit]')
        ])
        expect(sentChannelText(interaction)).toEqual(expect.arrayContaining([
            expect.stringContaining('Roblox username lookup failed for <@lookup-miss-recruit> (Roblox ID `77725758`). Using Discord nickname `NickRecruit` for purge prompts.')
        ]))
    })

    it('does not queue a recruit that has the exempt role', async () => {
        const recruit = createMember('exempt-role-recruit', ['recruit-role', 'exempt-role'])
        const interaction = createInteraction([recruit])
        mockCheckQuota.mockResolvedValue(quotaReportFor(recruit, { met: false, metPurgeQuotas: false }))

        await purgeCommand.execute(interaction)

        expect(kickPrompts(interaction)).toHaveLength(0)
    })

    it('does not queue a recruit whose quota report is exempt', async () => {
        const recruit = createMember('status-exempt-recruit', ['recruit-role'])
        const interaction = createInteraction([recruit])
        mockCheckQuota.mockResolvedValue({
            userId: recruit.id,
            username: 'status-exempt-recruitRoblox',
            status: 'EXEMPT'
        })

        await purgeCommand.execute(interaction)

        expect(kickPrompts(interaction)).toHaveLength(0)
    })

    it('does not queue a recruit listed as a bypass user', async () => {
        const recruit = createMember('bypass-recruit', ['recruit-role'])
        const interaction = createInteraction([recruit])
        mockCheckQuota.mockResolvedValue(quotaReportFor(recruit))

        await purgeCommand.execute(interaction)

        expect(kickPrompts(interaction)).toHaveLength(0)
    })

    it('keeps existing trooper-on-purge-defcon kick behavior', async () => {
        const trooper = createMember('purge-trooper', ['trooper-company-role', 'purge-role'])
        const interaction = createInteraction([trooper])
        mockCheckQuota.mockResolvedValue(quotaReportFor(trooper, {
            met: false,
            metPurgeQuotas: false,
            purge: true
        }))

        await purgeCommand.execute(interaction)

        expect(kickPrompts(interaction)).toEqual([
            expect.stringContaining('Kick **purge-trooperRoblox** [Trooper]')
        ])
    })
})
