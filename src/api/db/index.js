'use strict';

const connection = require('./connection');
const utils = require('./utils');
const users = require('./modules/users');
const events = require('./modules/events');
const roles = require('./modules/roles');
const admin = require('./modules/admin');
const botState = require('./modules/botState');
const minorOfficerLogs = require('./modules/minorOfficerLogs');

module.exports = {
    ...connection,
    ...utils,
    ...users,
    ...events,
    ...roles,
    ...admin,
    ...botState,
    ...minorOfficerLogs,
    ...require('./modules/robloxUsers')
};
