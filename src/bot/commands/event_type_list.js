const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js')
const database = require('../../api/database.js')

module.exports = {
    permission: 'HICOM',
    data: new SlashCommandBuilder()
        .setName('event-type-list')
        .setDescription('List available event types'),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const types = await database.getEventTypes()
            if (!types || types.length === 0) {
                return interaction.reply({ content: 'No event types found.' })
            }

            const content = types.join('\n')
            const buffer = Buffer.from(content, 'utf-8')
            const attachment = new AttachmentBuilder(buffer, { name: 'event-types.txt' })

            return interaction.reply({
                content: `**Event Types** (${types.length} total):`,
                files: [attachment]
            })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            return interaction.reply({ content: `Failed to list event types: ${msg}`, ephemeral: true })
        }
    }
}
