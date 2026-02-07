'use strict';

const { Pool } = require('pg');
const config = require('../../../config.json');
const { DATABASE: POSTGRES_DATABASE, HOST: POSTGRES_HOST, PASSWORD: POSTGRES_PASSWORD, PORT: POSTGRES_PORT, USER: POSTGRES_USER } = config.POSTGRES;

/** @type {Pool} */
const pool = new Pool({
    user: POSTGRES_USER,
    host: POSTGRES_HOST,
    database: POSTGRES_DATABASE,
    password: POSTGRES_PASSWORD,
    port: POSTGRES_PORT
});

module.exports = {
    pool
};
