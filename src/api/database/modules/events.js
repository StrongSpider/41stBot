'use strict';

const { randomUUID } = require('node:crypto');
const { prisma } = require('../connection');
const { ensureTimestamp, toId, toBigInt, toNumOrNull, assertSafeEventType } = require('../utils');
const {
    EVENT_TYPES_CACHE_TTL_MS,
    EVENT_TYPE_USAGE_CACHE_TTL_MS
} = require('../constants');
const { assertEventEpWriteUnlocked } = require('./botState');

let _eventTypesCache = null;
let _eventTypesInFlight = null;
let _rankedEventTypesCache = null;
let _rankedEventTypesInFlight = null;

function mapEvent(row) {
    if (!row) return null;
    return {
        eventId: String(row.eventId),
        attendees: (row.attendees || []).map((id) => Number(id)),
        host: Number(row.host),
        supervisor: Number(row.supervisor),
        timestamp: ensureTimestamp(row.timestamp),
        type: row.type,
        message: row.message
    };
}

function mapEventUpdate(updates) {
    const data = {};
    if (updates.attendees !== undefined) data.attendees = updates.attendees.map((id) => toBigInt(id));
    if (updates.host !== undefined) data.host = toBigInt(updates.host);
    if (updates.supervisor !== undefined) data.supervisor = toBigInt(updates.supervisor);
    if (updates.timestamp !== undefined) data.timestamp = new Date(ensureTimestamp(updates.timestamp));
    if (updates.type !== undefined) data.type = updates.type;
    if (updates.message !== undefined) data.message = updates.message;
    return data;
}

function uniqueIds(ids) {
    return [...new Set((ids || []).map((id) => toId(id)))];
}

async function _loadEventTypesFromDb() {
    const rows = await prisma.eventType.findMany({ select: { type: true } });
    return rows.map((row) => String(row.type));
}

async function _loadRankedEventTypesFromDb(refresh) {
    const [eventTypes, countRows] = await Promise.all([
        getEventTypes(refresh ? { refresh: true } : undefined),
        prisma.allTimeEvent.groupBy({
            by: ['type'],
            where: { type: { not: null } },
            _count: { type: true }
        })
    ]);

    const counts = new Map(
        countRows.map((row) => [String(row.type), Number(row._count.type) || 0])
    );

    return [...eventTypes].sort((a, b) => {
        const countDiff = (counts.get(b) || 0) - (counts.get(a) || 0);
        if (countDiff !== 0) return countDiff;
        return a.localeCompare(b);
    });
}

async function getEventTypes(opts) {
    const refresh = opts && opts.refresh === true;
    const now = Date.now();
    if (!refresh && _eventTypesCache && _eventTypesCache.expiresAt > now) return _eventTypesCache.data;
    if (!refresh && _eventTypesInFlight) return _eventTypesInFlight;
    _eventTypesInFlight = (async () => {
        const data = await _loadEventTypesFromDb();
        _eventTypesCache = { data, expiresAt: now + EVENT_TYPES_CACHE_TTL_MS };
        _eventTypesInFlight = null;
        return data;
    })();
    return _eventTypesInFlight;
}

async function getRankedEventTypes(opts) {
    const refresh = opts && opts.refresh === true;
    const now = Date.now();
    if (!refresh && _rankedEventTypesCache && _rankedEventTypesCache.expiresAt > now) {
        return _rankedEventTypesCache.data;
    }
    if (!refresh && _rankedEventTypesInFlight) return _rankedEventTypesInFlight;

    _rankedEventTypesInFlight = (async () => {
        const data = await _loadRankedEventTypesFromDb(refresh);
        _rankedEventTypesCache = { data, expiresAt: now + EVENT_TYPE_USAGE_CACHE_TTL_MS };
        _rankedEventTypesInFlight = null;
        return data;
    })();

    return _rankedEventTypesInFlight;
}

async function addEventType(type) {
    const t = String(assertSafeEventType(type));
    await prisma.eventType.upsert({
        where: { type: t },
        create: { type: t },
        update: {}
    });
    if (_eventTypesCache) {
        if (!_eventTypesCache.data.includes(t)) _eventTypesCache.data.push(t);
        _eventTypesCache.expiresAt = Date.now() + EVENT_TYPES_CACHE_TTL_MS;
    }
    clearRankedEventTypesCache();
    return t;
}

async function removeEventType(type) {
    const t = String(assertSafeEventType(type));
    await prisma.eventType.deleteMany({ where: { type: t } });
    if (_eventTypesCache) {
        _eventTypesCache.data = _eventTypesCache.data.filter((x) => x !== t);
        _eventTypesCache.expiresAt = Date.now() + EVENT_TYPES_CACHE_TTL_MS;
    }
    clearRankedEventTypesCache();
}

function clearEventTypesCache() {
    _eventTypesCache = null;
    _eventTypesInFlight = null;
}

function clearRankedEventTypesCache() {
    _rankedEventTypesCache = null;
    _rankedEventTypesInFlight = null;
}

async function _idToUsernameSafe(id) {
    const n = Number(id);
    if (!isFinite(n) || n === -1) return '';
    try {
        const { getUsernameFromId } = require('../../roblox');
        const name = await getUsernameFromId(n);
        return name || '';
    } catch {
        return '';
    }
}

async function _eventDataWithUsernames(ev) {
    if (!ev || typeof ev !== 'object') return ev;
    const hostName = await _idToUsernameSafe(ev.host);
    const supervisorName = await _idToUsernameSafe(ev.supervisor);
    const attendeeNames = await Promise.all((Array.isArray(ev.attendees) ? ev.attendees : []).map(_idToUsernameSafe));
    const filtered = attendeeNames.filter(Boolean);
    return {
        ...ev,
        host: hostName || '',
        supervisor: supervisorName || '',
        attendees: filtered
    };
}

async function upsertEventIndex(tx, modelName, robloxId, eventId) {
    const rid = toBigInt(robloxId);
    const existing = await tx[modelName].findUnique({
        where: { robloxId: rid },
        select: { events: true }
    });

    const events = existing && Array.isArray(existing.events) ? existing.events.map(String) : [];
    if (!events.includes(String(eventId))) events.push(String(eventId));

    await tx[modelName].upsert({
        where: { robloxId: rid },
        create: { robloxId: rid, events },
        update: { events }
    });
}

async function removeEventIndex(tx, modelName, robloxId, eventId) {
    const rid = toBigInt(robloxId);
    const existing = await tx[modelName].findUnique({
        where: { robloxId: rid },
        select: { events: true }
    });
    if (!existing) return;

    await tx[modelName].update({
        where: { robloxId: rid },
        data: { events: existing.events.map(String).filter((id) => id !== String(eventId)) }
    });
}

async function indexEventForUser(robloxId, eventId) {
    await prisma.$transaction(async (tx) => {
        await upsertEventIndex(tx, 'weeklyEventIndex', robloxId, eventId);
        await upsertEventIndex(tx, 'allTimeEventIndex', robloxId, eventId);
    });
}

async function unindexEventForUser(robloxId, eventId) {
    await prisma.$transaction(async (tx) => {
        await removeEventIndex(tx, 'weeklyEventIndex', robloxId, eventId);
        await removeEventIndex(tx, 'allTimeEventIndex', robloxId, eventId);
    });
}

function indexedUsersForEvent(event) {
    if (!event) return [];
    return uniqueIds([...(event.attendees || []), event.host]);
}

async function createWeeklyEvent(data) {
    await assertEventEpWriteUnlocked();
    const attendees = (data.attendees || []).map(toBigInt);
    const host = toBigInt(data.host);
    const supervisor = toBigInt(data.supervisor);
    const timestamp = new Date(ensureTimestamp(data.timestamp));
    const eventId = randomUUID();

    await prisma.$transaction(async (tx) => {
        const eventData = {
            eventId,
            attendees,
            host,
            supervisor,
            timestamp,
            type: data.type,
            message: data.message
        };

        await tx.weeklyEvent.create({ data: eventData });
        await tx.allTimeEvent.create({ data: eventData });

        for (const uid of uniqueIds([...attendees, host])) {
            await upsertEventIndex(tx, 'weeklyEventIndex', uid, eventId);
            await upsertEventIndex(tx, 'allTimeEventIndex', uid, eventId);
        }
    });

    clearRankedEventTypesCache();
    return eventId;
}

async function getWeeklyEvent(eventId) {
    const row = await prisma.weeklyEvent.findUnique({ where: { eventId: String(eventId) } });
    return mapEvent(row);
}

async function getAllTimeEventById(eventId) {
    const row = await prisma.allTimeEvent.findUnique({ where: { eventId: String(eventId) } });
    return mapEvent(row);
}

async function findEventByMessage(messageUrl) {
    const row = await prisma.allTimeEvent.findFirst({
        where: { message: messageUrl }
    });
    return mapEvent(row);
}

async function updateWeeklyEvent(eventId, updates) {
    await assertEventEpWriteUnlocked();
    const oldData = await getWeeklyEvent(eventId);
    if (!oldData) throw new Error(`Weekly event ${eventId} not found`);

    const data = mapEventUpdate(updates);
    await prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) {
            await tx.weeklyEvent.update({ where: { eventId: String(eventId) }, data });
            await tx.allTimeEvent.update({ where: { eventId: String(eventId) }, data });
        }

        const newData = { ...oldData, ...updates };
        const oldIndexed = indexedUsersForEvent(oldData);
        const newIndexed = indexedUsersForEvent(newData);

        for (const uid of oldIndexed.filter((id) => !newIndexed.includes(id))) {
            await removeEventIndex(tx, 'weeklyEventIndex', uid, eventId);
            await removeEventIndex(tx, 'allTimeEventIndex', uid, eventId);
        }
        for (const uid of newIndexed.filter((id) => !oldIndexed.includes(id))) {
            await upsertEventIndex(tx, 'weeklyEventIndex', uid, eventId);
            await upsertEventIndex(tx, 'allTimeEventIndex', uid, eventId);
        }
    });
    clearRankedEventTypesCache();
}

async function updateWeeklyEventPartial(eventId, updates) {
    return updateWeeklyEvent(eventId, updates);
}

async function updateAllTimeEvent(eventId, updates) {
    await assertEventEpWriteUnlocked();
    const data = mapEventUpdate(updates);
    if (Object.keys(data).length) {
        await prisma.$transaction([
            prisma.allTimeEvent.updateMany({ where: { eventId: String(eventId) }, data }),
            prisma.weeklyEvent.updateMany({ where: { eventId: String(eventId) }, data })
        ]);
    }
    clearRankedEventTypesCache();
}

async function deleteEventById(eventId) {
    await assertEventEpWriteUnlocked();
    const weeklyData = await getWeeklyEvent(eventId);
    if (weeklyData) {
        await prisma.$transaction(async (tx) => {
            await tx.weeklyEvent.deleteMany({ where: { eventId: String(eventId) } });
            await tx.allTimeEvent.deleteMany({ where: { eventId: String(eventId) } });
            const attendees = Array.isArray(weeklyData.attendees) ? [...weeklyData.attendees] : [];
            if (!attendees.includes(weeklyData.host)) attendees.push(weeklyData.host);
            if (!attendees.includes(weeklyData.supervisor)) attendees.push(weeklyData.supervisor);
            for (const uid of attendees) {
                await removeEventIndex(tx, 'weeklyEventIndex', uid, eventId);
                await removeEventIndex(tx, 'allTimeEventIndex', uid, eventId);
            }
        });
        clearRankedEventTypesCache();
        return;
    }

    const historyData = await getAllTimeEventById(eventId);
    if (historyData) {
        await prisma.$transaction(async (tx) => {
            await tx.allTimeEvent.deleteMany({ where: { eventId: String(eventId) } });
            const attendees = Array.isArray(historyData.attendees) ? historyData.attendees : [];
            for (const uid of attendees) {
                await removeEventIndex(tx, 'weeklyEventIndex', uid, eventId);
                await removeEventIndex(tx, 'allTimeEventIndex', uid, eventId);
            }
        });
        clearRankedEventTypesCache();
    }
}

async function deleteAllTimeEventById(eventId) {
    await assertEventEpWriteUnlocked();
    const oldWeekly = await getWeeklyEvent(eventId);
    await prisma.$transaction(async (tx) => {
        await tx.allTimeEvent.deleteMany({ where: { eventId: String(eventId) } });
        await tx.weeklyEvent.deleteMany({ where: { eventId: String(eventId) } });
        const attendees = oldWeekly && Array.isArray(oldWeekly.attendees) ? [...oldWeekly.attendees] : [];
        if (oldWeekly) {
            if (!attendees.includes(oldWeekly.host)) attendees.push(oldWeekly.host);
            if (!attendees.includes(oldWeekly.supervisor)) attendees.push(oldWeekly.supervisor);
        }
        for (const uid of attendees) {
            await removeEventIndex(tx, 'weeklyEventIndex', uid, eventId);
            await removeEventIndex(tx, 'allTimeEventIndex', uid, eventId);
        }
    });
    clearRankedEventTypesCache();
}

async function listWeeklyEvents() {
    const rows = await prisma.weeklyEvent.findMany();
    return rows.map(mapEvent);
}

async function getWeeklyEventIds() {
    const rows = await prisma.weeklyEvent.findMany({ select: { eventId: true } });
    return rows.map((row) => String(row.eventId));
}

async function listAllTimeEvents() {
    const rows = await prisma.allTimeEvent.findMany();
    return rows.map(mapEvent);
}

async function getWeeklyEventIdsForUser(robloxId) {
    const row = await prisma.weeklyEventIndex.findUnique({
        where: { robloxId: toBigInt(robloxId) },
        select: { events: true }
    });
    return row && Array.isArray(row.events) ? row.events.map(String) : [];
}

async function getAllTimeEventIdsForUser(robloxId) {
    const row = await prisma.allTimeEventIndex.findUnique({
        where: { robloxId: toBigInt(robloxId) },
        select: { events: true }
    });
    return row && Array.isArray(row.events) ? row.events.map(String) : [];
}

async function incrementAllTimeEventPoints(robloxId, delta) {
    await assertEventEpWriteUnlocked();
    return incrementAllTimeEventPointsUnsafe(robloxId, delta);
}

async function incrementAllTimeEventPointsUnsafe(robloxId, delta) {
    const rid = toBigInt(robloxId);
    await prisma.allTimeEventPoints.upsert({
        where: { robloxId: rid },
        create: { robloxId: rid, eventPoints: Number(delta) },
        update: { eventPoints: { increment: Number(delta) } }
    });
}

async function getCurrentEventPoints(robloxId) {
    const row = await prisma.eventPoints.findUnique({
        where: { robloxId: toBigInt(robloxId) },
        select: { eventPoints: true }
    });
    return row ? Number(row.eventPoints) : 0;
}

async function setCurrentEventPoints(robloxId, points) {
    await assertEventEpWriteUnlocked();
    const rid = toBigInt(robloxId);
    const oldPoints = await getCurrentEventPoints(rid);

    await prisma.eventPoints.upsert({
        where: { robloxId: rid },
        create: { robloxId: rid, eventPoints: Number(points) },
        update: { eventPoints: Number(points) }
    });

    const delta = Number(points) - Number(oldPoints);
    if (delta !== 0) {
        await incrementAllTimeEventPointsUnsafe(rid, delta);
    }
}

async function incrementCurrentEventPoints(robloxId, delta) {
    await assertEventEpWriteUnlocked();
    const rid = toBigInt(robloxId);
    await prisma.eventPoints.upsert({
        where: { robloxId: rid },
        create: { robloxId: rid, eventPoints: Number(delta) },
        update: { eventPoints: { increment: Number(delta) } }
    });
    await incrementAllTimeEventPointsUnsafe(rid, Number(delta));
}

async function getAllTimeEventPoints(robloxId) {
    const row = await prisma.allTimeEventPoints.findUnique({
        where: { robloxId: toBigInt(robloxId) },
        select: { eventPoints: true }
    });
    return row ? Number(row.eventPoints) : 0;
}

async function setAllTimeEventPoints(robloxId, points) {
    await assertEventEpWriteUnlocked();
    const rid = toBigInt(robloxId);
    await prisma.allTimeEventPoints.upsert({
        where: { robloxId: rid },
        create: { robloxId: rid, eventPoints: Number(points) },
        update: { eventPoints: Number(points) }
    });
}

async function getAllTimeEventPointsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const rows = await prisma.allTimeEventPoints.findMany({
        where: { robloxId: { in: robloxIds.map(toBigInt) } },
        select: { robloxId: true, eventPoints: true }
    });
    const map = new Map(rows.map((row) => [String(row.robloxId), Number(row.eventPoints)]));
    return robloxIds.map((id) => ({
        robloxId: id,
        eventPoints: map.get(String(id)) || 0
    }));
}

async function getAllUsersAllTimeEventPoints() {
    const rows = await prisma.allTimeEventPoints.findMany({
        select: { robloxId: true, eventPoints: true }
    });
    return rows.map((row) => ({
        robloxId: String(row.robloxId),
        eventPoints: Number(row.eventPoints)
    }));
}

async function getUsersWithWeeklyEvents() {
    const rows = await prisma.$queryRaw`
        SELECT robloxid FROM weekly_events_index WHERE array_length(events, 1) > 0
    `;
    return rows.map((row) => String(row.robloxid));
}

async function getCurrentEventPointsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const rows = await prisma.eventPoints.findMany({
        where: { robloxId: { in: robloxIds.map(toBigInt) } },
        select: { robloxId: true, eventPoints: true }
    });
    const map = new Map(rows.map((row) => [String(row.robloxId), Number(row.eventPoints)]));
    return robloxIds.map((robloxId) => ({
        robloxId,
        eventPoints: map.get(String(robloxId)) || 0
    }));
}

async function getWeeklyUserEventsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const rows = await prisma.weeklyEventIndex.findMany({
        where: { robloxId: { in: robloxIds.map(toBigInt) } },
        select: { robloxId: true, events: true }
    });
    const map = new Map(rows.map((row) => [String(row.robloxId), row.events.map(String)]));
    return robloxIds.map((robloxId) => ({
        robloxId,
        events: map.get(String(robloxId)) || []
    }));
}

async function getAllTimeUserEventsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const rows = await prisma.allTimeEventIndex.findMany({
        where: { robloxId: { in: robloxIds.map(toBigInt) } },
        select: { robloxId: true, events: true }
    });
    const map = new Map(rows.map((row) => [String(row.robloxId), row.events.map(String)]));
    return robloxIds.map((robloxId) => ({
        robloxId,
        events: map.get(String(robloxId)) || []
    }));
}

async function getWeeklyEventsBatch(eventIds) {
    if (!eventIds.length) return [];
    const rows = await prisma.weeklyEvent.findMany({
        where: { eventId: { in: eventIds.map(String) } },
        select: { eventId: true, type: true, message: true, host: true }
    });
    const map = new Map(rows.map((row) => [String(row.eventId), row]));
    return eventIds.map((id) => {
        const d = map.get(String(id)) || {};
        return {
            eventId: id,
            type: d.type || null,
            message: d.message || null,
            host: toNumOrNull(d.host)
        };
    });
}

async function getAllTimeEventsBatch(eventIds) {
    if (!eventIds.length) return [];
    const rows = await prisma.allTimeEvent.findMany({
        where: { eventId: { in: eventIds.map(String) } },
        select: { eventId: true, type: true, message: true, host: true, timestamp: true }
    });
    const map = new Map(rows.map((row) => [String(row.eventId), row]));
    return eventIds.map((id) => {
        const d = map.get(String(id)) || {};
        return {
            eventId: id,
            type: d.type || null,
            message: d.message || null,
            timestamp: d.timestamp || null,
            host: toNumOrNull(d.host)
        };
    });
}

async function resetAllEventPoints() {
    await assertEventEpWriteUnlocked();
    return prisma.eventPoints.deleteMany();
}

module.exports = {
    getEventTypes,
    getRankedEventTypes,
    addEventType,
    removeEventType,
    clearEventTypesCache,
    clearRankedEventTypesCache,
    indexEventForUser,
    unindexEventForUser,
    createWeeklyEvent,
    getWeeklyEvent,
    getAllTimeEventById,
    findEventByMessage,
    updateWeeklyEvent,
    updateWeeklyEventPartial,
    updateAllTimeEvent,
    deleteEventById,
    deleteAllTimeEventById,
    listWeeklyEvents,
    listAllTimeEvents,
    getWeeklyEventIds,
    getWeeklyEventIdsForUser,
    getAllTimeEventIdsForUser,
    incrementAllTimeEventPoints,
    getCurrentEventPoints,
    setCurrentEventPoints,
    incrementCurrentEventPoints,
    getAllTimeEventPoints,
    setAllTimeEventPoints,
    getAllTimeEventPointsBatch,
    getAllUsersAllTimeEventPoints,
    getUsersWithWeeklyEvents,
    getCurrentEventPointsBatch,
    getWeeklyUserEventsBatch,
    getAllTimeUserEventsBatch,
    getWeeklyEventsBatch,
    getAllTimeEventsBatch,
    resetAllEventPoints,
    _eventDataWithUsernames
};
