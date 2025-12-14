"use strict";

const { SlashCommandBuilder, ContainerBuilder, MessageFlags } = require("discord.js");
const { getIdFromUsername } = require("../../api/roblox.js");
const roblox = require("../../api/roblox.js");
const badge = require("../../api/badge.js");
const assets = require("../../api/assets.js");
const groupsApi = require("../../api/groups.js");

const { createCanvas } = require("canvas");
const customization = require("../../../config.json");
const axios = require("axios");
const https = require("https");

const REQUEST_TIMEOUT_MS = 55000;

// keep connections alive for long-running lookups
const defaultHttpsAgent = new https.Agent({ keepAlive: true });
const ipv4HttpsAgent = new https.Agent({ keepAlive: true, family: 4 });

// shared axios client with a 55s timeout
const http = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    httpsAgent: defaultHttpsAgent
});

function withTimeout(promise, ms, label) {
    let timeoutId = null;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
        }, ms);
    });

    return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

async function wrap(promise) {
    try {
        const data = await Promise.resolve(promise);
        return { ok: true, data };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error && err.message ? err.message : String(err)
        };
    }
}

async function fetchAllUserGamePasses(userId) {
    const all = [];
    let exclusiveStartId = "";

    while (true) {
        const url = `https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=100&exclusiveStartId=${exclusiveStartId}`;
        const res = await http.get(url);
        const page = Array.isArray(res?.data?.gamePasses) ? res.data.gamePasses : [];

        all.push(...page);

        if (page.length === 100 && page[page.length - 1] && page[page.length - 1].gamePassId) {
            exclusiveStartId = String(page[page.length - 1].gamePassId);
            continue;
        }

        break;
    }

    return all;
}

module.exports = {
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
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const startTime = Date.now();
            const username = interaction.options.getString("roblox-username", true);

            await interaction.reply({
                content: `<a:loading:1439026179993767946> Loading user profile...`,
                components: []
            });

            const robloxId = await withTimeout(getIdFromUsername(username), REQUEST_TIMEOUT_MS, "Username lookup");
            if (!robloxId) throw new Error("username not found");

            const profilePromise = wrap(withTimeout(roblox.getUserProfile(robloxId), REQUEST_TIMEOUT_MS, "Profile"));
            const connectionsPromise = wrap(withTimeout(roblox.getConnections(robloxId), REQUEST_TIMEOUT_MS, "Connections"));
            const groupsPromise = wrap(withTimeout(groupsApi.getGroupInformation(robloxId), REQUEST_TIMEOUT_MS, "Groups"));
            const inventoryPromise = wrap(withTimeout(assets.getAssetsInformation(robloxId), REQUEST_TIMEOUT_MS, "Inventory"));
            const gamePassesPromise = wrap(withTimeout(fetchAllUserGamePasses(robloxId), REQUEST_TIMEOUT_MS, "Gamepasses"));

            const inventoryValuePromise = wrap(withTimeout((async () => {
                const rolimonsResponse = await http.get(
                    `https://api.rolimons.com/players/v1/playerinfo/${robloxId}`,
                    {
                        httpsAgent: ipv4HttpsAgent,
                        timeout: REQUEST_TIMEOUT_MS
                    }
                );

                if (rolimonsResponse.data && rolimonsResponse.data.success && typeof rolimonsResponse.data.value === "number") {
                    return rolimonsResponse.data.value;
                }

                return null;
            })(), REQUEST_TIMEOUT_MS, "Rolimons value"));

            const xTrackerPromise = wrap(withTimeout(http.get(
                `https://api.xtracker.xyz/api/registry/user?id=${robloxId}`,
                {
                    headers: {
                        Authorization: customization.XTRACKER_API_KEY
                    }
                }
            ), REQUEST_TIMEOUT_MS, "xTracker"));

            const badgesPromise = wrap(withTimeout(badge.getUserBadges(robloxId), REQUEST_TIMEOUT_MS, "Badges"));

            const [
                profileRes,
                connectionsRes,
                groupsRes,
                inventoryRes,
                gamePassesRes,
                inventoryValueRes,
                xTrackerRes,
                badgesRes
            ] = await Promise.all([
                profilePromise,
                connectionsPromise,
                groupsPromise,
                inventoryPromise,
                gamePassesPromise,
                inventoryValuePromise,
                xTrackerPromise,
                badgesPromise
            ]);

            const profile = profileRes.ok ? profileRes.data : null;
            const connections = connectionsRes.ok ? connectionsRes.data : null;
            const groups = groupsRes.ok && Array.isArray(groupsRes.data) ? groupsRes.data : [];
            const inventory = inventoryRes.ok && Array.isArray(inventoryRes.data) ? inventoryRes.data : [];
            const gamePasses = gamePassesRes.ok && Array.isArray(gamePassesRes.data) ? gamePassesRes.data : [];
            const inventoryValue = inventoryValueRes.ok ? inventoryValueRes.data : null;
            const xTrackerResponse = xTrackerRes.ok ? xTrackerRes.data : null;
            const badges = badgesRes.ok && Array.isArray(badgesRes.data) ? badgesRes.data : [];

            const profileError = profileRes.ok ? null : profileRes.error;
            const connectionsError = connectionsRes.ok ? null : connectionsRes.error;
            const groupsError = groupsRes.ok ? null : groupsRes.error;
            const inventoryError = inventoryRes.ok ? null : inventoryRes.error;
            const gamePassesError = gamePassesRes.ok ? null : gamePassesRes.error;
            const inventoryValueError = inventoryValueRes.ok ? null : inventoryValueRes.error;
            const xTrackerError = xTrackerRes.ok ? null : xTrackerRes.error;
            const badgesError = badgesRes.ok ? null : badgesRes.error;

            const canBuildBadgeGraph = Array.isArray(badges) && badges.length > 0;

            let buffer = null;
            let attachmentName = null;
            let badgeCount = Array.isArray(badges) ? badges.length : 0;

            if (canBuildBadgeGraph) {
                const sorted = [...badges].sort((a, b) => a.awardedDate - b.awardedDate);

                const width = 1200;
                const height = 600;
                const marginLeft = 80;
                const marginRight = 40;
                const marginTop = 70;
                const marginBottom = 70;

                const canvas = createCanvas(width, height);
                const ctx = canvas.getContext("2d");

                ctx.fillStyle = "black";
                ctx.fillRect(0, 0, width, height);

                ctx.fillStyle = "white";
                ctx.font = "30px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(`${username} • Badge Timeline`, width / 2, 15);

                ctx.font = "20px sans-serif";
                ctx.fillText(`${sorted.length} total badges`, width / 2, 50);

                const times = sorted.map((b) => new Date(b.awardedDate * 1000).getTime());
                const minTime = Math.min(...times);
                const maxTime = Math.max(...times);
                const spanTime = maxTime - minTime || 1;

                const maxTotal = sorted.length;

                const xForTime = (t) =>
                    marginLeft + ((t - minTime) / spanTime) * (width - marginLeft - marginRight);

                const yForTotal = (total) =>
                    height - marginBottom - ((total - 1) / (maxTotal - 1 || 1)) * (height - marginTop - marginBottom);

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

                buffer = canvas.toBuffer("image/png");
                attachmentName = `badge_graph_${username}.png`;
                badgeCount = sorted.length;
            }

            const baseRankGroups = groups.filter((g) => g.IsBaseRank);
            const developmentItems = inventory.filter((i) =>
                customization.ROBLOX_ASSET_TYPES.DEVELOPMENT.find((type) => type === i.type)
            );

            const gamePassPriceTotal = gamePasses.reduce((acc, gp) => acc + (typeof gp.price === "number" ? gp.price : 0), 0);
            const pricedGamePassCount = gamePasses.reduce((acc, gp) => acc + (typeof gp.price === "number" ? 1 : 0), 0);

            const xTrackerEvidence = [];
            const evidence = xTrackerResponse && xTrackerResponse.data ? xTrackerResponse.data.evidence : null;

            if (Array.isArray(evidence)) {
                const year = 31556952000;
                for (let i = 0; i < evidence.length; i++) {
                    const submission = evidence[i];
                    if (new Date(submission.date).getTime() > Date.now() - year) {
                        xTrackerEvidence.push(submission.reason);
                    }
                }
            }

            let xTrackerString = xTrackerError
                ? `Error fetching xTracker record: ${xTrackerError}`
                : "User was not found on the xTracker database";

            if (xTrackerEvidence.length > 0) {
                xTrackerString = `User has **${xTrackerEvidence.length}** xTracker submissions in the last year:\n`;
                for (let i = 0; i < xTrackerEvidence.length; i++) {
                    xTrackerString += `- **${xTrackerEvidence[i]}**\n`;
                }
            }

            const selectionContainer = new ContainerBuilder()
                .setAccentColor(customization.ACCENT_COLOR)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(`### Background check - [${username}](https://www.roblox.com/users/${robloxId}/profile) 🔎`)
                )
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) => {
                    if (profileError || !profile || !profile.created) {
                        return textDisplay.setContent(`**Join Date:** Error fetching join date: ${profileError || "unknown error"}`);
                    }
                    return textDisplay.setContent(`**Join Date:** User joined roblox on **${profile.created.toDateString()}**`);
                })
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) => {
                    if (connectionsError || !connections) {
                        return textDisplay.setContent(`**Connections:** Error fetching connections: ${connectionsError || "unknown error"}`);
                    }
                    return textDisplay.setContent(
                        `**Connections:** User has **${connections.friendCount}** friends and has **${connections.followerCount}** followers while following **${connections.followingCount}** accounts.`
                    );
                })
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) => {
                    if (groupsError) {
                        return textDisplay.setContent(`**Groups:** Error fetching groups: ${groupsError}`);
                    }
                    return textDisplay.setContent(
                        `**Groups:** User is in **${groups.length}** groups while being the base rank in **${baseRankGroups.length}** groups${
                            groups.length > 0 ? ` **(${Math.round((baseRankGroups.length / groups.length) * 100)}%)**` : ""
                        }`
                    );
                })
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) => {
                    if (inventoryError) {
                        return textDisplay.setContent(`**Inventory:** Error fetching inventory: ${inventoryError}`);
                    }

                    if (inventoryValueError) {
                        return textDisplay.setContent(
                            `**Inventory:** User has **${inventory.length}** assets and **${developmentItems.length}** development assets (value lookup error: ${inventoryValueError})`
                        );
                    }

                    const valueText = inventoryValue !== null
                        ? ` and an estimated total value of <:robux:1444752443614171279> **${inventoryValue.toLocaleString()}**`
                        : "";

                    return textDisplay.setContent(
                        `**Inventory:** User has **${inventory.length}** assets and **${developmentItems.length}** development assets${valueText}`
                    );
                })
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) => {
                    if (gamePassesError) {
                        return textDisplay.setContent(`**Gamepasses:** Error fetching gamepasses: ${gamePassesError}`);
                    }

                    const priceText = pricedGamePassCount > 0
                        ? ` totaling <:robux:1444752443614171279> **${gamePassPriceTotal.toLocaleString()}**`
                        : "";

                    return textDisplay.setContent(
                        `**Gamepasses:** User has **${gamePasses.length}** gamepasses with **${pricedGamePassCount}** priced gamepasses${priceText}`
                    );
                })
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(`**Cheating Record:** ${xTrackerString}`)
                )
                .addSeparatorComponents((separator) => separator)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(
                        badgesError
                            ? `**Badges:** Error fetching badges: ${badgesError}`
                            : `**Badges:** User has **${badgeCount}** badges.`
                    )
                );

            if (buffer && attachmentName) {
                selectionContainer.addMediaGalleryComponents((gallery) =>
                    gallery.addItems((item) =>
                        item.setURL(`attachment://${attachmentName}`).setDescription("Badge timeline")
                    )
                );
            }

            const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

            await interaction.editReply({
                content: `Background check complete (took ${elapsedSeconds}s)`
            });

            await interaction.followUp({
                components: [selectionContainer],
                files: buffer && attachmentName ? [{ attachment: buffer, name: attachmentName }] : [],
                flags: MessageFlags.IsComponentsV2
            });

            const ghostping = await interaction.channel.send({
                content: `<@${interaction.user.id}>`
            });
            ghostping.delete().catch(() => {});
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : "unknown error";
            const safe = "Background check failed. " + msg;

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => {});
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    }
};