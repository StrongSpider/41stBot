'use strict';

const { prisma } = require('../connection');
const { toBigInt } = require('../utils');

function mapCachedUser(row) {
    if (!row) return null;
    return {
        robloxId: Number(row.robloxId),
        username: row.username,
        updatedAt: row.updatedAt
    };
}

async function getUserById(robloxId) {
    const row = await prisma.robloxUserCache.findUnique({
        where: { robloxId: toBigInt(robloxId) }
    });
    return mapCachedUser(row);
}

async function getUserByUsername(username) {
    const row = await prisma.robloxUserCache.findFirst({
        where: {
            username: {
                equals: String(username),
                mode: 'insensitive'
            }
        }
    });
    return mapCachedUser(row);
}

async function upsertUser(robloxId, username) {
    await prisma.robloxUserCache.upsert({
        where: { robloxId: toBigInt(robloxId) },
        create: {
            robloxId: toBigInt(robloxId),
            username: String(username)
        },
        update: {
            username: String(username)
        }
    });
}

module.exports = {
    getUserById,
    getUserByUsername,
    upsertUser
};
