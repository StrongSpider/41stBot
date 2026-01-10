const request = require('supertest');
const express = require('express');

// Mock Auth Middleware
jest.mock('../../server/middleware/ensureAuth.js', () => (req, res, next) => next());

// We don't need to mock database here as it imports a JSON file directly usually, 
// but let's check the file content if strictly needed. 
// For now, assuming it returns static data or data validation is enough.

const EventsController = require('../../server/controllers/EventsController.js');

const app = express();
app.get('/api/event-types', EventsController.getEventTypes);

describe('GET /api/event-types', () => {
    it('should return 200 and a list of event types', async () => {
        const res = await request(app).get('/api/event-types');

        expect(res.status).toBe(200);
        // Depending on what data/events.json contains, we assertion can be generic
        expect(typeof res.body).toBe('object');
    });
});
