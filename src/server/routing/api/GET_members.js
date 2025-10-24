const fileRouter = require('express').Router();
const getMembers = require('../util/getMembers.js');

fileRouter.get('/api/members', async function (req, res) {
    try {
        const members = await getMembers()
        res.status(200).json(members);
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).send('Error fetching members');
    }
});

module.exports = fileRouter;