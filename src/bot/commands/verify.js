'use strict'

const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js')
const { StartAuthentication, ConfirmAuthentication } = require('../../api/authenticator.js')
const { getIdFromUsername, getPlayerInfo, getUsernameFromId } = require('noblox.js')
const { getRobloxIdByDiscord, getDiscordIdByRoblox } = require('../../api/database.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Links your Discord account to your Roblox account for 41st servers')
    .addStringOption(opt =>
      opt.setName('username')
        .setDescription('Your Roblox username')
        .setRequired(true)
    ),
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

      const username = interaction.options.getString('username')
      if (!username) {
        return interaction.reply({ content: '<:warning:1297618648810393630> `No username provided.`', flags: MessageFlags.Ephemeral })
      }

      // Resolve Roblox user id
      let userid = null
      try { userid = await getIdFromUsername(username) } catch { }
      if (userid == null) {
        return interaction.reply({ content: '<:warning:1297618648810393630> `User not found on Roblox.`', flags: MessageFlags.Ephemeral })
      }

      let existingDiscordForRoblox = null
      try { existingDiscordForRoblox = await getDiscordIdByRoblox(userid) } catch { }
      if (existingDiscordForRoblox && existingDiscordForRoblox !== interaction.user.id) {
        return interaction.reply({
          content: '<:warning:1297618648810393630> `That Roblox account is already linked to another Discord user.`',
          flags: MessageFlags.Ephemeral
        })
      }

      // Start auth flow. Returns a one-time string and an event emitter to signal completion.
      let AuthenticationString
      let AuthenticationEvent
      try {
        const resp = await StartAuthentication(interaction.user.id, userid)
        AuthenticationString = resp.AuthenticationString
        AuthenticationEvent = resp.AuthenticationEvent
      } catch (e) {
        return interaction.reply({ content: '<:warning:1297618648810393630> `Failed to start verification. Try again later.`', flags: MessageFlags.Ephemeral })
      }

      // Success handler: fires when ConfirmAuthentication validates the bio
      AuthenticationEvent.once(`UserAuthenticated-${userid}`, async () => {
        const confirmEmbed = new EmbedBuilder()
          .setFooter({ text: '41ST BOT AUTHENTICATION', iconURL: interaction.guild?.iconURL() ?? undefined })
          .setTitle('Account Verified')
          .setColor(EMBED_COLOR)
          .setTimestamp()
          .addFields(
            { name: 'Username', value: `[${username}](https://www.roblox.com/users/${userid}/profile)`, inline: true },
            { name: 'User ID', value: String(userid), inline: true }
          )

        // Clean up the original message
        try { await interaction.editReply({ content: 'Verification successful.', embeds: [], components: [] }) } catch { }

        // Best-effort DM
        try {
          const dm = await interaction.user.createDM()
          await dm.send({ embeds: [confirmEmbed] })
        } catch { }
      })

      // Timeout handler: auth window ended
      AuthenticationEvent.once(`EventEnded-${userid}`, async () => {
        try { await interaction.followUp({ content: '`Verify timeout. Please try again.`', flags: MessageFlags.Ephemeral }) } catch { }
      })

      // Build the interactive prompt
      const checkButton = new ButtonBuilder()
        .setCustomId(`verify_check_${userid}`)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success)

      const row = new ActionRowBuilder().addComponents(checkButton)

      const verifyEmbed = new EmbedBuilder()
        .setFooter({ text: '41ST BOT AUTHENTICATION', iconURL: interaction.guild?.iconURL() ?? undefined })
        .setTitle('Verify Account')
        .setColor(EMBED_COLOR)
        .setTimestamp()
        .addFields(
          { name: 'Username', value: `[${username}](https://www.roblox.com/users/${userid}/profile)`, inline: true },
          { name: 'User ID', value: String(userid), inline: true },
          {
            name: 'Verification String',
            value: '```' + AuthenticationString + '```\nEnter the above string into your Roblox bio, then press Confirm.'
          }
        )

      await interaction.reply({ embeds: [verifyEmbed], components: [row], flags: MessageFlags.Ephemeral })

      // Set up a component collector on the ephemeral reply
      const replyMsg = await interaction.fetchReply()
      const collector = replyMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 125000 })

      collector.on('collect', async btnInt => {
        if (btnInt.user.id !== interaction.user.id) {
          return btnInt.reply({ content: '`This button is not for you.`', flags: MessageFlags.Ephemeral })
        }

        await btnInt.update({ content: 'Checking your bio...', components: [], embeds: [] })

        // Pull current bio and attempt to confirm
        let profile
        try { profile = await getPlayerInfo(userid) } catch { }
        const bio = profile?.blurb || ''

        try {
          await ConfirmAuthentication(userid, bio)
          // No reply here. The success embed is sent by the event handler above.
        } catch (e) {
          const msg = e && e.message ? e.message : 'Verification failed.'
          await interaction.editReply({ content: `<:warning:1297618648810393630> \`${msg}\``, embeds: [] })
        }
      })

      collector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({ content: '<:warning:1297618648810393630> Time expired - please run `/verify` again.', embeds: [], components: [] })
        }
      })
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `<:warning:1297618648810393630> \`${msg}\``, embeds: [], components: [] }).catch(() => { })
      } else {
        await interaction.reply({ content: `<:warning:1297618648810393630> \`${msg}\``, flags: MessageFlags.Ephemeral }).catch(() => { })
      }
    }
  }
}
