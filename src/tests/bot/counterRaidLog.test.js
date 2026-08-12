jest.mock('../../../config.json', () => ({
    DISCORD: {
        CHANNELS: {
            COUNTER_RAID_LOGS: '714825306204274728'
        },
        ROLES: {
            ERT_OFFICER: ['ert-officer-role'],
            HICOM: 'hicom-role'
        },
        BOT: {
            DEVELOPER_USER_ID: '123456789012345678'
        },
        WEBHOOKS: {
            ADMIN_LOGS: null
        }
    }
}))

jest.mock('../../api/database', () => ({
    getEventEpLock: jest.fn(),
    getRobloxIdByDiscord: jest.fn(),
    createWeeklyEvent: jest.fn()
}))

jest.mock('../../api/webhook.js', () => ({
    sendEventCreateWebhook: jest.fn()
}))

const database = require('../../api/database')
const { sendEventCreateWebhook } = require('../../api/webhook.js')
const counterRaidLog = require('../../bot/events/messageCreate/counterRaidLog.js')

describe('counterRaidLog', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('deletes and rejects counter raid logs while the tracker is locked', async () => {
        database.getEventEpLock.mockResolvedValue({
            enabled: true,
            reason: 'Maintenance',
            changedBy: '987654321098765432'
        })

        const message = {
            author: { bot: false },
            channelId: '714825306204274728',
            content: 'Host: <@123456789012345678>\nAttendees: <@123456789012345678>',
            member: {
                id: '123456789012345678',
                roles: { cache: { has: jest.fn(roleId => roleId === 'hicom-role') } },
                send: jest.fn().mockResolvedValue(undefined)
            },
            channel: {
                send: jest.fn()
            },
            delete: jest.fn().mockResolvedValue(undefined)
        }

        await counterRaidLog(message)

        expect(message.member.send).toHaveBeenCalledWith(
            'Your message in <#714825306204274728> cannot be posted while the tracker is locked. Here was your message:\n```' + message.content + '```'
        )
        expect(message.delete).toHaveBeenCalledTimes(1)
        expect(message.channel.send).not.toHaveBeenCalled()
        expect(database.getRobloxIdByDiscord).not.toHaveBeenCalled()
        expect(database.createWeeklyEvent).not.toHaveBeenCalled()
        expect(sendEventCreateWebhook).not.toHaveBeenCalled()
    })
})
