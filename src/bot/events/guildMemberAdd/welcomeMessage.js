'use strict'

const { EmbedBuilder, TextChannel } = require('discord.js')
const config = require('../../../../config.json')
const { CHANNELS: DISCORD_CHANNEL_IDS } = config.DISCORD
const { EMBED_COLOR } = config.GENERAL
const database = require('../../../api/database.js')

const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('WelcomeMessage', 'BOT')

/**
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async function welcomeMessage(member) {
  try {
    if (!member || !member.user) return
    if (member.user.bot) return

    // Skip if already verified in our DB. If the lookup fails, do not block the welcome.
    try {
      const existing = await database.getRobloxIdByDiscord(member.user.id)
      if (existing) return
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      logger.error('db lookup failed:', msg)
    }

    const channelId = DISCORD_CHANNEL_IDS && DISCORD_CHANNEL_IDS.WELCOME
    if (!channelId) {
      logger.error('WELCOME_CHANNEL id is not configured')
      return
    }

    const chan = member.guild.channels.cache.get(channelId)
    if (!chan || !(chan instanceof TextChannel)) {
      logger.error('WELCOME_CHANNEL not found or not a text channel:', channelId)
      return
    }

    const embed = new EmbedBuilder()
      .setTitle('Welcome to 41st Elite Corps!')
      .setDescription('Follow instructions from your host.\nWhen you are ready, run the `/verify` command in this channel.')
      .setColor(EMBED_COLOR)
      .setFooter({ text: '41ST BOT', iconURL: chan.guild.iconURL() ?? undefined })
      .setTimestamp()

    await chan.send({ content: `<@${member.user.id}>`, embeds: [embed] })
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    logger.error('welcomeMessage error:', msg)
  }
}