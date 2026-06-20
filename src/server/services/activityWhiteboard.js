const { WebSocketServer, WebSocket } = require('ws');
const express = require('express');

const WHITEBOARD_PATH = '/activity/whiteboard';
const BOARD_IDS = ['board-1', 'board-2', 'board-3'];
const BOARD_ID_SET = new Set(BOARD_IDS);
const CLEANUP_GRACE_MS = 15_000;
const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_STROKES_PER_BOARD = 2_000;
const MAX_POINTS_PER_STROKE = 1_024;
const MAX_CURSOR_POINTS_PER_SECOND = 30;
const HTTP_PARTICIPANT_TTL_MS = 10_000;
const ALLOWED_TOOLS = new Set(['pen', 'eraser']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function createBoards() {
    return BOARD_IDS.reduce((boards, boardId) => {
        boards[boardId] = [];
        return boards;
    }, {});
}

function createSession(sessionId) {
    return {
        id: sessionId,
        boards: createBoards(),
        clients: new Set(),
        httpParticipants: new Map(),
        cursors: new Map(),
        cleanupTimer: null
    };
}

function parseJsonMessage(raw) {
    if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) {
        return { error: 'Unsupported message payload.' };
    }

    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
        return { error: 'Message is too large.' };
    }

    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { error: 'Message must be an object.' };
        }
        return { value };
    } catch {
        return { error: 'Message must be valid JSON.' };
    }
}

function normalizeString(value, fallback, maxLength) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    return trimmed.slice(0, maxLength);
}

function normalizeBoardId(value) {
    return BOARD_ID_SET.has(value) ? value : null;
}

function normalizeColor(value) {
    return typeof value === 'string' && COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

function normalizeSize(value) {
    const size = Number(value);
    if (!Number.isFinite(size)) return null;
    return Math.min(48, Math.max(2, Math.round(size)));
}

function normalizePoint(point) {
    if (!point || typeof point !== 'object') return null;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return {
        x: Math.round(x * 10_000) / 10_000,
        y: Math.round(y * 10_000) / 10_000
    };
}

function normalizeStroke(message, client) {
    const boardId = normalizeBoardId(message.boardId);
    if (!boardId) return { error: 'Invalid board id.' };

    const tool = ALLOWED_TOOLS.has(message.tool) ? message.tool : null;
    if (!tool) return { error: 'Invalid drawing tool.' };

    const color = tool === 'eraser' ? '#ffffff' : normalizeColor(message.color);
    if (!color) return { error: 'Invalid stroke color.' };

    const size = normalizeSize(message.size);
    if (!size) return { error: 'Invalid brush size.' };

    if (!Array.isArray(message.points) || message.points.length < 1 || message.points.length > MAX_POINTS_PER_STROKE) {
        return { error: 'Invalid stroke points.' };
    }

    const points = message.points.map(normalizePoint);
    if (points.some(point => !point)) return { error: 'Stroke points must be normalized.' };

    return {
        stroke: {
            id: normalizeString(message.id, `${client.id}-${Date.now()}`, 80),
            boardId,
            userId: client.userId,
            username: client.username,
            tool,
            color,
            size,
            points,
            createdAt: Date.now()
        }
    };
}

function normalizeCursor(message, client) {
    const boardId = normalizeBoardId(message.boardId);
    if (!boardId) return { error: 'Invalid board id.' };

    const point = normalizePoint(message.point);
    if (!point) return { error: 'Invalid cursor point.' };

    return {
        cursor: {
            boardId,
            userId: client.userId,
            username: client.username,
            color: normalizeColor(message.color) || '#2563eb',
            point,
            updatedAt: Date.now()
        }
    };
}

function pruneHttpParticipants(session) {
    const cutoff = Date.now() - HTTP_PARTICIPANT_TTL_MS;
    for (const [userId, participant] of session.httpParticipants) {
        if (participant.lastSeenAt >= cutoff) continue;
        session.httpParticipants.delete(userId);
        session.cursors.delete(`http:${userId}`);
    }
}

function serializeSession(session) {
    pruneHttpParticipants(session);

    const participants = Array.from(session.clients).map(client => ({
        userId: client.userId,
        username: client.username,
        color: client.color
    }));

    for (const participant of session.httpParticipants.values()) {
        if (participants.some(existing => existing.userId === participant.userId)) continue;
        participants.push({
            userId: participant.userId,
            username: participant.username,
            color: participant.color
        });
    }

    return {
        boards: session.boards,
        participants,
        cursors: Array.from(session.cursors.values())
    };
}

function safeSend(client, payload) {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    client.socket.send(JSON.stringify(payload));
}

function broadcast(session, payload, exceptClient = null) {
    for (const client of session.clients) {
        if (client === exceptClient) continue;
        safeSend(client, payload);
    }
}

function broadcastParticipants(session) {
    broadcast(session, {
        type: 'participants',
        participants: serializeSession(session).participants
    });
}

function removeClient(session, client, sessions, cleanupGraceMs) {
    if (client.closed) return;
    client.closed = true;
    session.clients.delete(client);
    session.cursors.delete(client.id);
    broadcast(session, { type: 'cursor', action: 'remove', userId: client.userId });
    broadcastParticipants(session);

    maybeScheduleSessionCleanup(session, sessions, cleanupGraceMs);
}

function getSession(sessions, sessionId) {
    let session = sessions.get(sessionId);
    if (!session) {
        session = createSession(sessionId);
        sessions.set(sessionId, session);
    }

    if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
    }

    return session;
}

function maybeScheduleSessionCleanup(session, sessions, cleanupGraceMs) {
    pruneHttpParticipants(session);
    if (session.clients.size !== 0 || session.httpParticipants.size !== 0 || session.cleanupTimer) return;

    session.cleanupTimer = setTimeout(() => {
        const current = sessions.get(session.id);
        if (!current) return;
        pruneHttpParticipants(current);
        if (current.clients.size === 0 && current.httpParticipants.size === 0) {
            sessions.delete(session.id);
        }
    }, cleanupGraceMs);
}

function normalizeHttpClient(body = {}, query = {}) {
    const sessionId = normalizeString(body.sessionId || query.sessionId, 'browser-preview', 120);
    const userId = normalizeString(body.userId || query.userId, `guest-${Math.random().toString(36).slice(2)}`, 80);
    const username = normalizeString(body.username || query.username, 'Guest', 40);
    const color = normalizeColor(body.color || query.color) || '#2563eb';

    return {
        sessionId,
        client: {
            id: `http:${userId}`,
            userId,
            username,
            color
        }
    };
}

function touchHttpParticipant(session, client) {
    session.httpParticipants.set(client.userId, {
        userId: client.userId,
        username: client.username,
        color: client.color,
        lastSeenAt: Date.now()
    });
}

function createActivityWhiteboardRouter(sessions, options = {}) {
    const { cleanupGraceMs = CLEANUP_GRACE_MS } = options;
    const router = express.Router();

    router.get('/state', (req, res) => {
        const { sessionId, client } = normalizeHttpClient({}, req.query);
        const session = getSession(sessions, sessionId);
        touchHttpParticipant(session, client);
        res.json({ type: 'init', sessionId, self: client, ...serializeSession(session) });
    });

    router.post('/stroke', (req, res) => {
        const { sessionId, client } = normalizeHttpClient(req.body);
        const session = getSession(sessions, sessionId);
        touchHttpParticipant(session, client);

        const normalized = normalizeStroke(req.body, client);
        if (normalized.error) return res.status(400).json({ type: 'error', error: normalized.error });

        const board = session.boards[normalized.stroke.boardId];
        if (!board.some(stroke => stroke.id === normalized.stroke.id)) {
            board.push(normalized.stroke);
            if (board.length > MAX_STROKES_PER_BOARD) {
                board.splice(0, board.length - MAX_STROKES_PER_BOARD);
            }
        }

        broadcast(session, { type: 'stroke', stroke: normalized.stroke });
        res.json({ ok: true, stroke: normalized.stroke });
    });

    router.post('/undo', (req, res) => {
        const { sessionId, client } = normalizeHttpClient(req.body);
        const session = getSession(sessions, sessionId);
        touchHttpParticipant(session, client);

        const boardId = normalizeBoardId(req.body.boardId);
        if (!boardId) return res.status(400).json({ type: 'error', error: 'Invalid board id.' });

        const board = session.boards[boardId];
        const index = board.findLastIndex(stroke => stroke.userId === client.userId);
        if (index !== -1) {
            const [stroke] = board.splice(index, 1);
            broadcast(session, { type: 'undo', boardId, strokeId: stroke.id, userId: client.userId });
        }

        res.json({ ok: true });
    });

    router.post('/clear', (req, res) => {
        const { sessionId, client } = normalizeHttpClient(req.body);
        const session = getSession(sessions, sessionId);
        touchHttpParticipant(session, client);

        const boardId = normalizeBoardId(req.body.boardId);
        if (!boardId) return res.status(400).json({ type: 'error', error: 'Invalid board id.' });

        session.boards[boardId] = [];
        broadcast(session, { type: 'clear', boardId, userId: client.userId, username: client.username });
        res.json({ ok: true });
    });

    router.post('/cursor', (req, res) => {
        const { sessionId, client } = normalizeHttpClient(req.body);
        const session = getSession(sessions, sessionId);
        touchHttpParticipant(session, client);

        const normalized = normalizeCursor(req.body, client);
        if (normalized.error) return res.status(400).json({ type: 'error', error: normalized.error });

        session.cursors.set(client.id, normalized.cursor);
        broadcast(session, { type: 'cursor', action: 'update', cursor: normalized.cursor });
        res.json({ ok: true });
    });

    router.post('/leave', (req, res) => {
        const { sessionId, client } = normalizeHttpClient(req.body);
        const session = sessions.get(sessionId);
        if (session) {
            session.httpParticipants.delete(client.userId);
            session.cursors.delete(client.id);
            maybeScheduleSessionCleanup(session, sessions, cleanupGraceMs);
        }
        res.json({ ok: true });
    });

    return router;
}

function createActivityWhiteboardServer(server, options = {}) {
    const {
        path = WHITEBOARD_PATH,
        cleanupGraceMs = CLEANUP_GRACE_MS
    } = options;
    const sessions = new Map();
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    const router = createActivityWhiteboardRouter(sessions, { cleanupGraceMs });

    server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname !== path) return;

        wss.handleUpgrade(request, socket, head, ws => {
            wss.emit('connection', ws, request, url);
        });
    });

    wss.on('connection', (socket, request, url) => {
        let client = null;
        let session = null;
        let recentCursorSentAt = 0;

        socket.on('message', raw => {
            const parsed = parseJsonMessage(raw);
            if (parsed.error) {
                if (client) safeSend(client, { type: 'error', error: parsed.error });
                return;
            }

            const message = parsed.value;

            if (!client) {
                if (message.type !== 'join') {
                    socket.send(JSON.stringify({ type: 'error', error: 'Join required before whiteboard messages.' }));
                    return;
                }

                const sessionId = normalizeString(
                    message.sessionId || url.searchParams.get('instance_id'),
                    'browser-preview',
                    120
                );
                const userId = normalizeString(message.userId, `guest-${Math.random().toString(36).slice(2)}`, 80);
                const username = normalizeString(message.username, 'Guest', 40);
                const color = normalizeColor(message.color) || '#2563eb';

                session = getSession(sessions, sessionId);
                client = {
                    id: `${userId}-${Math.random().toString(36).slice(2)}`,
                    userId,
                    username,
                    color,
                    socket,
                    closed: false
                };
                session.clients.add(client);

                safeSend(client, {
                    type: 'init',
                    sessionId,
                    self: { userId, username, color },
                    ...serializeSession(session)
                });
                broadcastParticipants(session);
                return;
            }

            if (message.type === 'stroke') {
                const normalized = normalizeStroke(message, client);
                if (normalized.error) {
                    safeSend(client, { type: 'error', error: normalized.error });
                    return;
                }

                const board = session.boards[normalized.stroke.boardId];
                board.push(normalized.stroke);
                if (board.length > MAX_STROKES_PER_BOARD) {
                    board.splice(0, board.length - MAX_STROKES_PER_BOARD);
                }
                broadcast(session, { type: 'stroke', stroke: normalized.stroke }, client);
                return;
            }

            if (message.type === 'undo') {
                const boardId = normalizeBoardId(message.boardId);
                if (!boardId) {
                    safeSend(client, { type: 'error', error: 'Invalid board id.' });
                    return;
                }

                const board = session.boards[boardId];
                const index = board.findLastIndex(stroke => stroke.userId === client.userId);
                if (index === -1) return;

                const [stroke] = board.splice(index, 1);
                broadcast(session, { type: 'undo', boardId, strokeId: stroke.id, userId: client.userId }, client);
                return;
            }

            if (message.type === 'clear') {
                const boardId = normalizeBoardId(message.boardId);
                if (!boardId) {
                    safeSend(client, { type: 'error', error: 'Invalid board id.' });
                    return;
                }

                session.boards[boardId] = [];
                broadcast(session, { type: 'clear', boardId, userId: client.userId, username: client.username }, client);
                return;
            }

            if (message.type === 'cursor') {
                const now = Date.now();
                if (now - recentCursorSentAt < 1000 / MAX_CURSOR_POINTS_PER_SECOND) return;
                recentCursorSentAt = now;

                const normalized = normalizeCursor(message, client);
                if (normalized.error) return;
                session.cursors.set(client.id, normalized.cursor);
                broadcast(session, { type: 'cursor', action: 'update', cursor: normalized.cursor }, client);
                return;
            }

            safeSend(client, { type: 'error', error: 'Unknown whiteboard message type.' });
        });

        socket.on('close', () => {
            if (client && session) removeClient(session, client, sessions, cleanupGraceMs);
        });

        socket.on('error', () => {
            if (client && session) removeClient(session, client, sessions, cleanupGraceMs);
        });

        request.socket.on('error', () => {});
    });

    return { wss, sessions, router };
}

module.exports = {
    BOARD_IDS,
    WHITEBOARD_PATH,
    createActivityWhiteboardServer,
    createActivityWhiteboardRouter,
    parseJsonMessage,
    normalizeStroke,
    normalizeCursor
};
