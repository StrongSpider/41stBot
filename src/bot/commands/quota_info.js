'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database.js')

const WARNING = '<:warning:1297618648810393630>'

/**
 * Append event cap fields to the embed while respecting Discord field limits.
 * @param {EmbedBuilder} embed
 * @param {Array} caps
 */
function appendEventCapFields(embed, caps) {
    if (!Array.isArray(caps) || caps.length === 0) {
        embed.addFields({ name: 'Event Requirements', value: '`None`', inline: true })
        return
    }

    let current = ''
    let fieldCount = 0

    for (let i = 0; i < caps.length; i++) {
        const cap = caps[i]
        const alias = String(cap?.alias || `Event Cap ${i + 1}`)
        const block = `${alias}: \`${cap?.count ?? 0}\``

        if (current && current.length + 2 + block.length > 1024) {
            embed.addFields({
                name: fieldCount === 0 ? 'Event Requirements' : 'More Event Requirements',
                value: current,
                inline: false
            })
            current = block
            fieldCount += 1
            continue
        }

        current = current ? `${current}\n\n${block}` : block
    }

    if (current) {
        embed.addFields({
            name: fieldCount === 0 ? 'Event Requirements' : 'More Event Requirements',
            value: current,
            inline: false
        })
    }
}

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('quota-info')
        .setDescription('Show the configured quota for a role')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Select the role to inspect')
                .setRequired(true)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const role = interaction.options.getRole('role')
            if (!role) {
                await interaction.editReply({ content: `${WARNING} \`No role was provided.\`` })
                return
            }

            const quotaConfig = await database.getRoleQuota(role.id)
            if (!quotaConfig) {
                await interaction.editReply({ content: `${WARNING} \`${role.name} does not have a configured quota.\`` })
                return
            }

            const isExemptionQuota = quotaConfig.quotaEP === 0 && quotaConfig.overwrites === 'all'

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle(`${role.name} Quota`)
                .setDescription(`Role: <@&${role.id}>${isExemptionQuota ? '\nType: `Exemption quota`' : ''}`)
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields(
                    { name: 'EP Requirements', value: `\`${quotaConfig.quotaEP ?? 0}\``, inline: true },
                )

            appendEventCapFields(embed, quotaConfig.eventCaps)

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get quota info. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
