'use strict';

const { prisma } = require('../connection');
const { assertEventEpWriteUnlocked } = require('./botState');

async function clearAllWeeklyEvents() {
    await assertEventEpWriteUnlocked();
    await prisma.$transaction([
        prisma.weeklyEvent.deleteMany(),
        prisma.weeklyEventIndex.deleteMany()
    ]);
}

module.exports = {
    clearAllWeeklyEvents
};
