'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const { GROUP_ID: ROBLOX_GROUP_ID } = config.ROBLOX
const {
  COMPANY: DISCORD_COMPANY_ROLES = {},
  RANK: DISCORD_RANK_ROLES = {}
} = config.DISCORD.ROLES
const axios = require('axios')

// Hardcoded company role names to check for
const COMPANIES = Object.freeze([
  'Trooper',
  'Sarlacc Battalion',
  'Green Company',
  'Ranger Platoon',
  'Zeus Company',
  'Advanced Recon Commandos'
])

// Hardcoded rank role names to check for
const RANKS = Object.freeze([
  'Company Officer',
  'Company Commander',
  'Captain Draa',
  'Commander Buzz',
  'Commander Gree'
])


/**
 * Fetch roles for a Roblox group
 * @param {string|number} groupId
 * @returns {Promise<Array<{name:string, rank:number, memberCount:number}>>}
 */
async function fetchGroupRoles(groupId) {
  const url = `https://groups.roblox.com/v1/groups/${groupId}/roles`
  const res = await axios.get(url, { timeout: 7000 })
  return res.data && Array.isArray(res.data.roles) ? res.data.roles : []
}

/**
 * Build the Companies Member Count field body
 * Keeps display order based on COMPANIES array
 * @param {Array<{name:string, rank:number, memberCount:number}>} roles
 * @returns {string|null}
 */
function formatCompaniesField(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return null
  const byName = new Map(roles.map(r => [r.name, r]))
  const lines = []
  for (const name of COMPANIES) {
    const role = byName.get(name)
    if (!role || role.rank === 0) continue
    lines.push(`**${name}:** \`${role.memberCount}\``)
  }
  return lines.length ? lines.join('\n\n') : null
}

/**
 * Count unique guild members that hold any configured 41st company or rank role
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<number|null>}
 */
async function count41stMembers(guild) {
  if (!guild) return null

  const roleIds = new Set([
    ...Object.keys(DISCORD_COMPANY_ROLES),
    ...Object.keys(DISCORD_RANK_ROLES)
  ])

  if (!roleIds.size) return 0

  await guild.members.fetch()

  let total = 0
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue
    if (member.roles.cache.some(role => roleIds.has(role.id))) {
      total += 1
    }
  }

  return total
}

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('companies-get')
    .setDescription('Show current company counts, excluding CE and CC'),
  /**
   * @param {import('discord.js').CommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      await interaction.deferReply()

      if (!ROBLOX_GROUP_ID) {
        await interaction.editReply('ROBLOX_GROUP_ID is not set in config.json')
        return
      }

      const roles = await fetchGroupRoles(ROBLOX_GROUP_ID)
      const value = formatCompaniesField(roles)
      const total41stMembers = await count41stMembers(interaction.guild)

      if (!value) {
        await interaction.editReply('No matching company roles found for this group')
        return
      }

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('41st Elite Corps')
        .addFields({ name: 'Companies Member Count', value })
        .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
        .setTimestamp()

      if (total41stMembers != null) {
        embed.setDescription(`Total 41st Members: \`${total41stMembers}\``)
      }

      await interaction.editReply({ embeds: [embed] })
    } catch (err) {
      const msg = err && err.message ? err.message : 'Unknown error'
      const safe = 'Unable to fetch companies right now. ' + msg
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: safe }).catch(() => { })
      } else {
        await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
      }
    }
  }
}
