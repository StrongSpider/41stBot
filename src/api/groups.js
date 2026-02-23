'use strict'

const noblox = require('noblox.js')
const database = require('./database.js')
const proxy = require('./proxy.js')

const LoggerClass = require('./logger.js')
const logger = new LoggerClass('Groups', 'API')

const GROUPS_BASE_URL = 'https://groups.roblox.com/v1'

/**
 * Get group information for a user, using cached roles if available.
 * @param {number|string} robloxId
 */
const getGroupInformation = async function (robloxId) {
    const groups = await noblox.getGroups(robloxId)

    const results = []
    const missingGroups = []
    const groupMap = new Map() // Map groupId -> group object from noblox

    // 1. Check cache
    for (const group of groups) {
        groupMap.set(group.Id, group)
        const cached = await database.getGroup(group.Id)

        // Check if cached and valid (not expired)
        if (cached && new Date(cached.expires) > new Date()) {
            const roles = cached.roles
            // Calculate IsBaseRank
            // roles is ordered array of {id, rank}
            const userRoleIndex = roles.findIndex((r) => r.rank == group.Rank)
            const IsBaseRank = userRoleIndex !== -1 && userRoleIndex < 2

            results.push({ ...group, IsBaseRank })
        } else {
            // Needs fetch (either missing or expired)
            missingGroups.push({ group, isUpdate: !!cached })
        }
    }

    // 2. Fetch missing
    if (missingGroups.length > 0) {
        const urls = missingGroups.map((item) => `${GROUPS_BASE_URL}/groups/${item.group.Id}/roles`)
        const proxyRes = await proxy.batchGet(urls)

        const twoMonthsFromNow = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60)

        for (const item of missingGroups) {
            const group = item.group
            const isUpdate = item.isUpdate

            // Find result in proxy response
            const groupData = proxyRes.find((g) => g.groupId == group.Id)
            if (!groupData) {
                logger.warn(`Could not find proxy result for group ${group.Id}`)
                continue
            }

            const roles = groupData.roles

            // Calculate IsBaseRank
            const userRoleIndex = roles.findIndex((r) => r.rank == group.Rank)
            const IsBaseRank = userRoleIndex !== -1 && userRoleIndex < 2

            results.push({ ...group, IsBaseRank })

            // Save to DB
            // We map roles to { id, rank } preserving order.
            const dbRoles = roles.map(r => ({ id: String(r.id), rank: r.rank }))

            try {
                if (isUpdate) {
                    await database.updateGroup(group.Id, { roles: dbRoles, expires: twoMonthsFromNow })
                } else {
                    await database.createGroup(group.Id, dbRoles, twoMonthsFromNow)
                }
            } catch (err) {
                logger.error(`Failed to save group ${group.Id} to database:`, err)
            }
        }
    }

    return results
}

module.exports = {
    getGroupInformation
}
