jest.mock('../../../config.json', () => ({
    DISCORD: {
        ROLES: {
            OFFICER: 'officer-role'
        }
    }
}))

const {
    buildEventSummary,
    parseEventSummaryContent,
    parseMentionIds,
    parseSummaryModifier
} = require('../../bot/utils/eventSummary.js')

function createGuild(officerIds = []) {
    const officerSet = new Set(officerIds)
    return {
        members: {
            cache: new Map(
                [...officerSet].map(id => [
                    id,
                    {
                        roles: {
                            cache: {
                                has: roleId => officerSet.has(id) && roleId === 'officer-role'
                            }
                        }
                    }
                ])
            )
        }
    }
}

describe('eventSummary', () => {
    it('builds event summaries with officer and attendee sections from shared logic', () => {
        const summary = buildEventSummary({
            eventName: 'Training',
            note: 'Bring shields',
            baseEpPoints: 2,
            attendees: [
                { discordId: 'host-id' },
                { discordId: 'officer-id' },
                { discordId: 'attendee-id' },
                { discordId: 'supervisor-id' }
            ],
            extraRecipients: [{ discordId: 'extra-id' }],
            supervisor: { discordId: 'supervisor-id' },
            host: { discordId: 'host-id' }
        }, createGuild(['officer-id']))

        expect(summary).toBe([
            'Event: Training',
            'Host: <@host-id>',
            'Supervisor: <@supervisor-id>',
            'Officers: <@officer-id>',
            'Attendees: <@attendee-id> <@supervisor-id>',
            'Extra EP: <@extra-id>',
            'Modifier: 2x EP',
            'Note: Bring shields'
        ].join('\n'))
    })

    it('parses base recipients including host and supervisor from an event summary', () => {
        const parsed = parseEventSummaryContent([
            'Event: Training',
            'Host: <@100000000000000001>',
            'Supervisor: <@200000000000000002>',
            'Officers: <@300000000000000003>',
            'Attendees: <@400000000000000004> <@100000000000000001>',
            'Extra EP: <@500000000000000005> <@500000000000000005>',
            'Modifier: 1.5x EP',
            'Note: Bring shields: level 2'
        ].join('\n'))

        expect(parsed).toEqual({
            eventName: 'Training',
            hostDiscordId: '100000000000000001',
            supervisorDiscordId: '200000000000000002',
            officerDiscordIds: ['300000000000000003'],
            attendeeDiscordIds: ['400000000000000004', '100000000000000001'],
            baseDiscordIds: ['300000000000000003', '400000000000000004', '100000000000000001', '200000000000000002'],
            extraDiscordIds: ['500000000000000005'],
            note: 'Bring shields: level 2',
            baseEpPoints: 1.5
        })
    })

    it('dedupes mention parsing and falls back to a 1x modifier', () => {
        expect(parseMentionIds('<@100000000000000001> <@!100000000000000001> <@200000000000000002>'))
            .toEqual(['100000000000000001', '200000000000000002'])
        expect(parseSummaryModifier('Modifier: nonsense')).toBe(1)
    })
})
