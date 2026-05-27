'use strict'

const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js')
const database = require('../../api/database')

module.exports = {
  permission: 'ALL',
  data: new ContextMenuCommandBuilder()
    .setName('Get Event')
    .setType(ApplicationCommandType.Message),
  /**
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
        content: `Event found! Event ID: \`${event.eventId}\``
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