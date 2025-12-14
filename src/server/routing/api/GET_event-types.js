const fileRouter = require('express').Router();

const events = require('../../../../data/events.json');

fileRouter.get('/api/event-types', async function (req, res) {
   res.json(events)
});

module.exports = fileRouter;