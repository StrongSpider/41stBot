'use strict';

const connection = require('./connection');
const utils = require('./utils');
const users = require('./modules/users');
const events = require('./modules/events');
const groups = require('./modules/groups');
const officer = require('./modules/officer');
const roles = require('./modules/roles');
const admin = require('./modules/admin');

module.exports = {
    ...connection,
    ...utils,
    ...users,
    ...events,
    ...groups,
    ...officer,
    ...roles,
    ...admin
};
