const { filterRowsByRole, formatRoleFilterLabel } = require('../../bot/utils/topRoleFilter')

function memberWithRoles(...roleIds) {
    return {
        roles: {
            cache: {
                has: roleId => roleIds.includes(roleId)
            }
        }
    }
}

describe('topRoleFilter', () => {
    it('returns all rows when no role filter is provided', async () => {
        const rows = [{ discordId: '1' }, { discordId: '2' }]

        await expect(filterRowsByRole({ guild: null }, rows, null, row => row.discordId)).resolves.toBe(rows)
    })

    it('filters rows to members with the selected role', async () => {
        const members = new Map([
            ['1', memberWithRoles('role-a')],
            ['2', memberWithRoles('role-b')],
            ['3', memberWithRoles('role-a', 'role-b')]
        ])

        const interaction = {
            guild: {
                members: {
                    cache: members,
                    fetch: jest.fn().mockResolvedValue(members)
                }
            }
        }

        const rows = [{ discordId: '1' }, { discordId: '2' }, { discordId: '3' }, { discordId: null }]
        const filtered = await filterRowsByRole(interaction, rows, { id: 'role-a' }, row => row.discordId)

        expect(filtered).toEqual([{ discordId: '1' }, { discordId: '3' }])
        expect(interaction.guild.members.fetch).toHaveBeenCalledTimes(1)
    })

    it('fetches a missing member before checking roles', async () => {
        const interaction = {
            guild: {
                members: {
                    cache: new Map(),
                    fetch: jest.fn()
                        .mockRejectedValueOnce(new Error('bulk fetch unavailable'))
                        .mockResolvedValueOnce(memberWithRoles('role-a'))
                }
            }
        }

        const filtered = await filterRowsByRole(interaction, [{ discordId: '1' }], { id: 'role-a' }, row => row.discordId)

        expect(filtered).toEqual([{ discordId: '1' }])
        expect(interaction.guild.members.fetch).toHaveBeenCalledTimes(2)
        expect(interaction.guild.members.fetch).toHaveBeenLastCalledWith('1')
    })

    it('formats the role label for embed titles', () => {
        expect(formatRoleFilterLabel({ name: 'Officers' })).toBe(' - Officers')
        expect(formatRoleFilterLabel(null)).toBe('')
    })
})
