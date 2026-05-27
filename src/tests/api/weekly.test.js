const request = require('supertest');
const express = require('express');

// Mock dependencies
const mockListWeeklyEvents = jest.fn();
jest.mock('../../api/database', () => ({
    listWeeklyEvents: mockListWeeklyEvents,
}));

const mockGetUsernameFromId = jest.fn();
jest.mock('../../api/roblox.js', () => ({
    getUsernameFromId: mockGetUsernameFromId,
}));

// Mock Auth Middleware
jest.mock('../../server/middleware/ensureAuth.js', () => (req, res, next) => next());

const EventsController = require('../../server/controllers/EventsController.js');

const app = express();
app.get('/api/weekly', EventsController.getWeekly);

describe('GET /api/weekly', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 200 and a list of weekly events with eventId', async () => {
        const mockEvents = [
            {
                eventId: '456',
                host: 333,
                supervisor: 444,
                type: 'Training',
                timestamp: new Date().toISOString(),
            },
        ];

        mockListWeeklyEvents.mockResolvedValue(mockEvents);
        mockGetUsernameFromId.mockResolvedValue('WeeklyUser');

        const res = await request(app).get('/api/weekly');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toHaveProperty('eventId', '456');
        expect(res.body[0]).toHaveProperty('host', 'WeeklyUser');
    });
});
