const {
    parseDateInput,
    parseDuringInput,
    getCurrentWeekBounds,
    resolveEventDateFilters,
    eventMatchesDateRange
} = require('../../bot/utils/eventDateFilters.js')

describe('eventDateFilters', () => {
    const fixedNow = new Date('2026-03-01T12:00:00Z')

    it('parses single-digit dates and normalizes them', () => {
        const parsed = parseDateInput('1/3/2026', false)

        expect(parsed.error).toBeNull()
        expect(parsed.normalized).toBe('01/03/2026')
        expect(parsed.ms).toBe(Date.UTC(2026, 2, 1, 0, 0, 0, 0))
    })

    it('parses during as a single day', () => {
        const parsed = parseDuringInput('1/3/2026')

        expect(parsed.error).toBeNull()
        expect(parsed.normalized).toBe('01/03/2026')
        expect(parsed.startMs).toBe(Date.UTC(2026, 2, 1, 0, 0, 0, 0))
        expect(parsed.endMs).toBe(Date.UTC(2026, 2, 1, 23, 59, 59, 999))
    })

    it('parses during as a closed range', () => {
        const parsed = parseDuringInput('25/02/2026 to 01/03/2026')

        expect(parsed.error).toBeNull()
        expect(parsed.normalized).toBe('25/02/2026 to 01/03/2026')
        expect(parsed.startMs).toBe(Date.UTC(2026, 1, 25, 0, 0, 0, 0))
        expect(parsed.endMs).toBe(Date.UTC(2026, 2, 1, 23, 59, 59, 999))
    })

    it('computes the current week as Monday through Sunday in UTC', () => {
        const bounds = getCurrentWeekBounds(fixedNow)

        expect(bounds.startMs).toBe(Date.UTC(2026, 1, 23, 0, 0, 0, 0))
        expect(bounds.endMs).toBe(Date.UTC(2026, 2, 1, 23, 59, 59, 999))
    })

    it('keeps weekly scope when the effective range stays inside the current week', () => {
        const resolved = resolveEventDateFilters({
            afterInput: '25/02/2026',
            beforeInput: '01/03/2026',
            now: fixedNow
        })

        expect(resolved.error).toBeNull()
        expect(resolved.useAllTime).toBe(false)
        expect(resolved.autoSwitchedToAllTime).toBe(false)
        expect(resolved.dateLabel).toBe('During 25/02/2026 to 01/03/2026')
    })

    it('auto-switches to all-time when a date filter extends beyond the current week', () => {
        const resolved = resolveEventDateFilters({
            beforeInput: '01/03/2026',
            now: fixedNow
        })

        expect(resolved.error).toBeNull()
        expect(resolved.useAllTime).toBe(true)
        expect(resolved.autoSwitchedToAllTime).toBe(true)
        expect(resolved.dateLabel).toBe('Before 01/03/2026')
    })

    it('honors an explicit all-time request even when the dates are inside the current week', () => {
        const resolved = resolveEventDateFilters({
            requestedAllTime: true,
            duringInput: '25/02/2026 to 26/02/2026',
            now: fixedNow
        })

        expect(resolved.error).toBeNull()
        expect(resolved.useAllTime).toBe(true)
        expect(resolved.autoSwitchedToAllTime).toBe(false)
    })

    it('rejects contradictory combined ranges', () => {
        const resolved = resolveEventDateFilters({
            afterInput: '01/03/2026',
            duringInput: '25/02/2026 to 26/02/2026',
            now: fixedNow
        })

        expect(resolved.error).toBe('Invalid date range. The start date must be on or before the end date.')
    })

    it('matches timestamps against the resolved range', () => {
        expect(eventMatchesDateRange(
            { timestamp: '2026-02-27T14:00:00.000Z' },
            Date.UTC(2026, 1, 25, 0, 0, 0, 0),
            Date.UTC(2026, 2, 1, 23, 59, 59, 999)
        )).toBe(true)

        expect(eventMatchesDateRange(
            { timestamp: '2026-02-22T23:59:59.999Z' },
            Date.UTC(2026, 1, 25, 0, 0, 0, 0),
            Date.UTC(2026, 2, 1, 23, 59, 59, 999)
        )).toBe(false)
    })
})
