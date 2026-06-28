'use strict';

const { Prisma } = require('@prisma/client');
const { prisma } = require('../connection');
const { toId, toBigInt, normalizeBadges, normalizeAssets } = require('../utils');

const UNLINKED_DISCORD_ID_PREFIX = '__unlinked__:';

function isUnlinkedDiscordId(discordId) {
    return String(discordId || '').startsWith(UNLINKED_DISCORD_ID_PREFIX);
}

function unlinkedDiscordId(discordId, robloxId) {
    return `${UNLINKED_DISCORD_ID_PREFIX}${toId(robloxId)}:${toId(discordId)}`;
}

function normalizePrismaConflict(error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const conflict = new Error('That Roblox account is already linked to another Discord user.');
        conflict.cause = error;
        return conflict;
    }
    return error;
}

async function getRobloxIdByDiscord(discordId) {
    const row = await prisma.robloxLink.findUnique({
        where: { discordId: toId(discordId) },
        select: { robloxId: true }
    });
    return row ? Number(row.robloxId) : null;
}

async function getDiscordIdByRoblox(robloxId) {
    const row = await prisma.robloxLink.findUnique({
        where: { robloxId: toBigInt(robloxId) },
        select: { discordId: true }
    });
    if (!row || isUnlinkedDiscordId(row.discordId)) return null;
    return String(row.discordId);
}

async function upsertRobloxId(discordId, robloxId) {
    const did = toId(discordId);
    const rid = toBigInt(robloxId);

    try {
        await prisma.$transaction(async (tx) => {
            const rows = await tx.robloxLink.findMany({
                where: {
                    OR: [
                        { discordId: did },
                        { robloxId: rid }
                    ]
                }
            });

            const discordRow = rows.find((row) => String(row.discordId) === did);
            const targetRow = rows.find((row) => row.robloxId === rid);

            if (targetRow && !isUnlinkedDiscordId(targetRow.discordId) && String(targetRow.discordId) !== did) {
                throw new Error('That Roblox account is already linked to another Discord user.');
            }

            if (discordRow && discordRow.robloxId !== rid) {
                await tx.robloxLink.update({
                    where: { discordId: did },
                    data: { discordId: unlinkedDiscordId(did, discordRow.robloxId) }
                });
            }

            if (targetRow) {
                if (String(targetRow.discordId) !== did) {
                    await tx.robloxLink.update({
                        where: { robloxId: rid },
                        data: { discordId: did }
                    });
                }
            } else if (!discordRow || discordRow.robloxId !== rid) {
                await tx.robloxLink.create({
                    data: { discordId: did, robloxId: rid }
                });
            }
        });
    } catch (error) {
        throw normalizePrismaConflict(error);
    }
}

async function deleteDiscordId(discordId) {
    const did = toId(discordId);
    await prisma.$transaction(async (tx) => {
        const existing = await tx.robloxLink.findUnique({
            where: { discordId: did },
            select: { robloxId: true }
        });

        if (!existing) return;

        await tx.robloxLink.update({
            where: { discordId: did },
            data: { discordId: unlinkedDiscordId(did, existing.robloxId) }
        });
    });
}

async function getAllUsers() {
    const rows = await prisma.robloxLink.findMany({
        where: { NOT: { discordId: { startsWith: UNLINKED_DISCORD_ID_PREFIX } } },
        select: { robloxId: true, discordId: true }
    });

    return rows.map((row) => ({
        robloxId: row.robloxId ? String(row.robloxId) : null,
        discordId: row.discordId ? String(row.discordId) : null
    }));
}

async function getDiscordIdsBatch(robloxIds) {
    if (!robloxIds.length) return [];

    const rows = await prisma.robloxLink.findMany({
        where: {
            robloxId: { in: robloxIds.map(toBigInt) },
            NOT: { discordId: { startsWith: UNLINKED_DISCORD_ID_PREFIX } }
        },
        select: { robloxId: true, discordId: true }
    });

    const map = new Map(rows.map((row) => [String(row.robloxId), String(row.discordId)]));
    return robloxIds.map((rid) => ({
        robloxId: rid,
        discordId: map.get(String(rid)) || null
    }));
}

async function getRandomUser(officerDiscordId) {
    const rows = officerDiscordId
        ? await prisma.$queryRaw`
            SELECT robloxid FROM user_assets
            WHERE robloxid NOT IN (
                SELECT target_roblox_id FROM officer_labels WHERE officer_discord_id = ${String(officerDiscordId)}
            )
            ORDER BY RANDOM()
            LIMIT 1
        `
        : await prisma.$queryRaw`
            SELECT robloxid FROM user_assets
            ORDER BY RANDOM()
            LIMIT 1
        `;

    return rows[0] ? Number(rows[0].robloxid) : null;
}

async function getInactivity(discordId) {
    const row = await prisma.inactivity.findUnique({
        where: { discordId: toId(discordId) }
    });
    if (!row) return null;
    return {
        discordId: toId(discordId),
        date: row.date ? Number(row.date) : 0,
        reason: row.reason || 'NO REASON PROVIDED'
    };
}

async function getAllInactivities() {
    const rows = await prisma.inactivity.findMany();
    if (!rows.length) return null;
    return rows.map((row) => ({
        discordId: String(row.discordId),
        date: row.date ? Number(row.date) : 0,
        reason: row.reason || 'NO REASON PROVIDED'
    }));
}

async function setInactivity(discordId, date, reason) {
    await prisma.inactivity.upsert({
        where: { discordId: toId(discordId) },
        create: {
            discordId: toId(discordId),
            date: toBigInt(date),
            reason
        },
        update: {
            date: toBigInt(date),
            reason
        }
    });
}

async function deleteInactivity(discordId) {
    await prisma.inactivity.deleteMany({
        where: { discordId: toId(discordId) }
    });
}

async function getUserBadges(robloxId) {
    const row = await prisma.userBadgeCache.findUnique({
        where: { robloxId: toBigInt(robloxId) }
    });
    return normalizeBadges(row && row.data);
}

async function setUserBadges(robloxId, badges) {
    const cleaned = normalizeBadges(badges);
    await prisma.userBadgeCache.upsert({
        where: { robloxId: toBigInt(robloxId) },
        create: { robloxId: toBigInt(robloxId), data: cleaned },
        update: { data: cleaned }
    });
}

async function appendUserBadges(robloxId, badges) {
    const cleaned = normalizeBadges(badges);
    if (!cleaned.length) return;

    await prisma.$transaction(async (tx) => {
        const rid = toBigInt(robloxId);
        const existing = await tx.userBadgeCache.findUnique({ where: { robloxId: rid } });
        const nextData = normalizeBadges(existing && existing.data).concat(cleaned);
        await tx.userBadgeCache.upsert({
            where: { robloxId: rid },
            create: { robloxId: rid, data: nextData },
            update: { data: nextData }
        });
    });
}

async function getAllUserBadgesData() {
    const rows = await prisma.userBadgeCache.findMany();
    return rows.map((row) => ({
        robloxId: Number(row.robloxId),
        badges: normalizeBadges(row.data)
    }));
}

async function getUserAssets(robloxId) {
    const row = await prisma.userAssetCache.findUnique({
        where: { robloxId: toBigInt(robloxId) }
    });
    return normalizeAssets(row && row.data);
}

async function setUserAssets(robloxId, assets) {
    const cleaned = normalizeAssets(assets);
    await prisma.userAssetCache.upsert({
        where: { robloxId: toBigInt(robloxId) },
        create: { robloxId: toBigInt(robloxId), data: cleaned },
        update: { data: cleaned }
    });
}

async function appendUserAssets(robloxId, assets) {
    const cleaned = normalizeAssets(assets);
    if (!cleaned.length) return;

    await prisma.$transaction(async (tx) => {
        const rid = toBigInt(robloxId);
        const existing = await tx.userAssetCache.findUnique({ where: { robloxId: rid } });
        const nextData = normalizeAssets(existing && existing.data).concat(cleaned);
        await tx.userAssetCache.upsert({
            where: { robloxId: rid },
            create: { robloxId: rid, data: nextData },
            update: { data: nextData }
        });
    });
}

module.exports = {
    getRobloxIdByDiscord,
    getDiscordIdByRoblox,
    upsertRobloxId,
    deleteDiscordId,
    getAllUsers,
    getDiscordIdsBatch,
    getRandomUser,
    getInactivity,
    getAllInactivities,
    setInactivity,
    deleteInactivity,
    getUserBadges,
    setUserBadges,
    appendUserBadges,
    getAllUserBadgesData,
    getUserAssets,
    setUserAssets,
    appendUserAssets
};
