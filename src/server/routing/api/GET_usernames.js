const fileRouter = require('express').Router();
const roblox = require('../../../api/roblox.js');

fileRouter.get('/api/usernames', async function (req, res) {
    const ids = req.query.ids ? req.query.ids.split(',').map(Number).filter(id => !isNaN(id)) : [];
    
    if (!ids.length) return res.json({});

    const results = {};
    for (const id of ids) {
        results[id] = await roblox.getUsernameFromId(id)
    }

    res.json(results);
});

module.exports = fileRouter;