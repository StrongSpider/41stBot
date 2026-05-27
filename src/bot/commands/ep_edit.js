"use strict";

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { sendEPUpdateWebhook } = require("../../api/webhook.js");
const { getIdFromUsername } = require("../../api/roblox.js");
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL;
const database = require("../../api/database");
const path = require("path");
const fs = require("fs");

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('EPEditCommand', 'BOT')

const CACHE_PATH = path.join(__dirname, "..", "..", "cache", "usernames.json");
let usernameEntries = null;

/**
 * Load usernames cache into memory
 * Structure: [{ name, lc }]
 */
function loadUsernames() {
    //if (usernameEntries !== null) return;
    try {
        const raw = fs.readFileSync(CACHE_PATH, "utf-8");
        const list = JSON.parse(raw);
        usernameEntries = Array.isArray(list)
            ? list.map((name) => ({ name, lc: String(name).toLowerCase() }))
            : [];
    } catch {
        usernameEntries = [];
    }
}

/**
 * Chunk a long string into pieces with max length per chunk
 * @param {string} text
 * @param {number} max
 */
function chunkByLength(text, max) {
    const lines = text.split("\n");
    const chunks = [];
    let buf = "";
    for (const line of lines) {
        const add = line + "\n";
        if (buf.length + add.length > max) {
            if (buf) chunks.push(buf);
            buf = "";
        }
        buf += add;
    }
    if (buf) chunks.push(buf);
    return chunks;
}

module.exports = {
    permission: "OFFICER",
    requiresEventEpWrite: true,
    data: new SlashCommandBuilder()
        .setName("ep-edit")
        .setDescription("Update event points for one or more users")
        .addStringOption((option) =>
            option
                .setName("roblox-usernames")
                .setDescription("Enter Roblox usernames separated by spaces")
                .setAutocomplete(true)
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("operation")
                .setDescription("Choose how to update the event points")
                .setChoices(
                    { name: "add", value: "add" },
                    { name: "subtract", value: "subtract" },
                    { name: "set", value: "set" }
                )
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option.setName("amount").setDescription("Enter the event point amount").setRequired(true)
        ),

    /**
     * @param {import('discord.js').AutocompleteInteraction} interaction
     */
    async autocomplete(interaction) {
        try {
            const { value } = interaction.options.getFocused(true);
            const raw = value;
            const parts = raw === "" ? [] : raw.split(" ");
            const partialRaw = parts.pop() || "";
            const partial = partialRaw.toLowerCase();

            loadUsernames();

            const used = new Set(parts.map((p) => p.toLowerCase()));
            const suggestions = [];
            for (const { name, lc } of usernameEntries) {
                if (suggestions.length === 25) break;
                if (used.has(lc)) continue;
                if (lc.startsWith(partial)) suggestions.push(name);
            }

            const responses = suggestions
                .map((name) => {
                    const combo = [...parts, name].join(" ");
                    return { name: combo, value: combo };
                })
                .filter((r) => r.value.length <= 100);

            await interaction.respond(responses);
        } catch {
            // best effort autocomplete
            await interaction.respond([]).catch(() => { });
        }
    },

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();

            const raw = interaction.options.getString("roblox-usernames", true);
            const operation = interaction.options.getString("operation", true);
            const amount = interaction.options.getInteger("amount", true);
            const usernames = raw.split(" ").filter(Boolean);

            let result = "";

            for (const username of usernames) {
                try {
                    const robloxId = await getIdFromUsername(username);
                    if (!robloxId) throw new Error("username not found");

                    const oldEP = (await database.getCurrentEventPoints(robloxId)) || 0;
                    let newEP = oldEP;
                    switch (operation) {
                        case "add":
                            newEP = oldEP + amount;
                            break;
                        case "subtract":
                            newEP = oldEP - amount;
                            break;
                        case "set":
                            newEP = amount;
                            break;
                        default:
                            throw new Error("invalid operation");
                    }

                    newEP = Math.max(newEP, 0);

                    await database.setCurrentEventPoints(robloxId, newEP).catch((err) => {
                        logger.error(err);
                        throw new Error("db write failed or user not verified");
                    });

                    await sendEPUpdateWebhook({
                        robloxId,
                        discordId: interaction.user.id,
                        username,
                        oldPoints: oldEP,
                        newPoints: newEP,
                    });

                    result += `✅ ${username}: \`${oldEP}\` -> \`${newEP}\`\n`;
                } catch (err) {
                    logger.error(err);
                    const msg =
                        err instanceof Error && err.message ? err.message : "unknown error";
                    result += `❌ ${username}: **${msg}**\n`;
                }
            }

            const chunks = chunkByLength(result.trim(), 1024);

            const embeds = chunks.map((chunk, index) => {
                const embed = new EmbedBuilder()
                    .setColor(EMBED_COLOR)
                    .setTimestamp()
                    .setFooter({
                        text: `EP EDIT ${interaction.user.id}`,
                        iconURL: interaction.guild?.iconURL() ?? undefined,
                    });
                if (index === 0) {
                    embed
                        .setTitle("Edit Results")
                        .setDescription(
                            `Executed By\n${interaction.user} (${interaction.user.id})`
                        )
                        .addFields({ name: "Results", value: chunk });
                } else {
                    embed
                        .setTitle("Edit Results (cont.)")
                        .addFields({ name: "Results (cont.)", value: chunk });
                }
                return embed;
            });

            await interaction.editReply({ embeds });
        } catch (err) {
            const msg =
                err instanceof Error && err.message ? err.message : "unknown error";
            const safe = "EP edit failed. " + msg;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { });
            } else {
                await interaction
                    .reply({ content: safe, flags: MessageFlags.Ephemeral })
                    .catch(() => { });
            }
        }
    },
};
