module.exports = function ensureAuth(req, res, next) {
    if (!req.session?.user?.id) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}