'use strict';

const config = require('../../../config.json');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function encode(value) {
    return encodeURIComponent(String(value || ''));
}

function buildDatabaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

    const postgres = config.POSTGRES || {};
    const user = encode(postgres.USER);
    const password = encode(postgres.PASSWORD);
    const host = postgres.HOST || 'localhost';
    const port = postgres.PORT || 5432;
    const database = encode(postgres.DATABASE);

    if (!user || !database) return undefined;
    return `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
}

const databaseUrl = buildDatabaseUrl();
if (databaseUrl && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = databaseUrl;
}

if (!databaseUrl) {
    throw new Error('DATABASE_URL or config.POSTGRES must be configured before using the database API.');
}

const adapter = new PrismaPg(databaseUrl);
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
