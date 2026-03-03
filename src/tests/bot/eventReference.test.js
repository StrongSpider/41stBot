jest.mock('../../api/database.js', () => ({
    findEventByMessage: jest.fn()
}))

const database = require('../../api/database.js')
const {
    normalizeMessageUrl,
    resolveEventReference,
    isEventReferenceError,
    formatEventReferenceError
} = require('../../bot/utils/eventReference.js')

describe('eventReference', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('normalizes Discord message links to the stored canonical form', () => {
        expect(normalizeMessageUrl('<https://canary.discordapp.com/channels/1/2/3/?foo=bar#jump>'))
            .toBe('https://discord.com/channels/1/2/3')
    })

    it('passes through plain event ids without a database lookup', async () => {
        const resolved = await resolveEventReference('11111111-2222-3333-4444-555555555555')

        expect(resolved).toEqual({
            eventId: '11111111-2222-3333-4444-555555555555',
            event: null,
            source: 'event-id',
            reference: '11111111-2222-3333-4444-555555555555'
        })
        expect(database.findEventByMessage).not.toHaveBeenCalled()
    })

    it('resolves a Discord message link to the matching event id', async () => {
        database.findEventByMessage.mockResolvedValue({
            eventId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            type: 'Training'
        })

        const resolved = await resolveEventReference('<https://ptb.discord.com/channels/10/20/30/>')

        expect(database.findEventByMessage).toHaveBeenCalledWith('https://discord.com/channels/10/20/30')
        expect(resolved).toEqual({
            eventId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            event: {
                eventId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                type: 'Training'
            },
            source: 'message-url',
            reference: 'https://discord.com/channels/10/20/30'
        })
    })

    it('rejects malformed Discord message links', async () => {
        await expect(resolveEventReference('https://discord.com/channels/10/20'))
            .rejects
            .toMatchObject({ code: 'invalid_message_url' })
    })

    it('rejects non-Discord URLs instead of treating them as event ids', async () => {
        await expect(resolveEventReference('https://example.com/somewhere'))
            .rejects
            .toMatchObject({ code: 'unsupported_url' })
    })

    it('returns a specific error when the message link is not indexed to an event', async () => {
        database.findEventByMessage.mockResolvedValue(null)

        let err
        try {
            await resolveEventReference('https://discord.com/channels/10/20/30')
        } catch (error) {
            err = error
        }

        expect(isEventReferenceError(err)).toBe(true)
        expect(err).toMatchObject({ code: 'message_not_indexed' })
        expect(formatEventReferenceError(err))
            .toBe('<:warning:1297618648810393630> `Could not find a logged event for that message link.`')
    })
})
