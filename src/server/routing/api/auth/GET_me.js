const fileRouter = require('express').Router();

fileRouter.get('/api/auth/me', async function (req, res) {
    if (req.session.user && !req.session.user.isHICOM) {
        res.status(403).json({ error: 'Forbidden' });
    } else if (req.session.user && Date.now() - req.session.user.lastFetched < 30 * 60 * 1000) {
        res.json(req.session.user);
    } else if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

module.exports = fileRouter;