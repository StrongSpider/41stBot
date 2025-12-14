const fileRouter = require('express').Router();

fileRouter.get('/api/auth/me', async function (req, res) {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

module.exports = fileRouter;