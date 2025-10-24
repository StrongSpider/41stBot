const fileRouter = require('express').Router();

fileRouter.post('/api/auth/logout', async function (req, res) {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

module.exports = fileRouter;