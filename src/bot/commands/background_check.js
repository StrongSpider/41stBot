"use strict";

const { SlashCommandBuilder, ContainerBuilder, MessageFlags, ComponentType } = require("discord.js");

const backgroundCheck = require("../../api/backgroundCheck.js");
const config = require("../../../config.json");
const ui = require("../utils/bgCheckUI.js");

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('Purge', 'BOT')

const COLLECTOR_MS = 10 * 60 * 1000;
const ACCENT_COLOR = config.GENERAL.ACCENT_COLOR;

module.exports = {
    permission: "OFFICER",
    data: new SlashCommandBuilder()
        .setName("background-check")
        .setDescription("Runs a background check on a user")
        .addStringOption(option =>
            option
                .setName("roblox-username")
                .setDescription("Target Roblox username")
                .setRequired(true)
        ),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const username = interaction.options.getString("roblox-username", true);

            await interaction.reply({
                content: "<a:loading:1439026179993767946> Loading user profile...",
                components: []
            });

            const result = await backgroundCheck.performBackgroundCheck(username);
            if (!result?.success) {
                return interaction.editReply({ content: `❌ ${result?.error ?? "Unknown error"}` });
            }

            const xTrackerSummary =
                result?.xTracker && result.xTracker.evidenceCount > 0
                    ? `User has **${result.xTracker.evidenceCount}** xTracker submissions in the last year.`
                    : "User was not found on the xTracker database";

            const selectionContainer = new ContainerBuilder().setAccentColor(config.GENERAL.ACCENT_COLOR);

            selectionContainer.addTextDisplayComponents(td =>
                td.setContent(
                    `## <:check:1454306643503349935> Background Check Overview — ` +
                    `[${result.username}](https://www.roblox.com/users/${result.robloxId}/profile)`
                )
            );

            // AI Prediction
            if (result.aiPrediction) {
                const title = "### 🤖 AI Analysis";
                const score = result.aiPrediction.cumulativeScore;
                const rating = result.aiPrediction.suspicionString;

                // Recommendations
                let recText = "";
                if (result.aiPrediction.recommendation && result.aiPrediction.recommendation.length > 0) {
                    const recs = Array.isArray(result.aiPrediction.recommendation) ? result.aiPrediction.recommendation : [result.aiPrediction.recommendation];
                    recText = `\n\n**Recomended Actions:**\n${recs.map(r => `- ${r}`).join("\n")}`;
                }

                const content = `**Rating:** ${rating} (${score}%)\n**Confidence:** ${result.aiPrediction.confidence}%${recText}`;

                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("ai", result.robloxId, interaction.user.id)
                });
            }

            // Join Date
            {
                const title = "### 📅 Join Date";
                let content = "`unknown`";

                if (result.profile?.error) {
                    content = `Error fetching join date: ${result.profile.error}`;
                } else if (result.profile?.created) {
                    const created = new Date(result.profile.created);
                    const joinUnix = Number.isNaN(created.getTime()) ? null : Math.floor(created.getTime() / 1000);
                    if (joinUnix) {
                        content = `User joined Roblox on <t:${joinUnix}:D> (<t:${joinUnix}:R>)`;
                    }
                }

                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("join", result.robloxId, interaction.user.id)
                });
            }

            // Connections
            {
                const title = "### <:friends:1454309495160176760> Connections";
                const content = result.connections?.error
                    ? `Error fetching connections: ${result.connections.error}`
                    : `User has **${result.connections.friendCount}** friends and has **${result.connections.followerCount}** followers while following **${result.connections.followingCount}** accounts.`;
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("connections", result.robloxId, interaction.user.id)
                });
            }

            // Groups
            {
                const title = "### <:groups:1454310076490846413> Groups";
                const content = result.groups?.error
                    ? `Error fetching groups: ${result.groups.error}`
                    : `User is in **${result.stats.groupCount}** groups while being the base rank in **${result.stats.baseRankGroupCount}** groups${result.stats.groupCount > 0 ? ` **(${result.stats.baseRankPercentage}%)**` : ""}`;
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("groups", result.robloxId, interaction.user.id)
                });
            }

            // Inventory
            {
                const title = "### <:inventory:1454310516322209995> Inventory";
                let content = "Error fetching inventory.";
                if (!result.inventory?.error) {
                    const valueText = result.inventoryValue
                        ? ` and an estimated total value of ${ui.formatRobux(result.inventoryValue)}`
                        : "";
                    content = `User has **${result.stats.inventoryCount}** assets and **${result.stats.developmentItemCount}** development assets${valueText}`;
                } else {
                    content = `Error fetching inventory: ${result.inventory.error}`;
                }
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("inventory", result.robloxId, interaction.user.id)
                });
            }

            // Gamepasses
            {
                const title = "### <:gamepasses:1454310928823619675> Gamepasses";
                const content = result.gamePasses?.error
                    ? `Error fetching gamepasses: ${result.gamePasses.error}`
                    : (() => {
                        const pricedTotalText = result.stats.pricedGamePassCount > 0
                            ? ` totaling ${ui.formatRobux(result.stats.gamePassPriceTotal)}${result.stats.selfCreatedPricedGamePassCount > 0 ? ` (excluding ${result.stats.selfCreatedPricedGamePassCount} self-created)` : ""}`
                            : "";
                        return `User has **${result.stats.gamePassCount}** gamepasses with **${result.stats.pricedGamePassCount}** priced gamepasses${pricedTotalText}`;
                    })();
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("gamepasses", result.robloxId, interaction.user.id)
                });
            }

            // Favorites
            {
                const title = "### ⭐ Favorites";
                const content = `User has **${result.stats.favoriteGamesCount}** game${result.stats.favoriteGamesCount === 1 ? "" : "s"} marked as favorite`;
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("favorites", result.robloxId, interaction.user.id)
                });
            }

            // Cheating Record
            {
                const title = "### <:cheater:1454312229980864542> Cheating Record";
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content: xTrackerSummary,
                    customId: ui.makeCustomId("xtracker", result.robloxId, interaction.user.id)
                });
            }

            // Badges
            {
                const title = "### <:badge:1454312648463093800> Badges";
                const content = result.badges?.error
                    ? `Error fetching badges: ${result.badges.error}`
                    : `User has **${result.stats.badgeCount}** badges.`;
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("badges", result.robloxId, interaction.user.id)
                });
            }

            // Badge graph
            if (result.badgeGraph) {
                selectionContainer.addMediaGalleryComponents(gallery =>
                    gallery.addItems(item =>
                        item
                            .setURL(`attachment://${result.badgeGraph.filename}`)
                            .setDescription("Badge timeline")
                    )
                );
            }

            // Risk Visual
            if (result.riskVisual) {
                selectionContainer.addMediaGalleryComponents(gallery =>
                    gallery.addItems(item =>
                        item
                            .setURL(`attachment://${result.riskVisual.filename}`)
                            .setDescription("AI Risk Assessment")
                    )
                );
            }

            const elapsedSeconds = (result.elapsedMs / 1000).toFixed(2);
            await interaction.editReply({ content: `Background check complete (took ${elapsedSeconds}s)` });

            const sent = await interaction.followUp({
                components: [selectionContainer],
                files: [
                    ...(result.badgeGraph ? [{ attachment: result.badgeGraph.buffer, name: result.badgeGraph.filename }] : []),
                    ...(result.riskVisual ? [{ attachment: result.riskVisual.buffer, name: result.riskVisual.filename }] : [])
                ],
                flags: MessageFlags.IsComponentsV2,
                fetchReply: true
            });

            const sectionHandlers = {
                join: async () => {
                    if (!result.profile || result.profile.error) {
                        return {
                            type: "content",
                            payload: result.profile?.error ? `Failed to load profile: ${result.profile.error}` : "Failed to load profile."
                        };
                    }

                    return {
                        type: "components",
                        payload: ui.buildJoinProfileContainer(result.profile, ACCENT_COLOR)
                    };
                },
                connections: async () => ({
                    type: "components",
                    payload: ui.buildConnectionsContainer(result, ACCENT_COLOR)
                }),
                groups: async () => ({
                    type: "components",
                    payload: ui.buildGroupsContainer(result, ACCENT_COLOR)
                }),
                inventory: async () => ({
                    type: "components",
                    payload: ui.buildInventoryContainer(result, ACCENT_COLOR)
                }),
                gamepasses: async () => ({
                    type: "components",
                    payload: ui.buildGamepassesContainer(result, ACCENT_COLOR)
                }),
                favorites: async () => ({
                    type: "components",
                    payload: ui.buildFavoritesContainer(result, ACCENT_COLOR)
                }),
                xtracker: async () => ({
                    type: "components",
                    payload: ui.buildXTrackerContainer(result, ACCENT_COLOR)
                }),
                badges: async () => ({
                    type: "components",
                    payload: await ui.buildBadgesContainer(result, ACCENT_COLOR)
                }),
                ai: async () => ({
                    type: "components",
                    payload: ui.buildAIAnalysisContainer(result, ACCENT_COLOR)
                })
            };

            const collector = sent.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: COLLECTOR_MS
            });

            collector.on("collect", async i => {
                try {
                    const parsed = ui.parseCustomId(i.customId);
                    if (!parsed) return;

                    if (parsed.ownerId !== interaction.user.id) {
                        return i.reply({ content: "Only the command runner can use these buttons.", flags: MessageFlags.Ephemeral }).catch(() => { });
                    }

                    if (String(result.robloxId) !== String(parsed.robloxId)) {
                        return i.reply({ content: "That button does not match this background check.", flags: MessageFlags.Ephemeral }).catch(() => { });
                    }

                    const handler = sectionHandlers[parsed.section];
                    if (!handler) {
                        return i.reply({ content: `Section \`${parsed.section}\` not found!`, flags: MessageFlags.Ephemeral }).catch(() => { });
                    }

                    const res = await handler();

                    if (!res || !res.type) {
                        return i.reply({ content: "Failed to load further information.", flags: MessageFlags.Ephemeral }).catch(() => { });
                    }

                    if (res.type === "content") {
                        return i.reply({ content: res.payload, flags: MessageFlags.Ephemeral }).catch(() => { });
                    }

                        return i.reply({ components: [res.payload], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch(e => { logger.error(e); });
                } catch (e) {
                    logger.error(e);
                    return i.reply({ content: "Failed to load further information.", flags: MessageFlags.Ephemeral }).catch(() => { });
                }
            });

            // Ghost ping to pop the notification to the top
            const ghostPing = await interaction.channel.send({ content: `<@${interaction.user.id}>` });
            ghostPing.delete().catch(() => { });

        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : "unknown error";
            const safe = `Background check failed. ${msg}`;

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { });
                return;
            }

            await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
};