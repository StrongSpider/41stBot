jest.mock('../../../config.json', () => ({
    DISCORD: {
        ROLES: {
            OFFICER: 'officer-role',
            FFCNC: 'ffc-role',
            ERT_OFFICER: ['ert-role']
        },
        BOT: {
            DEVELOPER_USER_ID: 'dev-user'
        }
    }
}))

jest.mock('../../api/database.js', () => ({
    findEventByMessage: jest.fn()
}))

const database = require('../../api/database.js')
const {
    MINOR_REVIEW_EVENT_NOT_FOUND_MESSAGE,
    findMinorReviewEvent,
    canManageMinorReviewEvent,
    getMinorReviewPermissionError
} = require('../../bot/utils/minorEventReview.js')

function createInteraction({ userId = 'user-id', roles = [], messageUrl = 'https://discord.com/channels/1/2/3' } = {}) {
    const roleSet = new Set(roles)

    return {
        user: { id: userId },
        member: {
            roles: {
                cache: {
                    has: roleId => roleSet.has(roleId)
                }
            }
        },
        message: { url: messageUrl }
    }
}

describe('minorEventReview', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('loads the event tied to the moderation message URL', async () => {
        const event = { eventId: 'event-1' }
        database.findEventByMessage.mockResolvedValue(event)

        await expect(findMinorReviewEvent(createInteraction())).resolves.toBe(event)
        expect(database.findEventByMessage).toHaveBeenCalledWith('https://discord.com/channels/1/2/3')
    })

    it('allows officers to review standard events and developers to override', () => {
        expect(canManageMinorReviewEvent(
            createInteraction({ roles: ['officer-role'] }),
            { type: 'Training' }
        )).toBe(true)

        expect(canManageMinorReviewEvent(
            createInteraction({ userId: 'dev-user' }),
            { type: 'Training' }
        )).toBe(true)

        expect(canManageMinorReviewEvent(
            createInteraction(),
            { type: 'Training' }
        )).toBe(false)
    })

    it('requires FFCNC or ERT review permissions for counter raids', () => {
        expect(canManageMinorReviewEvent(
            createInteraction({ roles: ['ffc-role'] }),
            { type: 'Counter Raid' }
        )).toBe(true)

        expect(canManageMinorReviewEvent(
            createInteraction({ roles: ['ert-role'] }),
            { type: 'Counter Raid' }
        )).toBe(true)

        expect(canManageMinorReviewEvent(
            createInteraction({ roles: ['officer-role'] }),
            { type: 'Counter Raid' }
        )).toBe(false)
    })

    it('exposes shared moderation messages', () => {
        expect(MINOR_REVIEW_EVENT_NOT_FOUND_MESSAGE)
            .toBe('<:warning:1297618648810393630> `I could not find this event! Ask a HICOM+ to remove this.`')
        expect(getMinorReviewPermissionError('deny'))
            .toBe('<:warning:1297618648810393630> `You do not have sufficient permissions to deny this event!`')
    })
})
