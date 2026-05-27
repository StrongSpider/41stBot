'use strict'

jest.mock('../../api/database', () => ({
    getRankedEventTypes: jest.fn()
}))

const database = require('../../api/database')
const {
    MAX_EVENT_TYPE_AUTOCOMPLETE_CHOICES,
    getEventTypeAutocompleteChoices
} = require('../../bot/utils/eventTypeAutocomplete.js')

describe('eventTypeAutocomplete', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('returns matching event types in ranked order and ignores a trailing wildcard', async () => {
        database.getRankedEventTypes.mockResolvedValue([
            'Raid Training',
            'Ranger Tryout',
            'Rally',
            'Meeting'
        ])

        const result = await getEventTypeAutocompleteChoices('Ra*')

        expect(result).toEqual([
            { name: 'Raid Training', value: 'Raid Training' },
            { name: 'Ranger Tryout', value: 'Ranger Tryout' },
            { name: 'Rally', value: 'Rally' }
        ])
    })

    it('caps responses at the Discord autocomplete limit', async () => {
        database.getRankedEventTypes.mockResolvedValue(
            Array.from({ length: MAX_EVENT_TYPE_AUTOCOMPLETE_CHOICES + 5 }, (_, index) => `Event ${index + 1}`)
        )

        const result = await getEventTypeAutocompleteChoices('')

        expect(result).toHaveLength(MAX_EVENT_TYPE_AUTOCOMPLETE_CHOICES)
        expect(result[0]).toEqual({ name: 'Event 1', value: 'Event 1' })
    })
})
