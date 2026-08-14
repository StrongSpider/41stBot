const { Collection, ComponentType, ButtonStyle } = require('discord.js')

jest.mock('../../../config.json', () => ({
    DISCORD: {
        CHANNELS: {
            GAR_EVENT_LOGS: 'gar-event-logs'
        },
        WEBHOOKS: {
            ADMIN_LOGS: null
        }
    }
}))

const GAREventLogMessage = require('../../bot/events/messageCreate/GAREventLogMessage.js')

function createMessage({ channelId = 'gar-event-logs', components = [] } = {}) {
    const channel = {
        messages: {
            fetch: jest.fn().mockResolvedValue(new Collection())
        },
        send: jest.fn().mockResolvedValue({ id: 'new-prompt' })
    }

    return {
        message: {
            id: 'incoming-message',
            channelId,
            channel,
            client: { user: { id: 'bot-user' } },
            components
        },
        channel
    }
}

describe('messageCreate/GAREventLogMessage', () => {
    it('reposts the GAR logging prompt after a new channel message', async () => {
        const oldPrompt = {
            id: 'old-prompt',
            author: { id: 'bot-user' },
            components: [{ components: [{ customId: 'log_gar_event' }] }],
            delete: jest.fn().mockResolvedValue(undefined)
        }
        const { message, channel } = createMessage()
        channel.messages.fetch.mockResolvedValue(new Collection([[oldPrompt.id, oldPrompt]]))

        await GAREventLogMessage(message)

        expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 })
        expect(oldPrompt.delete).toHaveBeenCalledTimes(1)
        expect(channel.send).toHaveBeenCalledTimes(1)

        const payload = channel.send.mock.calls[0][0]
        expect(payload.content).toBe('Click the button below to log a GAR event.')
        const row = payload.components[0].toJSON()
        expect(row.components).toEqual([
            expect.objectContaining({
                type: ComponentType.Button,
                custom_id: 'log_gar_event',
                label: 'Log Event',
                style: ButtonStyle.Primary
            })
        ])
    })

    it('ignores the replacement prompt to prevent a messageCreate loop', async () => {
        const { message, channel } = createMessage({
            components: [{ components: [{ customId: 'log_gar_event' }] }]
        })

        await GAREventLogMessage(message)

        expect(channel.messages.fetch).not.toHaveBeenCalled()
        expect(channel.send).not.toHaveBeenCalled()
    })

    it('ignores messages outside the configured GAR event-log channel', async () => {
        const { message, channel } = createMessage({ channelId: 'another-channel' })

        await GAREventLogMessage(message)

        expect(channel.messages.fetch).not.toHaveBeenCalled()
        expect(channel.send).not.toHaveBeenCalled()
    })

    it('does not delete another bot\'s message with a matching component id', async () => {
        const otherBotMessage = {
            id: 'other-bot-message',
            author: { id: 'other-bot' },
            components: [{ components: [{ customId: 'log_gar_event' }] }],
            delete: jest.fn().mockResolvedValue(undefined)
        }
        const { message, channel } = createMessage()
        channel.messages.fetch.mockResolvedValue(new Collection([[otherBotMessage.id, otherBotMessage]]))

        await GAREventLogMessage(message)

        expect(otherBotMessage.delete).not.toHaveBeenCalled()
        expect(channel.send).toHaveBeenCalledTimes(1)
    })
})
