const fileRouter = require('express').Router();
const path = require('path');

fileRouter.get('/privacy', function (req, res) {
    res.sendFile(path.join(__dirname, "../../legal/privacy.html"));
});

module.exports = fileRouter;