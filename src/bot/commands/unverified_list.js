'use strict'

const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js')
const database = require('../../api/database')

/**
 * Split a long message into Discord safe chunks
 * @param {string} text
 * @param {number} maxLen
 */
function splitMessage(text, maxLen = 1900) {
  const out = []
  let current = ''
  for (const line of text.split('\n')) {
    const add = current.length ? '\n' + line : line
    if ((current + add).length > maxLen) {
      if (current) out.push(current)
      current = line
    } else current += add
  }
  if (current) out.push(current)
  return out
}

module.exports = {
  permission: 'HICOM',
  data: new SlashCommandBuilder()
    .setName('unverified-list')
    .setDescription('List unverified users'),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const guild = interaction.guild
    if (!guild) return interaction.editReply('This command can only be used in a server.')

    // Warm the member cache so we do not miss users
    await guild.members.fetch().catch(() => { })

    // Filter to human, non admin members
    const members = guild.members.cache.filter(m => !m.user.bot && !m.permissions.has(PermissionsBitField.Flags.Administrator))

    const unverifiedIds = []
    for (const member of members.values()) {
      try {
        const robloxId = await database.getRobloxIdByDiscord(member.id)
        if (!robloxId) unverifiedIds.push(member.id)
      } catch { }
    }

    if (unverifiedIds.length === 0) {
      return interaction.editReply('All members in the server are verified with the bot.')
    }

    // Build header and chunk output safely
    let header = '### Users who do not have a verified Roblox Account with the bot\n'

    const lines = unverifiedIds.map(id => `<@${id}>`).join('\n')
    const chunks = splitMessage(header + lines)

    await interaction.editReply(chunks[0])
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral })
    }
  }
}
