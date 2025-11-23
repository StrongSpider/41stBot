"use strict";

const { SlashCommandBuilder, CommandInteraction, ContainerBuilder, ComponentType, TextInputStyle, TextInputBuilder, ModalBuilder, ButtonStyle, MessageFlags, ActionRowBuilder, ButtonBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { getIdFromUsername } = require("../../api/roblox.js");
const roblox = require("../../api/roblox.js");
const badge = require("../../api/badge.js");
const assets = require("../../api/assets.js");
const groupsApi = require("../../api/groups.js");

const { createCanvas, loadImage } = require("canvas");
const customization = require('../../../config.json');
const { default: axios } = require('axios');

module.exports = {
    // adjust permission if you want
    permission: "OFFICER",
    data: new SlashCommandBuilder()
        .setName("background-check")
        .setDescription("Runs a background check on a user")
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

            // const canView = await roblox.canViewInventory(robloxId)
            // if (!canView) throw new Error("inventory private")

            const profile = await roblox.getUserProfile(robloxId)

            await interaction.editReply({ content: `<a:loading:1439026179993767946> Loading user connections...`, components: [] })

            const connections = await roblox.getConnections(robloxId)

            await interaction.editReply({ content: `<a:loading:1439026179993767946> Loading user groups...`, components: [] })

            const groups = await groupsApi.getGroupInformation(robloxId)

            await interaction.editReply({ content: `<a:loading:1439026179993767946> Loading user inventory...`, components: [] })

            const inventory = await assets.getAssetsInformation(robloxId)

            await interaction.editReply({ content: `<a:loading:1439026179993767946> Loading user cheating profile...`, components: [] })

            const xTrackerResponse = await axios.get(`https://api.xtracker.xyz/api/registry/user?id=${robloxId}`, {
                headers: {
                    "Authorization": customization.XTRACKER_API_KEY
                }
            }).catch((e) => {
                return {
                    data: { error: e.message }
                }
            })

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
            const attachmentName = `badge_graph_${username}.png`;

            const baseRankGroups = groups.filter((g) => g.IsBaseRank)

            const developmentItems = inventory.filter((i) => customization.ROBLOX_ASSET_TYPES.DEVELOPMENT.find((type) => type == i.type))

            const xTrackerEvidence = []

            const evidence = xTrackerResponse.data.evidence
            if (evidence) {
                const year = 31556952000 // 1 year in ms
                for (let index = 0; index < evidence.length; index++) {
                    const submission = evidence[index];
                    if ((new Date(submission.date).getTime()) < (Date.now() - year)) {
                        xTrackerEvidence.push(submission.reason)
                    }
                }
            }

            let xTrackerString = "User was not found on the xTracker database"
            if (xTrackerEvidence.length > 0) {
                xTrackerString = `User has **${xTrackerEvidence.length}** xTracker submissions in the last year:\n`
                for (let index = 0; index < xTrackerEvidence.length; index++) {
                    const reason = xTrackerEvidence[index];
                    xTrackerString += `- **${reason}**\n`
                }
            }

            const selectionContainer = new ContainerBuilder()
                .setAccentColor(customization.ACCENT_COLOR)
                .addTextDisplayComponents(textDisplay =>
                    textDisplay.setContent(`### Background check - [${username}](https://www.roblox.com/users/${robloxId}/profile) 🔎`)
                )
                .addSeparatorComponents(separator => separator)
                .addTextDisplayComponents(textDisplay =>
                    textDisplay.setContent(
                        `**Join Date:** User joined roblox on **${profile.created.toDateString()}**`
                    )
                )
                .addSeparatorComponents(separator => separator)
                .addTextDisplayComponents(textDisplay =>
                    textDisplay.setContent(
                        `**Connections:** User has **${connections.friendCount}** friends and has **${connections.followerCount}** followers while following **${connections.followingCount}** accounts.`
                    )
                )
                .addSeparatorComponents(separator => separator)
                .addTextDisplayComponents(textDisplay =>
                    textDisplay.setContent(
                        `**Groups:** User is in **${groups.length}** groups while being the base rank in **${baseRankGroups.length}** groups${groups.length > 0
                            ? ` **(${Math.round((baseRankGroups.length / groups.length) * 100)}%)**`
                            : ''
                        }`
                    )
                )
                .addSeparatorComponents(separator => separator)
                .addTextDisplayComponents(textDisplay =>
                    textDisplay.setContent(
                        `**Inventory:** User has **${inventory.length}** assets and **${developmentItems.length}** development assets`
                    )
                )
                .addSeparatorComponents(separator => separator)
                .addTextDisplayComponents(textDisplay =>
                    textDisplay.setContent(
                        `**Cheating Record:** ${xTrackerString}`
                    )
                )
                .addSeparatorComponents(separator => separator)
                .addTextDisplayComponents(textDisplay =>
                    textDisplay.setContent(
                        `**Badges:** User has **${badges.length}** badges.`
                    )
                )
                .addMediaGalleryComponents(gallery =>
                    gallery.addItems(item =>
                        item
                            .setURL(`attachment://${attachmentName}`)
                            .setDescription('Badge timeline')
                    )
                );

            const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

            await interaction.editReply({
                content: `Background check complete (took ${elapsedSeconds}s)`,
            })

            await interaction.followUp({
                components: [selectionContainer],
                files: [
                    {
                        attachment: buffer,
                        name: `badge_graph_${username}.png`
                    }
                ],
                flags: MessageFlags.IsComponentsV2
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