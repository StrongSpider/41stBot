'use strict';

const config = require('../../../config.json');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

function encode(value) {
    return encodeURIComponent(String(value || ''));
}

function buildDatabaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

    const mysql = config.MYSQL || {};
    const user = encode(mysql.USER);
    const password = encode(mysql.PASSWORD);
    const host = mysql.HOST || 'localhost';
    const port = mysql.PORT || 3306;
    const database = encode(mysql.DATABASE);

    if (!user || !database) return undefined;
    const url = new URL(`mysql://${user}:${password}@${host}:${port}/${database}`);
    for (const [key, option] of Object.entries({
        ALLOW_PUBLIC_KEY_RETRIEVAL: 'allowPublicKeyRetrieval',
        SSL: 'ssl',
        CONNECT_TIMEOUT: 'connectTimeout',
        CACHING_RSA_PUBLIC_KEY: 'cachingRsaPublicKey',
        RSA_PUBLIC_KEY: 'rsaPublicKey'
    })) {
        if (mysql[key] !== undefined) url.searchParams.set(option, String(mysql[key]));
    }
    return url.toString();
}

const databaseUrl = buildDatabaseUrl();
if (databaseUrl && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = databaseUrl;
}

if (!databaseUrl) {
    throw new Error('DATABASE_URL or config.MYSQL must be configured before using the database API.');
}

const connectionUrl = new URL(databaseUrl);
if (connectionUrl.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL must use the mysql:// protocol.');
}
connectionUrl.searchParams.set('timezone', '+00:00');
const adapter = new PrismaMariaDb(connectionUrl.toString());
const prisma = new PrismaClient({
    adapter
});

async function disconnectDatabase() {
    await prisma.$disconnect();
}

module.exports = {
    prisma,
    disconnectDatabase
};
