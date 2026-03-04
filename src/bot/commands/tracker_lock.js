'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')
const { formatEventEpLockMessage } = require('../utils/eventEpLock.js')

function formatStatus(lockState) {
    if (!lockState || !lockState.enabled) {
        return 'Event/EP update lock is currently `disabled`.'
    }
    const lines = ['Event/EP update lock is currently `enabled`.']
    if (lockState.reason) lines.push('Reason: ' + String(lockState.reason).replace(/`/g, '\''))
    if (lockState.changedBy && /^[0-9]{17,20}$/.test(lockState.changedBy)) lines.push('Set by: <@' + lockState.changedBy + '>')
    if (lockState.changedAt) lines.push('Changed at: ' + new Date(lockState.changedAt).toISOString())
    return lines.join('\n')
}

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder()
        .setName('tracker-lock')
        .setDescription('Set read-only mode for event and EP updates')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Choose whether to lock or unlock updates')
                .setRequired(true)
                .setChoices(
                    { name: 'status', value: 'status' },
                    { name: 'enable', value: 'enable' },
                    { name: 'disable', value: 'disable' }
                )
        )
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Enter a reason for this lock state')
                .setRequired(false)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const action = interaction.options.getString('action', true)
        const reason = interaction.options.getString('reason')
        const cleanReason = reason ? String(reason).trim().slice(0, 256) : null

        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        if (action === 'status') {
            const status = await database.getEventEpLock()
            await interaction.editReply({ content: formatStatus(status) })
            return
        }

        const enabled = action === 'enable'
        const next = await database.setEventEpLock(enabled, {
            reason: cleanReason || null,
            changedBy: interaction.user.id
        })

        if (next.enabled) {
            await interaction.editReply({ content: formatEventEpLockMessage(next) })
            return
        }

        await interaction.editReply({ content: formatStatus(next) })
    }
}
