"use strict";

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getIdFromUsername } = require("../../api/roblox.js");
const badge = require("../../api/badge.js");
const database = require("../../api/database.js");
const { generateBadgeGraph } = require("../../api/backgroundCheck.js");

module.exports = {
    // adjust permission if you want
    permission: "OFFICER",
    data: new SlashCommandBuilder()
        .setName("graph-badges")
        .setDescription("Graph badge history for a Roblox user")
        .addStringOption((option) =>
            option
                .setName("roblox-username")
                .setDescription("Enter the Roblox username to graph")
                .setRequired(true)
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const startTime = Date.now();
            const username = interaction.options.getString("roblox-username", true);

            await interaction.reply({ content: `<a:loading:1439026179993767946> Loading user profile...`, components: [] });

            const robloxId = await getIdFromUsername(username);
            if (!robloxId) throw new Error("username not found");

            await interaction.editReply({ content: `<a:loading:1439026179993767946> Loading user badges...`, components: [] });

            // Get user badges
            const badges = await badge.getUserBadges(robloxId);
            if (!badges || badges.length === 0) {
                await interaction.editReply({
                    content: `No badges found for **${username}**`
                });
                return;
            }

            // Check for suspicious places
            const placeIds = [...new Set(badges.map(b => Number(b.placeId)).filter(Number.isFinite))];
            const suspiciousPlaces = [];

            for (const placeId of placeIds) {
                const result = await database.isSuspiciousPlace(placeId);
                if (result.isSuspicious) {
                    suspiciousPlaces.push({
                        placeId,
                        reason: result.reason
                    });
                }
            }

            // Generate graph using the shared function
            const buffer = generateBadgeGraph(badges, username, suspiciousPlaces);

            if (!buffer) {
                await interaction.editReply({
                    content: `Failed to generate badge graph for **${username}**`
                });
                return;
            }

            const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

            // Build message with suspicious places warning if any
            let content = `<@${interaction.user.id}> (took ${elapsedSeconds}s)`;
            if (suspiciousPlaces.length > 0) {
                content += `\n⚠️ **Warning:** Found ${suspiciousPlaces.length} suspicious place(s) (shown in red on graph)`;
            }

            await interaction.editReply({
                content,
                files: [
                    {
                        attachment: buffer,
                        name: `badge_graph_${username}.png`
                    }
                ],
            });

            // Ghost ping to pop the notification to the top
            const ghostping = await interaction.channel.send({
                content: `<@${interaction.user.id}>`
            });
            ghostping.delete().catch(() => { });

        } catch (err) {
            const msg =
                err instanceof Error && err.message ? err.message : "unknown error";
            const safe = "Badge graph generation failed. " + msg;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { });
            } else {
                await interaction
                    .reply({ content: safe, flags: MessageFlags.Ephemeral })
                    .catch(() => { });
            }
        }
    }
};
