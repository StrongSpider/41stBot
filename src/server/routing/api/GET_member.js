const fileRouter = require('express').Router();
const getMembers = require('../util/getMembers.js');

fileRouter.get('/api/member/:id', async function (req, res) {
    try {
        const members = await getMembers()
        const memberIndex = members.findIndex(member => {
            return member.username == req.params.username;
        })

        if (memberIndex === -1) {
            return res.status(404).json({ error: 'Member not found' });
        }

        res.status(200).json(members[memberIndex]);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching members');
    }
});

module.exports = fileRouter;