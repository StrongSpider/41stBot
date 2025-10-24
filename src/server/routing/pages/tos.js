const fileRouter = require('express').Router();
const path = require('path');

fileRouter.get('/tos', function (req, res) {
    res.sendFile(path.join(__dirname, "../../legal/tos.html"));
});

module.exports = fileRouter;