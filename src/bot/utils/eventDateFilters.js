'use strict'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DATE_PARTS = '(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})'
const DATE_RE = new RegExp('^' + DATE_PARTS + '$')
const DURING_RE = new RegExp(
    '^' + DATE_PARTS + '\\s*(?:to|through|thru|\\.\\.|-)\\s*' + DATE_PARTS + '$',
    'i'
)

/**
 * Parse a calendar date in MM/DD/YYYY form into UTC milliseconds.
 * Accepts 1-2 digit month/day for convenience and normalizes output labels.
 * @param {string|null|undefined} input
 * @param {boolean} endOfDay
 * @returns {{ ms: number|null, normalized: string|null, error: string|null }}
 */
function parseDateInput(input, endOfDay) {
    if (input == null || String(input).trim() === '') {
        return { ms: null, normalized: null, error: null }
    }

    const raw = String(input).trim()
    const match = DATE_RE.exec(raw)
    if (!match) {
        return { ms: null, normalized: null, error: 'Invalid date format. Use MM/DD/YYYY.' }
    }

    const month = Number(match[1])
    const day = Number(match[2])
    const year = Number(match[3])
    if (month < 1 || month > 12) {
        return { ms: null, normalized: null, error: 'Invalid date format. Use MM/DD/YYYY.' }
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (day < 1 || day > daysInMonth) {
        return { ms: null, normalized: null, error: 'Invalid date format. Use MM/DD/YYYY.' }
    }

    const hours = endOfDay ? 23 : 0
    const minutes = endOfDay ? 59 : 0
    const seconds = endOfDay ? 59 : 0
    const millis = endOfDay ? 999 : 0

    return {
        ms: Date.UTC(year, month - 1, day, hours, minutes, seconds, millis),
        normalized: `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`,
        error: null
    }
}

/**
 * Parse the "during" option as either a single date or a closed date range.
 * @param {string|null|undefined} input
 * @returns {{ startMs: number|null, endMs: number|null, normalized: string|null, error: string|null }}
 */
function parseDuringInput(input) {
    if (input == null || String(input).trim() === '') {
        return { startMs: null, endMs: null, normalized: null, error: null }
    }

    const raw = String(input).trim()
    const single = parseDateInput(raw, false)
    if (!single.error && single.ms !== null) {
        const end = parseDateInput(raw, true)
        return {
            startMs: single.ms,
            endMs: end.ms,
            normalized: single.normalized,
            error: null
        }
    }

    const rangeMatch = DURING_RE.exec(raw)
    if (!rangeMatch) {
        return {
            startMs: null,
            endMs: null,
            normalized: null,
            error: 'Invalid during range. Use MM/DD/YYYY or MM/DD/YYYY to MM/DD/YYYY.'
        }
    }

    const start = parseDateInput(`${rangeMatch[1]}/${rangeMatch[2]}/${rangeMatch[3]}`, false)
    const end = parseDateInput(`${rangeMatch[4]}/${rangeMatch[5]}/${rangeMatch[6]}`, true)
    if (start.error || end.error || start.ms === null || end.ms === null) {
        return {
            startMs: null,
            endMs: null,
            normalized: null,
            error: 'Invalid during range. Use MM/DD/YYYY or MM/DD/YYYY to MM/DD/YYYY.'
        }
    }
    if (start.ms > end.ms) {
        return {
            startMs: null,
            endMs: null,
            normalized: null,
            error: 'Invalid during range. The start date must be on or before the end date.'
        }
    }

    return {
        startMs: start.ms,
        endMs: end.ms,
        normalized: `${start.normalized} to ${end.normalized}`,
        error: null
    }
}

/**
 * Compute the current week bounds in UTC.
 * The project treats the operational week as Monday through Sunday.
 * @param {Date|number|string} [now]
 * @returns {{ startMs: number, endMs: number }}
 */
function getCurrentWeekBounds(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now)
    const utcDay = date.getUTCDay()
    const diffToMonday = utcDay === 0 ? 6 : utcDay - 1
    const startMs = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() - diffToMonday,
        0, 0, 0, 0
    )

    return {
        startMs,
        endMs: startMs + (7 * MS_PER_DAY) - 1
    }
}

/**
 * Resolve effective date filters and whether the query must use the all-time database.
 * @param {{
 *   afterInput?: string|null,
 *   beforeInput?: string|null,
 *   duringInput?: string|null,
 *   requestedAllTime?: boolean,
 *   now?: Date|number|string
 * }} opts
 * @returns {{
 *   error: string|null,
 *   afterMs: number|null,
 *   beforeMs: number|null,
 *   dateLabel: string,
 *   hasDateFilter: boolean,
 *   useAllTime: boolean,
 *   autoSwitchedToAllTime: boolean,
 *   currentWeekStartMs: number,
 *   currentWeekEndMs: number
 * }}
 */
function resolveEventDateFilters(opts = {}) {
    const after = parseDateInput(opts.afterInput ?? null, false)
    if (after.error) {
        return {
            error: after.error,
            afterMs: null,
            beforeMs: null,
            dateLabel: '',
            hasDateFilter: false,
            useAllTime: Boolean(opts.requestedAllTime),
            autoSwitchedToAllTime: false,
            currentWeekStartMs: 0,
            currentWeekEndMs: 0
        }
    }

    const before = parseDateInput(opts.beforeInput ?? null, true)
    if (before.error) {
        return {
            error: before.error,
            afterMs: null,
            beforeMs: null,
            dateLabel: '',
            hasDateFilter: false,
            useAllTime: Boolean(opts.requestedAllTime),
            autoSwitchedToAllTime: false,
            currentWeekStartMs: 0,
            currentWeekEndMs: 0
        }
    }

    const during = parseDuringInput(opts.duringInput ?? null)
    if (during.error) {
        return {
            error: during.error,
            afterMs: null,
            beforeMs: null,
            dateLabel: '',
            hasDateFilter: false,
            useAllTime: Boolean(opts.requestedAllTime),
            autoSwitchedToAllTime: false,
            currentWeekStartMs: 0,
            currentWeekEndMs: 0
        }
    }

    const startBounds = [after.ms, during.startMs].filter(v => v != null)
    const endBounds = [before.ms, during.endMs].filter(v => v != null)
    const afterMs = startBounds.length ? Math.max(...startBounds) : null
    const beforeMs = endBounds.length ? Math.min(...endBounds) : null

    if (afterMs !== null && beforeMs !== null && afterMs > beforeMs) {
        return {
            error: 'Invalid date range. The start date must be on or before the end date.',
            afterMs,
            beforeMs,
            dateLabel: '',
            hasDateFilter: true,
            useAllTime: Boolean(opts.requestedAllTime),
            autoSwitchedToAllTime: false,
            currentWeekStartMs: 0,
            currentWeekEndMs: 0
        }
    }

    const { startMs: currentWeekStartMs, endMs: currentWeekEndMs } = getCurrentWeekBounds(opts.now)
    const hasDateFilter = Boolean(after.normalized || before.normalized || during.normalized)

    const lowerBound = afterMs === null ? Number.NEGATIVE_INFINITY : afterMs
    const upperBound = beforeMs === null ? Number.POSITIVE_INFINITY : beforeMs
    const rangeInsideCurrentWeek = lowerBound >= currentWeekStartMs && upperBound <= currentWeekEndMs
    const autoSwitchedToAllTime = !opts.requestedAllTime && hasDateFilter && !rangeInsideCurrentWeek
    const useAllTime = Boolean(opts.requestedAllTime) || autoSwitchedToAllTime

    let dateLabel = ''
    if (afterMs !== null && beforeMs !== null) {
        const startLabel = formatDateMs(afterMs)
        const endLabel = formatDateMs(beforeMs)
        dateLabel = startLabel === endLabel ? `During ${startLabel}` : `During ${startLabel} to ${endLabel}`
    } else if (afterMs !== null) {
        dateLabel = `After ${formatDateMs(afterMs)}`
    } else if (beforeMs !== null) {
        dateLabel = `Before ${formatDateMs(beforeMs)}`
    }

    return {
        error: null,
        afterMs,
        beforeMs,
        dateLabel,
        hasDateFilter,
        useAllTime,
        autoSwitchedToAllTime,
        currentWeekStartMs,
        currentWeekEndMs
    }
}

/**
 * Convert a UTC millisecond timestamp to MM/DD/YYYY.
 * @param {number} ms
 * @returns {string}
 */
function formatDateMs(ms) {
    const date = new Date(ms)
    return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`
}

/**
 * Check whether an event timestamp falls within the resolved date filters.
 * @param {{ timestamp?: string|Date|null }} ev
 * @param {number|null} afterMs
 * @param {number|null} beforeMs
 * @returns {boolean}
 */
function eventMatchesDateRange(ev, afterMs, beforeMs) {
    if (afterMs === null && beforeMs === null) return true
    const rawTs = ev && ev.timestamp ? ev.timestamp : null
    const parsed = rawTs == null ? NaN : Date.parse(rawTs)
    if (!Number.isFinite(parsed)) return false
    if (afterMs !== null && parsed < afterMs) return false
    if (beforeMs !== null && parsed > beforeMs) return false
    return true
}

module.exports = {
    parseDateInput,
    parseDuringInput,
    getCurrentWeekBounds,
    resolveEventDateFilters,
    formatDateMs,
    eventMatchesDateRange
}
