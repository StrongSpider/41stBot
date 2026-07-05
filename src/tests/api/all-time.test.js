const request = require('supertest');
const express = require('express');

// Mock dependencies
const mockListAllTimeEvents = jest.fn();
jest.mock('../../api/database', () => ({
    listAllTimeEvents: mockListAllTimeEvents,
}));

const mockGetUsernameFromId = jest.fn();
jest.mock('../../api/roblox.js', () => ({
    getUsernameFromId: mockGetUsernameFromId,
}));

// Mock Auth Middleware
jest.mock('../../server/middleware/ensureAuth.js', () => (req, res, next) => next());

// Import the specific router - need to mock the require path to be relative to the test file if needed, 
// but since we are importing the router file directly, we need express app to mount it.
const EventsController = require('../../server/controllers/EventsController.js');

const app = express();
app.get('/api/all-time', EventsController.getAllTime);

describe('GET /api/all-time', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 200 and a list of events with eventId', async () => {
        const mockEvents = [
            {
                eventId: '123',
                host: 111,
                supervisor: 222,
                type: 'Raid',
                timestamp: new Date().toISOString(),
            },
        ];

        mockListAllTimeEvents.mockResolvedValue(mockEvents);
        mockGetUsernameFromId.mockResolvedValue('TestUser');

        const res = await request(app).get('/api/all-time');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toHaveProperty('eventId', '123'); // API should return camelCase
        expect(res.body[0]).toHaveProperty('host', 'TestUser');
    });

    it('should use a Roblox ID label instead of Unknown when username lookup fails', async () => {
        const mockEvents = [
            {
                eventId: 'missing-user',
                host: 111,
                supervisor: 222,
                type: 'Raid',
                timestamp: new Date().toISOString(),
            },
        ];

        mockListAllTimeEvents.mockResolvedValue(mockEvents);
        mockGetUsernameFromId.mockRejectedValue(new Error('User not found'));

        const res = await request(app).get('/api/all-time');

        expect(res.status).toBe(200);
        expect(res.body[0]).toHaveProperty('host', 'Roblox ID 111');
        expect(res.body[0]).toHaveProperty('supervisor', 'Roblox ID 222');
        expect(JSON.stringify(res.body)).not.toContain('Unknown');
    });

    it('should return null for event user fields stored as -1', async () => {
        const mockEvents = [
            {
                eventId: 'no-user',
                host: -1,
                supervisor: -1,
                type: 'Raid',
                timestamp: new Date().toISOString(),
            },
        ];

        mockListAllTimeEvents.mockResolvedValue(mockEvents);

        const res = await request(app).get('/api/all-time');

        expect(res.status).toBe(200);
        expect(res.body[0]).toHaveProperty('host', null);
        expect(res.body[0]).toHaveProperty('supervisor', null);
        expect(mockGetUsernameFromId).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
        allowLoggerErrors('getAllTime error: Error: DB Error');

        mockListAllTimeEvents.mockRejectedValue(new Error('DB Error'));

        const res = await request(app).get('/api/all-time');

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error', 'Server error');
    });
});
