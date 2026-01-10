const path = require('path');

const PagesController = {
    getPrivacy: (req, res) => {
        res.sendFile(path.join(__dirname, '../legal/privacy.html'));
    },

    getToS: (req, res) => {
        res.sendFile(path.join(__dirname, '../legal/tos.html'));
    }
};

module.exports = PagesController;
