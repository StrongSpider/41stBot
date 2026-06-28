'use strict';

const { prisma } = require('../connection');
const { normalizeEventCaps } = require('../utils');

function mapRoleQuota(row) {
    if (!row) return null;
    return {
        roleId: String(row.roleId),
        quotaEP: Number(row.quotaEP),
        eventCaps: normalizeEventCaps(row.eventCaps),
        overwrites: (row.overwrites && row.overwrites !== 'null') ? String(row.overwrites) : null,
        exclusive: (row.exclusive && row.exclusive !== 'null') ? String(row.exclusive) : null,
        purges: Boolean(row.purges)
    };
}

async function setRoleQuota(roleId, quotaEP, eventCaps, overwrites, exclusive, purges) {
    await prisma.roleQuota.upsert({
        where: { roleId },
        create: {
            roleId,
            quotaEP: Number(quotaEP),
            eventCaps: normalizeEventCaps(eventCaps),
            overwrites: overwrites ? String(overwrites) : null,
            exclusive: exclusive ? String(exclusive) : null,
            purges: Boolean(purges)
        },
        update: {
            quotaEP: Number(quotaEP),
            eventCaps: normalizeEventCaps(eventCaps),
            overwrites: overwrites ? String(overwrites) : null,
            exclusive: exclusive ? String(exclusive) : null,
            purges: Boolean(purges)
        }
    });
}

async function getRoleQuota(roleId) {
    const row = await prisma.roleQuota.findUnique({ where: { roleId } });
    return mapRoleQuota(row);
}

async function listRoleQuotas() {
    const rows = await prisma.roleQuota.findMany();
    return rows.map(mapRoleQuota);
}

async function deleteRoleQuota(roleId) {
    await prisma.roleQuota.deleteMany({ where: { roleId } });
}

module.exports = {
    setRoleQuota,
    getRoleQuota,
    listRoleQuotas,
    deleteRoleQuota
};
