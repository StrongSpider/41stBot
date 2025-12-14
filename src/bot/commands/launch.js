const { MessageFlags } = require('discord.js');

module.exports = {
    // This command is required for the Discord Activity "Launch" button to work.
    // It is a Type 4 (Primary Entry Point) command.
    permission: 'ALL', // Or whatever your permission system uses, usually ignored for entry point logic itself
    data: {
        name: 'Launch',
        type: 4, // ApplicationCommandType.PrimaryEntryPoint
        handler: 2, // Discord Launch (Client handles opening the iframe)
        toJSON: function () {
            return {
                name: this.name,
                type: this.type,
                handler: this.handler
            };
        }
    },
    async execute(interaction) {
        // Acknowledge the interaction. 
        // In many cases, the client handles the launch immediately, but we should reply to be safe.
        try {
            await interaction.reply({ content: 'Launching 41st Portal...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to reply to launch interaction', e);
        }
    }
};
