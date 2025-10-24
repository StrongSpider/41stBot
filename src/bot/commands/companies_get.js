'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { EMBED_COLOR, ROBLOX_GROUP_ID } = require('../../../config.json')
const axios = require('axios')

/**
 * /companies-get command
 *
 * Fetch Roblox group roles and display member counts for specific 41st companies.
 * Excludes CE and CC by whitelisting defined company names.
 *
 * Network
 *  - Endpoint: https://groups.roblox.com/v1/groups/{groupId}/roles
 *  - Axios timeout to avoid hanging replies
 *
 * Config
 *  - ROBLOX_GROUP_ID from config.json
 *  - EMBED_COLOR from config.json
 *
 * Expected export shape
 *  - permission: permission tag used by the command loader
 *  - data: Slash command definition for registration
 *  - execute: handler for CommandInteraction
 *
 * @file companies_get.js
 */

const COMPANIES = Object.freeze([
  'Trooper',
  'Sarlacc Battalion',
  'Green Company',
  'Ranger Platoon',
  'Zeus Company',
  'Advanced Recon Commandos'
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

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('companies-get')
    .setDescription('Gets current companies user count excluding CE and CC'),
  /**
   * Get current member counts for key companies from the Roblox group and show them in an embed
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