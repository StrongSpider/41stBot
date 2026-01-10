const router = require('express').Router();
const apiRoutes = require('./api.js');
const AuthController = require('../controllers/AuthController.js');
const PagesController = require('../controllers/PagesController.js');

// Top level auth route (redirect)
router.get('/auth/discord', AuthController.discordLogin);

router.get('/privacy', PagesController.getPrivacy);
router.get('/tos', PagesController.getToS);

// Mount API routes
router.use('/api', apiRoutes);

module.exports = router;
