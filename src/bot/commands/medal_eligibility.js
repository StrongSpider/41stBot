'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const { DISCORD_MEDAL_ROLES } = require('../../../config.json');
const database = require('../../api/database.js')
/**
 * /medal-eligibility command
 *
 * Lists users eligible for medal upgrades based on current weekly EP.
 *
 * Policy
 *  - 25+ EP: eligible for at least Bronze (and upgrades if they already hold a medal)
 *  - 60+ EP: additionally called out in a separate list
 *
 * Role logic
 *  - If a user already has Platinum, they go to "No Medal" (no further upgrade)
 *  - If a user has Gold, they are eligible for Platinum
 *  - If a user has Silver, they are eligible for Gold
 *  - If a user has Bronze, they are eligible for Silver
 *  - If a user has no medal, they are eligible for Bronze
 *
 * Notes
 *  - Mentions are chunked to stay under Discord limits
 *  - Public reply by default. Errors fall back to a private message using MessageFlags.Ephemeral
 *
 * @file medal_eligibility.js
 */


/**
 * Split long text into Discord-safe chunks
 * @param {string} text
 * @param {number} max
 */
function splitMessage(text, max = 2000) {
  const out = []
  let chunk = ''
  for (const part of text.split('\n')) {
    const add = chunk.length ? '\n' + part : part
    if ((chunk + add).length > max) {
      if (chunk) out.push(chunk)
      chunk = part
    } else {
      chunk += add
    }
  }
  if (chunk) out.push(chunk)
  return out
}

/**
 * Send a list of mentions under a bold title, chunked safely
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} title
 * @param {string[]} ids Discord user ids to mention
 */
async function sendMentionList(interaction, title, ids) {
  if (!ids.length) return
  let content = `**${title}:**\n` + ids.map(id => `<@${id}>`).join(' ')
  for (const chunk of splitMessage(content)) {
    await interaction.followUp({ content: chunk })
  }
}

module.exports = {
  permission: 'FFCNC',
  data: new SlashCommandBuilder()
    .setName('medal-eligibility')
    .setDescription('List users at 25+ EP and 60+ EP'),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      await interaction.deferReply()

      // Load users with any weekly events and their current EP
      const users = await database.getUsersWithWeeklyEvents()
      const usersEP = await database.getCurrentEventPointsBatch(users)

      const twentyFivePlus = usersEP.filter(u => u.eventPoints >= 25)
      const sixtyPlus = usersEP.filter(u => u.eventPoints >= 60)

      // Prepare result buckets (ids are Discord ids)
      const noMedalUsers = [] // already platinum
      const platMedalUsers = [] // should receive Platinum
      const goldMedalUsers = [] // should receive Gold
      const silverMedalUsers = [] // should receive Silver
      const bronzeMedalUsers = [] // should receive Bronze

      // Resolve Discord ids in batch when possible
      const rids = twentyFivePlus.map(u => u.robloxId)
      let idMap = new Map()
      try {
        const pairs = await database.getDiscordIdsBatch(rids)
        idMap = new Map(pairs.map(p => [p.robloxId, p.discordId]))
      } catch {
        // fall back to per-user lookup below
      }

      for (const user of twentyFivePlus) {
        const rid = user.robloxId
        let discordId = idMap.get(rid)
        if (!discordId) {
          try {
            discordId = await database.getDiscordIdByRoblox(rid)
          } catch { }
        }
        if (!discordId) continue

        // Try to read roles. Prefer cache and fall back to fetch.
        let member = interaction.guild.members.cache.get(discordId)
        if (!member) {
          try {
            member = await interaction.guild.members.fetch(discordId)
          } catch { }
        }
        if (!member) continue

        // Classify based on current medal role
        const roles = member.roles.cache
        if (roles.has(DISCORD_MEDAL_ROLES.PLATINUM_ROLE)) noMedalUsers.push(discordId)
        else if (roles.has(DISCORD_MEDAL_ROLES.GOLD_ROLE)) platMedalUsers.push(discordId)
        else if (roles.has(DISCORD_MEDAL_ROLES.SILVER_ROLE)) goldMedalUsers.push(discordId)
        else if (roles.has(DISCORD_MEDAL_ROLES.BRONZE_ROLE)) silverMedalUsers.push(discordId)
        else bronzeMedalUsers.push(discordId)
      }

      await interaction.editReply({ content: '**Here is a list of medal users for this weeks purge!**' })

      await sendMentionList(interaction, 'Bronze Medal Users', bronzeMedalUsers)
      await sendMentionList(interaction, 'Silver Medal Users', silverMedalUsers)
      await sendMentionList(interaction, 'Gold Medal Users', goldMedalUsers)
      await sendMentionList(interaction, 'Platinum Medal Users', platMedalUsers)
      await sendMentionList(interaction, 'No Medal Users', noMedalUsers)

      // Call out users with 60+ EP
      if (sixtyPlus.length > 0) {
        const ids60 = []
        for (const u of sixtyPlus) {
          try {
            const did = idMap.get(u.robloxId) || await database.getDiscordIdByRoblox(u.robloxId)
            if (did) ids60.push(did)
          } catch { }
        }
        await sendMentionList(interaction, 'Users with 60+ EP', ids60)
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
      const safe = 'Failed to list medal eligibility. ' + msg
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: safe }).catch(() => { })
      } else {
        await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
      }
    }
  }
}