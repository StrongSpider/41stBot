'use strict'

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js')
const { StartAuthentication, AUTH_WINDOW_MS } = require('../../api/authenticator.js')
const { getRobloxIdByDiscord } = require('../../api/database.js')
const { getUsernameFromId } = require('../../api/roblox.js')
const config = require('../../../config.json')

const { EMBED_COLOR } = config.GENERAL

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Discord account to your Roblox account'),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      let existing = null
      try { existing = await getRobloxIdByDiscord(interaction.user.id) } catch { }

      if (existing) {
        let linkedName = 'Unknown'
        try { linkedName = await getUsernameFromId(existing) } catch { }

        return interaction.reply({
          content: `<:warning:1297618648810393630> \`You are already verified as ${linkedName}. If this is wrong, contact an officer.\``,
          flags: MessageFlags.Ephemeral
        })
      }

      let auth
      try {
        auth = await StartAuthentication(interaction.user.id)
      } catch (err) {
        const msg = err instanceof Error && err.message ? err.message : 'Failed to start verification.'
        return interaction.reply({
          content: `<:warning:1297618648810393630> \`${msg}\``,
          flags: MessageFlags.Ephemeral
        })
      }

      const expiresAtUnix = Math.max(
        Math.floor(Date.now() / 1000),
        Math.floor(Number(auth.ExpiresAt || (Date.now() + AUTH_WINDOW_MS)) / 1000)
      )
      const verifyButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(auth.AuthenticationUrl)
        .setLabel('Verify with Roblox')

      const row = new ActionRowBuilder().addComponents(verifyButton)

      const verifyEmbed = new EmbedBuilder()
        .setFooter({ text: '41ST BOT AUTHENTICATION', iconURL: interaction.guild?.iconURL() ?? undefined })
        .setTitle('Verify Roblox Account')
        .setDescription('Click the button below, approve the app with Roblox, and your Discord account will be linked.')
        .setColor(EMBED_COLOR)
        .setTimestamp()
        .addFields(
          { name: 'Link Expires', value: `<t:${expiresAtUnix}:R>` }
        )

      await interaction.reply({
        embeds: [verifyEmbed],
        components: [row],
        flags: MessageFlags.Ephemeral
      })
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: `<:warning:1297618648810393630> \`${msg}\``,
          embeds: [],
          components: []
        }).catch(() => { })
      } else {
        await interaction.reply({
          content: `<:warning:1297618648810393630> \`${msg}\``,
          flags: MessageFlags.Ephemeral
        }).catch(() => { })
      }
    }
  }
}
