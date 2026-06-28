'use strict';

const { prisma } = require('../connection');
const { toId } = require('../utils');
const { assertEventEpWriteUnlocked } = require('./botState');

async function ensureMinorOfficerReviewTables() {
    return true;
}

async function incrementMinorOfficerReviewerCount(reviewerDiscordId) {
    await assertEventEpWriteUnlocked();

    const did = toId(reviewerDiscordId);
    await prisma.$transaction([
        prisma.minorOfficerLogsWeekly.upsert({
            where: { discordId: did },
            create: { discordId: did, reviewCount: 1 },
            update: { reviewCount: { increment: 1 } }
        }),
        prisma.minorOfficerLogsAllTime.upsert({
            where: { discordId: did },
            create: { discordId: did, reviewCount: 1 },
            update: { reviewCount: { increment: 1 } }
        })
    ]);
}

function mapReviewCount(row) {
    return {
        discordId: String(row.discordId),
        count: Number(row.reviewCount) || 0
    };
}

async function getWeeklyMinorOfficerReviewCounts() {
    const rows = await prisma.minorOfficerLogsWeekly.findMany();
    return rows.map(mapReviewCount);
}

async function getAllTimeMinorOfficerReviewCounts() {
    const rows = await prisma.minorOfficerLogsAllTime.findMany();
    return rows.map(mapReviewCount);
}

async function resetWeeklyMinorOfficerReviewCounts() {
    await assertEventEpWriteUnlocked();
    await prisma.minorOfficerLogsWeekly.deleteMany();
}

module.exports = {
    ensureMinorOfficerReviewTables,
    incrementMinorOfficerReviewerCount,
    getWeeklyMinorOfficerReviewCounts,
    getAllTimeMinorOfficerReviewCounts,
    resetWeeklyMinorOfficerReviewCounts
};
