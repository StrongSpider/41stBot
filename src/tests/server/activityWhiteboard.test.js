const http = require('http');
const WebSocket = require('ws');
const {
    createActivityWhiteboardServer,
    parseJsonMessage,
    normalizeStroke
} = require('../../server/services/activityWhiteboard.js');

function waitForServer(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}

function waitForSocketOpen(socket) {
    return new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
}

function waitForMessage(socket, predicate = () => true) {
    return new Promise(resolve => {
        const handler = raw => {
            const message = JSON.parse(raw.toString());
            if (!predicate(message)) return;
            socket.off('message', handler);
            resolve(message);
        };
        socket.on('message', handler);
    });
}

async function createJoinedClient(url, userId) {
    const socket = new WebSocket(url);
    await waitForSocketOpen(socket);
    socket.send(JSON.stringify({
        type: 'join',
        sessionId: 'test-session',
        userId,
        username: userId,
        color: '#2563eb'
    }));
    await waitForMessage(socket, message => message.type === 'init');
    return socket;
}

describe('activity whiteboard service', () => {
    test('rejects invalid JSON payloads', () => {
        expect(parseJsonMessage('{bad json')).toEqual({ error: 'Message must be valid JSON.' });
    });

    test('validates normalized stroke input', () => {
        const result = normalizeStroke({
            id: 'stroke-1',
            boardId: 'board-1',
            tool: 'pen',
            color: '#111827',
            size: 12,
            points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]
        }, {
            id: 'client-1',
            userId: 'user-1',
            username: 'User 1'
        });

        expect(result.stroke).toMatchObject({
            id: 'stroke-1',
            boardId: 'board-1',
            userId: 'user-1',
            tool: 'pen',
            color: '#111827',
            size: 12
        });
    });

    test('broadcasts strokes to other participants and cleans up empty sessions', async () => {
        const server = http.createServer();
        const whiteboard = createActivityWhiteboardServer(server, { cleanupGraceMs: 20 });
        await waitForServer(server);
        const { port } = server.address();
        const url = `ws://127.0.0.1:${port}/activity/whiteboard?instance_id=test-session`;

        const first = await createJoinedClient(url, 'user-1');
        const second = await createJoinedClient(url, 'user-2');

        const strokeMessage = waitForMessage(second, message => message.type === 'stroke');
        first.send(JSON.stringify({
            type: 'stroke',
            id: 'stroke-1',
            boardId: 'board-1',
            tool: 'pen',
            color: '#111827',
            size: 8,
            points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }]
        }));

        await expect(strokeMessage).resolves.toMatchObject({
            type: 'stroke',
            stroke: {
                id: 'stroke-1',
                boardId: 'board-1',
                userId: 'user-1'
            }
        });

        expect(whiteboard.sessions.get('test-session').boards['board-1']).toHaveLength(1);

        first.close();
        second.close();

        await new Promise(resolve => setTimeout(resolve, 50));
        expect(whiteboard.sessions.has('test-session')).toBe(false);

        await new Promise(resolve => whiteboard.wss.close(resolve));
        await new Promise(resolve => server.close(resolve));
    });
});
