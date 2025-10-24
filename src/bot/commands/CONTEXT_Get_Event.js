'use strict'

const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')

/**
 * Context menu: Get Event
 *
 * From a target message, read its jump URL and look up a matching event record
 * in the bot database. Replies ephemerally with the found event id or a clear
 * warning if none is found.
 *
 * Behavior
 *  - Uses MessageFlags.Ephemeral for privacy
 *  - Guards for missing or malformed target message
 *  - Catches DB errors and returns a safe message
 *
 * Exports
 *  - permission: consumed by the command loader
 *  - data: Context menu command definition
 *  - execute: handler for MessageContextMenuCommandInteraction
 *
 * @file CONTEXT_Get_Event.js
 */

module.exports = {
  permission: 'ALL',
  data: new ContextMenuCommandBuilder()
    .setName('Get Event')
    .setType(ApplicationCommandType.Message),
  /**
   * Handle the context menu interaction
   * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })

      const messageUrl = interaction.targetMessage?.url
      if (!messageUrl) {
        await interaction.editReply({
          content: '<:warning:1297618648810393630> `No message URL found for lookup`'
        })
        return
      }

      const event = await database.findEventByMessage(messageUrl)
      if (!event) {
        await interaction.editReply({
          content: '<:warning:1297618648810393630> `Could not find an event for this message`'
        })
        return
      }

      await interaction.editReply({
        content: `Event found! Event ID: \`${event.eventid}\``
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      const safe = 'Failed to fetch event. ' + msg
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: safe }).catch(() => { })
      } else {
        await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
      }
    }
  }
}