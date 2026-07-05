const UNKNOWN_TYPE = 'Unknown';
function validDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date) {
    return date.toISOString().slice(0, 10);
}

function monthKey(date) {
    return date.toISOString().slice(0, 7);
}

function weekKey(date) {
    const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() - day + 1);
    return dayKey(copy);
}

function shortDateLabel(key) {
    const date = validDate(`${key}T00:00:00.000Z`);
    if (!date) return key;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function monthLabel(key) {
    const date = validDate(`${key}-01T00:00:00.000Z`);
    if (!date) return key;
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

function fullDateLabel(key) {
    const date = validDate(`${key}T00:00:00.000Z`);
    if (!date) return key;
    return date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

function fullMonthLabel(key) {
    const date = validDate(`${key}-01T00:00:00.000Z`);
    if (!date) return key;
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function weekLabel(key) {
    return shortDateLabel(key);
}

function normalizeType(type) {
    const value = String(type || '').trim();
    return value || UNKNOWN_TYPE;
}

function normalizePerson(person) {
    const value = String(person || '').trim();
    return value || null;
}

function attendeeCount(event) {
    return Array.isArray(event?.attendees) ? event.attendees.length : 0;
}

function countBy(items, getKey) {
    const counts = new Map();
    items.forEach((item) => {
        const key = getKey(item);
        if (key === null || key === undefined) return;
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
}

function mapToRankedRows(counts, valueName = 'events', limit = 8) {
    return [...counts.entries()]
        .map(([name, value]) => ({ name, [valueName]: value, value }))
        .sort((a, b) => b[valueName] - a[valueName] || a.name.localeCompare(b.name))
        .slice(0, limit);
}

function normalizeConfigs(configs) {
    if (!Array.isArray(configs)) return [];

    return configs
        .map((config) => ({
            pattern: String(config?.pattern || '').trim(),
            alias: String(config?.alias || '').trim()
        }))
        .filter((config) => config.pattern && config.alias);
}

function matchesTypePattern(type, pattern) {
    const isWildcard = pattern.endsWith('*');
    return isWildcard ? type.startsWith(pattern.slice(0, -1)) : type === pattern;
}

function createTypeBreakdown(name) {
    return {
        name,
        events: 0,
        attendees: 0,
        average: 0,
        value: 0
    };
}

function typeBreakdownSorter(sortBy = 'events') {
    const key = sortBy === 'attendees' || sortBy === 'average' ? sortBy : 'events';
    return (a, b) => b[key] - a[key] || a.name.localeCompare(b.name);
}

export function buildTypeBreakdownRows(events, options = {}) {
    if (!Array.isArray(events) || events.length === 0) return [];

    const topLimit = Number(options.topLimit) || 8;
    const configs = normalizeConfigs(options.configs);
    const rows = new Map();

    if (configs.length) {
        configs.forEach((config) => {
            if (!rows.has(config.alias)) rows.set(config.alias, createTypeBreakdown(config.alias));
        });
    }

    events.forEach((event) => {
        const type = normalizeType(event.type);
        const config = configs.find((item) => matchesTypePattern(type, item.pattern));
        const name = configs.length ? config?.alias : type;
        if (!name) return;

        if (!rows.has(name)) rows.set(name, createTypeBreakdown(name));
        const row = rows.get(name);
        row.events += 1;
        row.attendees += attendeeCount(event);
    });

    const sorted = [...rows.values()]
        .filter((row) => row.events > 0)
        .map((row) => ({
            ...row,
            average: row.events ? Number((row.attendees / row.events).toFixed(1)) : 0,
            value: row.events
        }))
        .sort(typeBreakdownSorter(options.sortBy));

    return configs.length && options.limitCustom === false ? sorted : sorted.slice(0, topLimit);
}

export function getRangeBounds(timeRange, customStart, customEnd, now = new Date()) {
    let startDate = null;
    let endDate = null;

    if (timeRange === '7d') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === '30d') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === '90d') {
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'custom') {
        startDate = customStart ? validDate(`${customStart}T00:00:00.000Z`) : null;
        endDate = customEnd ? validDate(`${customEnd}T23:59:59.999Z`) : null;
    }

    return { startDate, endDate };
}

export function filterEventsByRange(events, bounds) {
    if (!Array.isArray(events)) return [];
    const { startDate, endDate } = bounds;

    return events.filter((event) => {
        const date = validDate(event.timestamp);
        if (!date) return false;
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
    });
}

export function getRangeDays(events, bounds) {
    const dates = events.map((event) => validDate(event.timestamp)).filter(Boolean);
    if (!dates.length) return 0;

    const earliest = bounds.startDate || new Date(Math.min(...dates.map((date) => date.getTime())));
    const latest = bounds.endDate || new Date(Math.max(...dates.map((date) => date.getTime())));
    return Math.max(1, Math.ceil((latest.getTime() - earliest.getTime()) / 86400000) + 1);
}

export function getBucketMode(days) {
    if (days <= 90) return 'day';
    if (days <= 540) return 'week';
    return 'month';
}

export function buildTrendData(events, bucketMode) {
    const buckets = new Map();

    events.forEach((event) => {
        const date = validDate(event.timestamp);
        if (!date) return;

        const key = bucketMode === 'month'
            ? monthKey(date)
            : bucketMode === 'week'
                ? weekKey(date)
                : dayKey(date);

        const existing = buckets.get(key) || { key, events: 0, attendees: 0 };
        existing.events += 1;
        existing.attendees += attendeeCount(event);
        buckets.set(key, existing);
    });

    return [...buckets.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((row) => ({
            ...row,
            label: bucketMode === 'month'
                ? monthLabel(row.key)
                : bucketMode === 'week'
                    ? weekLabel(row.key)
                    : shortDateLabel(row.key),
            tooltipLabel: bucketMode === 'month'
                ? fullMonthLabel(row.key)
                : bucketMode === 'week'
                    ? `Week of ${fullDateLabel(row.key)}`
                : fullDateLabel(row.key)
        }));
}

export function buildStatistics(events, bounds, options = {}) {
    const topLimit = Number(options.topLimit) || 8;
    const rangeDays = getRangeDays(events, bounds);
    const bucketMode = getBucketMode(rangeDays);
    const totalAttendees = events.reduce((sum, event) => sum + attendeeCount(event), 0);
    const uniqueAttendees = new Set();

    events.forEach((event) => {
        if (Array.isArray(event.attendees)) {
            event.attendees.forEach((attendee) => uniqueAttendees.add(String(attendee)));
        }
    });

    const hostCounts = countBy(events, (event) => normalizePerson(event.host));
    const supervisorCounts = countBy(events, (event) => normalizePerson(event.supervisor));

    const typeRows = buildTypeBreakdownRows(events, { topLimit, sortBy: 'events' });
    const hostRows = mapToRankedRows(hostCounts, 'events', topLimit);
    const supervisorRows = mapToRankedRows(supervisorCounts, 'events', topLimit);

    const attendanceByType = buildTypeBreakdownRows(events, { topLimit, sortBy: 'attendees' });

    const dayHour = buildDayHourGrid(events);
    const busiestDayHour = dayHour.reduce((best, item) => item.events > best.events ? item : best, {
        day: 'N/A',
        hour: 'N/A',
        events: 0
    });

    return {
        totalEvents: events.length,
        eventsPerDay: rangeDays ? Number((events.length / rangeDays).toFixed(1)) : 0,
        averageAttendees: events.length ? Number((totalAttendees / events.length).toFixed(1)) : 0,
        uniqueAttendees: uniqueAttendees.size,
        uniqueHosts: new Set(events.map((event) => normalizePerson(event.host)).filter(Boolean)).size,
        uniqueSupervisors: new Set(events.map((event) => normalizePerson(event.supervisor)).filter(Boolean)).size,
        busiestType: typeRows[0]?.name || 'N/A',
        busiestDayHour,
        typeRows,
        hostRows,
        supervisorRows,
        attendanceByType,
        trendData: buildTrendData(events, bucketMode),
        dayHour,
        rangeDays,
        bucketMode
    };
}

export function buildCustomGroupData(events, configs, metric = 'events') {
    if (!events.length || !configs.length) return [];

    const valueKey = metric === 'attendees' ? 'attendees' : 'events';
    return buildTypeBreakdownRows(events, {
        configs,
        limitCustom: false,
        sortBy: valueKey
    }).map((row) => ({
        name: row.name,
        value: row[valueKey]
    }));
}

export function buildDayHourGrid(events) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const grid = [];

    days.forEach((day, dayIndex) => {
        for (let hour = 0; hour < 24; hour += 1) {
            grid.push({ day, dayIndex, hour, label: `${day} ${String(hour).padStart(2, '0')}:00`, events: 0 });
        }
    });

    events.forEach((event) => {
        const date = validDate(event.timestamp);
        if (!date) return;
        const item = grid.find((slot) => slot.dayIndex === date.getDay() && slot.hour === date.getHours());
        if (item) item.events += 1;
    });

    return grid;
}
