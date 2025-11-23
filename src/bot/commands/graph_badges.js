"use strict";

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getIdFromUsername } = require("../../api/roblox.js");
const badge = require("../../api/badge.js");

const { createCanvas } = require("canvas");

module.exports = {
    // adjust permission if you want
    permission: "OFFICER",
    data: new SlashCommandBuilder()
        .setName("graph-badges")
        .setDescription("Graphs a user's badges over time")
        .addStringOption((option) =>
            option
                .setName("roblox-username")
                .setDescription("Target Roblox username")
                .setRequired(true)
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const startTime = Date.now();
            const username = interaction.options.getString("roblox-username", true);

            await interaction.reply({ content: `<a:loading:1439026179993767946> Loading user profile...`, components: [] })

            const robloxId = await getIdFromUsername(username);
            if (!robloxId) throw new Error("username not found");

            await interaction.editReply({ content: `<a:loading:1439026179993767946> Loading user badges...`, components: [] })

            // pull badges using the same source as test.js
            const badges = await badge.getUserBadges(robloxId);
            if (!badges || badges.length === 0) {
                await interaction.editReply({
                    content: `No badges found for **${username}**`
                });
                return;
            }
            
            // sort by awardedDate ascending
            const sorted = [...badges].sort(
                (a, b) => a.awardedDate - b.awardedDate
            );

            const width = 1200;
            const height = 600;
            const marginLeft = 80;
            const marginRight = 40;
            const marginTop = 70;
            const marginBottom = 70;

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext("2d");

            // background
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, width, height);

            // title
            ctx.fillStyle = "white";
            ctx.font = "30px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(`${username} • Badge Timeline`, width / 2, 15);

            // subtitle
            ctx.font = "20px sans-serif";
            ctx.fillText(`${sorted.length} total badges`, width / 2, 50);

            if (sorted.length > 0) {
                // build data
                const times = sorted.map(b => new Date(b.awardedDate * 1000).getTime());
                const minTime = Math.min(...times);
                const maxTime = Math.max(...times);
                const spanTime = maxTime - minTime || 1;

                const maxTotal = sorted.length;

                // helper to map time and total to canvas coords
                const xForTime = (t) =>
                    marginLeft +
                    ((t - minTime) / spanTime) *
                    (width - marginLeft - marginRight);

                const yForTotal = (total) =>
                    height - marginBottom -
                    ((total - 1) / (maxTotal - 1 || 1)) *
                    (height - marginTop - marginBottom);

                // grid - X (years)
                const minYear = new Date(minTime).getUTCFullYear();
                const maxYear = new Date(maxTime).getUTCFullYear();
                ctx.strokeStyle = "#222222";
                ctx.lineWidth = 1;
                ctx.font = "18px sans-serif";
                ctx.fillStyle = "white";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";

                for (let year = minYear; year <= maxYear; year++) {
                    const t = Date.UTC(year, 0, 1);
                    if (t < minTime || t > maxTime) continue;
                    const x = xForTime(t);

                    ctx.beginPath();
                    ctx.moveTo(x, marginTop);
                    ctx.lineTo(x, height - marginBottom);
                    ctx.stroke();

                    ctx.fillText(String(year), x, height - marginBottom + 5);
                }

                // grid - Y (totals) at fixed 100-badge steps
                const steps = 6;
                ctx.textAlign = "right";
                ctx.textBaseline = "middle";

                for (let i = 0; i <= steps; i++) {
                    const total = 1 + Math.round((maxTotal - 1) * (i / steps));
                    const y = yForTotal(Math.min(total, maxTotal));

                    ctx.beginPath();
                    ctx.moveTo(marginLeft, y);
                    ctx.lineTo(width - marginRight, y);
                    ctx.stroke();

                    ctx.fillText(String(total), marginLeft - 10, y);
                }

                // draw points (green outlined dot with transparent fill)
                for (let i = 0; i < sorted.length; i++) {
                    const b = sorted[i];
                    const t = new Date(b.awardedDate * 1000).getTime();
                    const total = i + 1;
                    const x = xForTime(t);
                    const y = yForTotal(total);

                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(0, 255, 90, 0.35)";
                    ctx.fill();
                    ctx.strokeStyle = "rgba(0, 255, 90, 0.9)";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }

            const buffer = canvas.toBuffer("image/png");

            const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

            await interaction.editReply({
                content: `<@${interaction.user.id}> (took ${elapsedSeconds}s)`,
                files: [
                    {
                        attachment: buffer,
                        name: `badge_graph_${username}.png`
                    }
                ],
            });

            // ghost ping to pop the notification to the top
            const ghostping = await interaction.channel.send({
                content: `<@${interaction.user.id}>`
            });
            ghostping.delete().catch(() => { });

        } catch (err) {
            const msg =
                err instanceof Error && err.message ? err.message : "unknown error";
            const safe = "Background check failed. " + msg;
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