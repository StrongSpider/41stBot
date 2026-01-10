'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../../api/database.js');

module.exports = {
    permission: "FFCNC",
    data: new SlashCommandBuilder()
        .setName("add-suspicious-place")
        .setDescription("Add a Roblox place to the suspicious places database")
        .addIntegerOption(option =>
            option.setName("place_id")
                .setDescription("The ID of the Roblox place to flag")
                .setRequired(true)
                .setMinValue(1))
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("The reason why this place is considered suspicious")
                .setRequired(true)),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const placeId = interaction.options.getInteger("place_id");
        const reason = interaction.options.getString("reason");

        try {
            await database.addSuspiciousPlace(placeId, reason, interaction.user.id);

            return await interaction.reply({
                content: `✅ Successfully added place **${placeId}** to the suspicious places list.\n**Reason:** ${reason}`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            const Logger = require('../../api/logger');
            Logger.error('[ERROR] add-suspicious-place execute:', error);

            const msg = error && error.message ? error.message : "Unknown error";
            return await interaction.reply({
                content: `❌ Failed to add suspicious place: ${msg}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
