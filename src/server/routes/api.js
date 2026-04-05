const router = require('express').Router();
const ensureAuth = require('../middleware/ensureAuth.js');

// Controllers
const MembersController = require('../controllers/MembersController.js');
const EventsController = require('../controllers/EventsController.js');
const QuotasController = require('../controllers/QuotasController.js');
const AuthController = require('../controllers/AuthController.js');
const DiscordController = require('../controllers/DiscordController.js');
const RobloxAuthController = require('../controllers/RobloxAuthController.js');

// === Auth Routes ===
router.get('/auth/callback', AuthController.discordCallback);
router.get('/auth/me', AuthController.getMe);
router.post('/auth/logout', AuthController.logout);
router.post('/auth/activity', AuthController.updateActivity);
router.get('/auth/client-id', AuthController.getClientId);
router.get('/auth/roblox/start', RobloxAuthController.robloxStart);
router.get('/auth/roblox/callback', RobloxAuthController.robloxCallback);

// === Members Routes ===
router.get('/members', MembersController.getAll); // /api/members (legacy mapped)
router.get('/users', ensureAuth, MembersController.getUsers);
router.get('/usernames', MembersController.getUsernames);
router.get('/member/:id', MembersController.getOne);

// === Events Routes ===
router.get('/all-time', EventsController.getAllTime); // /api/all-time (legacy mapped)
router.patch('/all-time/:id', ensureAuth, EventsController.patchAllTime);
router.delete('/all-time/:id', ensureAuth, EventsController.deleteAllTime);

router.get('/weekly', ensureAuth, EventsController.getWeekly);
router.patch('/weekly/:id', ensureAuth, EventsController.patchWeekly);
router.delete('/weekly/:id', ensureAuth, EventsController.deleteWeekly);

router.get('/event-types', EventsController.getEventTypes);
router.post('/log-event-change', ensureAuth, EventsController.logEventChange);

// === Quotas Routes ===
router.get('/quotas', ensureAuth, QuotasController.getAll);
router.post('/quotas', ensureAuth, QuotasController.setQuota);
router.delete('/quotas/:roleId', ensureAuth, QuotasController.deleteQuota);
router.post('/quota/check', ensureAuth, QuotasController.checkQuotaBatch);

// === Discord Routes ===
router.get('/discord/role/:id', DiscordController.getRole);
router.get('/discord/roles', DiscordController.getRoles);

module.exports = router;
