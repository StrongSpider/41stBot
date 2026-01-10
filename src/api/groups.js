'use strict'

const noblox = require('noblox.js')
const database = require('./database.js')
const proxy = require('./proxy.js')
const Logger = require('./logger.js')

const GROUPS_BASE_URL = 'https://groups.roblox.com/v1'

/**
 * Get group information for a user, using cached roles if available.
 * @param {number|string} robloxId
 */
const getGroupInformation = async function (robloxId) {
    const logger = new Logger('Groups', 'API')
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
            // We need to find the index of the user's rank
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
            // proxy.batchGet returns array of objects, we assume order or some ID matching?
            // roblox.js used: const roles = res.find((g) => g.groupId == group.Id).roles
            // Let's assume proxy.batchGet returns objects with groupId if the URL structure allows it, 
            // or we need to match by something.
            // Looking at roblox.js: `const roles = res.find((g) => g.groupId == group.Id).roles`
            // It seems proxy.batchGet parses the response and maybe injects groupId? 
            // Or the response from Roblox contains groupId. 
            // Roblox endpoint /v1/groups/{groupId}/roles returns { groupId: ..., roles: [...] }

            const groupData = proxyRes.find((g) => g.groupId == group.Id)
            if (!groupData) {
                logger.warn(`Could not find proxy result for group ${group.Id}`)
                // Fallback: assume not base rank or handle error? 
                // For now, push without IsBaseRank or default false?
                // Original code would crash or fail if find returns undefined.
                continue
            }

            const roles = groupData.roles

            // Calculate IsBaseRank
            const userRoleIndex = roles.findIndex((r) => r.rank == group.Rank)
            const IsBaseRank = userRoleIndex !== -1 && userRoleIndex < 2

            results.push({ ...group, IsBaseRank })

            // Save to DB
            // "make sure to save the index of the role object in the array and only copy over the id and rank of the role"
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
