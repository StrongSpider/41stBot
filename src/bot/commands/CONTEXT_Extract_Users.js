'use strict'

const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js')
const database = require('../../api/database')
const roblox = require('../../api/roblox.js')

/**
 * Resolve Roblox usernames from a message's user mentions
 * @param {import('discord.js').Collection<string, import('discord.js').User>} mentions
 * @returns {Promise<string[]>}
 */
async function resolveUsernamesFromMentions(mentions) {
  const ids = Array.from(mentions?.values?.() ?? []).map(u => u.id)
  if (ids.length === 0) return []

  const lookups = ids.map(async id => {
    try {
      const robloxId = await database.getRobloxIdByDiscord(id)
      if (!robloxId) return null
      const name = await roblox.getUsernameFromId(robloxId)
      return name || null
    } catch {
      return null
    }
  })

  const results = await Promise.all(lookups)
  const names = results.filter(Boolean)

  // De-duplicate while preserving order
  const seen = new Set()
  const unique = []
  for (const n of names) {
    if (seen.has(n)) continue
    seen.add(n)
    unique.push(n)
  }
  return unique
}

module.exports = {
  permission: 'ALL',
  data: new ContextMenuCommandBuilder()
    .setName('Extract Users')
    .setType(ApplicationCommandType.Message),
  /**
   * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })

      const mentions = interaction.targetMessage?.mentions?.users
      if (!mentions || mentions.size === 0) {
        await interaction.editReply({
          content: '<:warning:1297618648810393630> `No users mentioned in this message`'
        })
        return
      }

      const usernames = await resolveUsernamesFromMentions(mentions)
      if (usernames.length === 0) {
        await interaction.editReply({
          content: '<:warning:1297618648810393630> `No verified users mentioned in this message`'
        })
        return
      }

      await interaction.editReply({ content: '```' + usernames.join(' ') + '```' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      const safe = 'Failed to extract users. ' + msg
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: safe }).catch(() => { })
      } else {
        await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
      }
    }
  }
}
