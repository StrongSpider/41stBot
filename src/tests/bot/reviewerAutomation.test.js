jest.mock('../../../config.json', () => ({
    GENERAL: {
        EMBED_COLOR: 'DarkGreen'
    },
    DISCORD: {
        CHANNELS: {
            REVIEWER_WEEKLY_REPORTS: '919623997791014912'
        }
    }
}))

const {
    REVIEWER_AUTOMATION_CHANNEL_ID,
    REVIEWER_AUTOMATION_UTC_OFFSET_HOURS,
    REVIEWER_LIST_STATE_KEY,
    REVIEWER_RESET_STATE_KEY,
    createWeeklyReviewerListEmbeds,
    summarizeReviewerReset,
    getScheduledReviewerAction
} = require('../../bot/utils/reviewerAutomation.js')

describe('reviewerAutomation', () => {
    it('uses the configured reviewer automation channel', () => {
        expect(REVIEWER_AUTOMATION_CHANNEL_ID).toBe('919623997791014912')
    })

    it('uses a fixed UTC-4 offset for the reviewer schedule', () => {
        expect(REVIEWER_AUTOMATION_UTC_OFFSET_HOURS).toBe(-4)
    })

    it('matches Sunday 10:00 PM UTC-4 for the weekly reviewer list', () => {
        expect(getScheduledReviewerAction(new Date('2026-01-05T02:00:00.000Z'))).toEqual({
            action: 'list',
            stateKey: REVIEWER_LIST_STATE_KEY,
            runKey: '2026-01-04'
        })
    })

    it('matches Sunday 10:01 PM UTC-4 for the weekly reviewer reset', () => {
        expect(getScheduledReviewerAction(new Date('2026-01-05T02:01:00.000Z'))).toEqual({
            action: 'reset',
            stateKey: REVIEWER_RESET_STATE_KEY,
            runKey: '2026-01-04'
        })
    })

    it('ignores times outside the Sunday review window', () => {
        expect(getScheduledReviewerAction(new Date('2026-01-05T02:02:00.000Z'))).toBeNull()
    })

    it('builds sorted weekly reviewer embeds', () => {
        const embeds = createWeeklyReviewerListEmbeds([
            { discordId: '300', count: 1 },
            { discordId: '100', count: 3 },
            { discordId: '200', count: 3 }
        ], 'https://example.com/icon.png')

        expect(embeds).toHaveLength(1)
        expect(embeds[0].toJSON().description).toBe([
            '1. <@100> 3',
            '2. <@200> 3',
            '3. <@300> 1'
        ].join('\n'))
    })

    it('summarizes reset totals from reviewer rows', () => {
        expect(summarizeReviewerReset([
            { discordId: '100', count: 4 },
            { discordId: '200', count: 7 }
        ])).toEqual({
            reviewersCleared: 2,
            reviewsCleared: 11
        })
    })
})
