const { PermissionsBitField } = require('discord.js')

const {
    isGuildAdministrator,
    hasDeveloperOrAdminOverride
} = require('../../bot/utils/interactionPermissions.js')

describe('interactionPermissions', () => {
    it('detects administrator from interaction memberPermissions', () => {
        const interaction = {
            memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator)
        }

        expect(isGuildAdministrator(interaction)).toBe(true)
    })

    it('detects administrator from member permissions', () => {
        const member = {
            permissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator)
        }

        expect(isGuildAdministrator(member)).toBe(true)
    })

    it('allows the configured developer to bypass command gates', () => {
        const interaction = {
            user: { id: 'developer' },
            memberPermissions: new PermissionsBitField()
        }

        expect(hasDeveloperOrAdminOverride(interaction, 'developer')).toBe(true)
    })

    it('does not grant override to regular members', () => {
        const interaction = {
            user: { id: 'member' },
            memberPermissions: new PermissionsBitField()
        }

        expect(hasDeveloperOrAdminOverride(interaction, 'developer')).toBe(false)
    })
})
