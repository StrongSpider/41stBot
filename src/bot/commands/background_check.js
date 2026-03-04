"use strict";

const { SlashCommandBuilder, ContainerBuilder, MessageFlags, ComponentType, ButtonStyle } = require("discord.js");

const backgroundCheck = require("../../api/backgroundCheck.js");
const roblox = require("../../api/roblox.js");
const config = require("../../../config.json");

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('BackgroundCheckCommand', 'BOT')

const COLLECTOR_MS = 10 * 60 * 1000;
const ACCENT_COLOR = config.GENERAL.ACCENT_COLOR;
const CUSTOM_ID_PREFIX = "bgcf";
const MAX_DISCORD_TEXT = 3800;
const MAX_TOTAL = 3900;
const CHEATING_RECORD_POLICY_NOTICE = "Cheating records from xTracker and Clanware are not part of the 41st Tryout Background Check and must not be used to pass or fail anyone.";

function chunkText(input, maxLen = 3500) {
    const text = String(input ?? "");
    if (text.length <= maxLen) return [text];

    const chunks = [];
    let index = 0;

    while (index < text.length) {
        let end = Math.min(index + maxLen, text.length);
        const newlineIndex = text.lastIndexOf("\n", end);
        if (newlineIndex > index + 200) end = newlineIndex;
        chunks.push(text.slice(index, end));
        index = end;
    }

    return chunks;
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function formatRobux(value) {
    const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
    return `<:robux:1444752443614171279> **${amount.toLocaleString()}**`;
}

function isInventoryPrivate(result) {
    if (result?.inventoryPrivate === true) return true;

    const error = result?.inventory?.error;
    return typeof error === "string" && error.toLowerCase().includes("inventory private");
}

function makeCustomId(section, robloxId, ownerId) {
    return `${CUSTOM_ID_PREFIX}|${section}|${robloxId}|${ownerId}`;
}

function parseCustomId(customId) {
    const parts = String(customId ?? "").split("|");
    if (parts.length !== 4) return null;

    const [prefix, section, robloxId, ownerId] = parts;
    if (prefix !== CUSTOM_ID_PREFIX) return null;

    return { section, robloxId, ownerId };
}

function addExpandableSection(container, { title, content, customId, buttonLabel = "Expand →", buttonStyle = ButtonStyle.Secondary }) {
    container.addSeparatorComponents(sep => sep);

    container.addSectionComponents(section =>
        section
            .addTextDisplayComponents(td => td.setContent(`${title}\n${content}`))
            .setButtonAccessory(btn =>
                btn
                    .setCustomId(customId)
                    .setLabel(buttonLabel)
                    .setStyle(buttonStyle)
            )
    );
}

function buildErrorContainer(title, message, accentColor) {
    return new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(td => td.setContent(`## ${title}`))
        .addSeparatorComponents(sep => sep)
        .addTextDisplayComponents(td => td.setContent(String(message ?? "Unknown error")));
}

function buildPrivateInventoryNoticeContainer(title, accentColor) {
    return new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(td => td.setContent(`## ${title}`))
        .addSeparatorComponents(sep => sep)
        .addTextDisplayComponents(td =>
            td.setContent(
                "This user's inventory is private. Only join date, connections, groups, favorites, and cheating records are available in this background check."
            )
        );
}

function getCheatingRecord(result) {
    if (result?.cheatingRecord && typeof result.cheatingRecord === "object") {
        return result.cheatingRecord;
    }

    const legacyXTrackerRecords = asArray(result?.xTracker?.evidence).map(record => ({
        source: "xTracker",
        type: "submission",
        reason: record?.reason || "No reason provided",
        date: record?.date || null,
        url: record?.url || null
    }));

    return {
        totalCount: legacyXTrackerRecords.length,
        hasRecord: legacyXTrackerRecords.length > 0,
        sourcesWithRecords: legacyXTrackerRecords.length > 0 ? ["xTracker"] : [],
        sourceErrors: {},
        sources: {
            xTracker: {
                recordCount: legacyXTrackerRecords.length,
                records: legacyXTrackerRecords
            },
            clanware: {
                caseCount: 0,
                cases: []
            }
        }
    };
}

function getCheatingRecordPreviewContent(result) {
    const cheatingRecord = getCheatingRecord(result);
    const xTrackerCount = Number(cheatingRecord?.sources?.xTracker?.recordCount ?? 0);
    const clanwareCount = Number(cheatingRecord?.sources?.clanware?.caseCount ?? 0);
    const sourceErrors = cheatingRecord?.sourceErrors || {};
    const unavailableSources = Object.keys(sourceErrors);

    if (cheatingRecord?.totalCount > 0) {
        const sourceBits = [];
        if (xTrackerCount > 0) sourceBits.push(`xTracker: **${xTrackerCount}**`);
        if (clanwareCount > 0) sourceBits.push(`Clanware: **${clanwareCount}**`);
        return sourceBits.join(" | ");
    }

    if (unavailableSources.length > 0) {
        return `No cheating records found from available sources.\nUnavailable: ${unavailableSources.join(", ")}`;
    }

    return "No xTracker or Clanware cheating records found.";
}

function buildJoinProfileContainer(profile, accentColor) {
    const created = profile?.created ? new Date(profile.created) : null;
    const joinUnix = created && !Number.isNaN(created.getTime()) ? Math.floor(created.getTime() / 1000) : null;

    const container = new ContainerBuilder().setAccentColor(accentColor);

    container.addTextDisplayComponents(td => td.setContent("## More Profile Information"));
    container.addSeparatorComponents(sep => sep);

    if (!profile) {
        container.addTextDisplayComponents(td => td.setContent("Profile unavailable."));
        return container;
    }

    const nameLine = `**Username:** ${profile.name ?? "Unknown"}\n**Display Name:** ${profile.displayName ?? "Unknown"}`;
    const idLine = `**User ID:** \`${profile.id ?? "?"}\``;
    const createdLine = joinUnix ? `**Created:** <t:${joinUnix}:F> (<t:${joinUnix}:R>)` : "**Created:** `unknown`";
    const badgesLine = `**Verified Badge:** \`${profile.hasVerifiedBadge ? "true" : "false"}\`\n**Banned:** \`${profile.isBanned ? "true" : "false"}\``;
    const externalLine = `**External App Display Name:** ${profile.externalAppDisplayName ? `\`${profile.externalAppDisplayName}\`` : "`none`"}`;

    container.addTextDisplayComponents(td => td.setContent(`${nameLine}\n${idLine}\n${createdLine}\n${badgesLine}\n${externalLine}`));

    const description = typeof profile.description === "string" ? profile.description : "";
    container.addSeparatorComponents(sep => sep);

    if (!description) {
        container.addTextDisplayComponents(td => td.setContent("*No description.*"));
    } else {
        container.addTextDisplayComponents(td => td.setContent("### Description"));
        for (const part of chunkText(description, 3200)) {
            container.addTextDisplayComponents(td => td.setContent(`\`\`\`\n${part}\n\`\`\``));
        }
    }

    return container;
}

function buildConnectionsContainer(result, accentColor) {
    if (result?.connections?.error) {
        return buildErrorContainer("Connections Details", result.connections.error, accentColor);
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);

    container.addTextDisplayComponents(td => td.setContent("## Connections Details"));
    container.addSeparatorComponents(sep => sep);

    const connections = result?.connections ?? {};
    const countLine =
        `**Friends:** ${connections.friendCount ?? 0}` +
        `\n**Followers:** ${connections.followerCount ?? 0}` +
        `\n**Following:** ${connections.followingCount ?? 0}`;

    container.addTextDisplayComponents(td => td.setContent(countLine));
    container.addSeparatorComponents(sep => sep);
    container.addTextDisplayComponents(td => td.setContent("### 🚀 Coming Soon\nFull background checks on friends!"));

    return container;
}

function buildGroupsContainer(result, accentColor) {
    if (result?.groups?.error) {
        return buildErrorContainer("Groups Details", result.groups.error, accentColor);
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);
    const groupsData = result?.groups;
    const list = Array.isArray(groupsData) ? groupsData : asArray(groupsData?.data);

    if (list.length === 0) {
        container.addTextDisplayComponents(td => td.setContent("## Groups Details (0)\nUser is not in any groups."));
        return container;
    }

    let output = `## Groups Details (${list.length})`;

    function tryAppend(line) {
        const next = `\n${line}`;
        if (output.length + next.length > MAX_TOTAL) return false;
        output += next;
        return true;
    }

    const primaryGroup = list.find(group => group.IsPrimary || group.isPrimary);
    if (primaryGroup) {
        const primaryName = primaryGroup.Name || primaryGroup.name || primaryGroup.groupName || "Unknown";
        const primaryId = primaryGroup.Id || primaryGroup.id || primaryGroup.groupId || "?";
        const primaryRole = primaryGroup.Role || primaryGroup.role || primaryGroup.roleName || "?";
        const primaryRank = primaryGroup.Rank || primaryGroup.rank || primaryGroup.roleRank || "?";

        tryAppend("### 👑 Primary Group");
        tryAppend(`**${primaryName}** (ID: ${primaryId})`);
        tryAppend(`Role: ${primaryRole} (${primaryRank})`);
    }

    const sorted = [...list].sort((a, b) => {
        const isBaseRankA = a.IsBaseRank !== undefined ? a.IsBaseRank : a.isBaseRank;
        const isBaseRankB = b.IsBaseRank !== undefined ? b.IsBaseRank : b.isBaseRank;
        if (isBaseRankA !== isBaseRankB) return isBaseRankA ? 1 : -1;
        const rankA = a.Rank || a.rank || a.roleRank || 0;
        const rankB = b.Rank || b.rank || b.roleRank || 0;
        return rankB - rankA;
    });

    const highRankGroups = sorted.filter(group => !(group.IsBaseRank !== undefined ? group.IsBaseRank : group.isBaseRank));
    const baseRankGroups = sorted.filter(group => (group.IsBaseRank !== undefined ? group.IsBaseRank : group.isBaseRank));

    let shown = 0;
    let truncated = false;

    function addGroupSection(title, groups) {
        if (groups.length === 0 || truncated) return;
        if (!tryAppend(title)) {
            truncated = true;
            return;
        }

        for (const group of groups) {
            const name = group.Name || group.name || group.groupName || "Unknown";
            const id = group.Id || group.id || group.groupId || "?";
            const role = group.Role || group.role || group.roleName || "?";
            const rank = group.Rank || group.rank || group.roleRank || "?";
            const line = `- **[${name}](https://www.roblox.com/groups/${id})** — ${role} (${rank})`;
            if (!tryAppend(line)) {
                truncated = true;
                return;
            }
            shown += 1;
        }
    }

    addGroupSection("### ⭐ High Rank Groups", highRankGroups);
    addGroupSection("### 👥 Base Rank Groups", baseRankGroups);

    if (truncated) {
        const remaining = Math.max(0, list.length - shown);
        const note = `*... and ${remaining}+ more groups.* [View full profile on Roblox](https://www.roblox.com/users/${result.robloxId}/profile)`;
        if (!tryAppend(note)) {
            const safeFallback = "\n*... more groups.*";
            if (output.length + safeFallback.length <= MAX_TOTAL) output += safeFallback;
        }
    }

    container.addTextDisplayComponents(td => td.setContent(output));
    return container;
}

function buildGamepassesContainer(result, accentColor) {
    if (result?.gamePasses?.error) {
        return buildErrorContainer("Gamepasses Details", result.gamePasses.error, accentColor);
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);
    const gamePasses = asArray(result?.gamePasses);

    if (gamePasses.length === 0) {
        container.addTextDisplayComponents(td => td.setContent("## Gamepasses Details\nUser does not own any gamepasses."));
        return container;
    }

    const stats = result?.stats ?? {};
    const pricedCount = stats.pricedGamePassCount ?? 0;
    const totalValue = stats.gamePassPriceTotal ?? 0;
    const selfCreatedValue = gamePasses.reduce((acc, gamePass) => {
        const isSelfCreated = Number(gamePass?.creator?.creatorId) === Number(result?.robloxId);
        const price = typeof gamePass?.price === "number" ? gamePass.price : 0;
        return acc + (isSelfCreated ? price : 0);
    }, 0);

    container.addTextDisplayComponents(td => td.setContent(`## Gamepasses Details (${gamePasses.length})`));
    container.addSeparatorComponents(sep => sep);

    const statsText =
        "### 📊 Inventory Summary\n" +
        `- **Total Owned:** ${gamePasses.length}\n` +
        `- **Priced Items:** ${pricedCount}\n` +
        `- **Total Value:** ${formatRobux(totalValue)} (excluding self-created)\n` +
        `- **Self-Created Value:** ${formatRobux(selfCreatedValue)}`;

    container.addTextDisplayComponents(td => td.setContent(statsText));
    container.addSeparatorComponents(sep => sep);

    const sorted = [...gamePasses].sort((a, b) => {
        const priceA = typeof a?.price === "number" ? a.price : -1;
        const priceB = typeof b?.price === "number" ? b.price : -1;
        return priceB - priceA;
    });

    let textLength = statsText.length;
    let shownCount = 0;
    let truncated = false;
    const lines = [];

    for (const gamePass of sorted) {
        const name = gamePass?.name || "Unknown";
        const id = gamePass?.gamePassId || "?";
        const price = typeof gamePass?.price === "number" ? formatRobux(gamePass.price) : "*No Price*";
        const line = `- **[${name}](https://www.roblox.com/game-pass/${id})** — ${price}`;

        if (textLength + line.length > MAX_DISCORD_TEXT) {
            truncated = true;
            break;
        }
        lines.push(line);
        textLength += line.length;
        shownCount += 1;
    }

    if (lines.length > 0) {
        const listHeader = `### 🛒 Owned Gamepasses (${lines.length}${truncated ? "+" : ""})`;
        const combined = `${listHeader}\n${lines.join("\n")}`;
        for (const chunk of chunkText(combined, 2500)) {
            container.addTextDisplayComponents(td => td.setContent(chunk));
        }
    }

    if (truncated) {
        const remaining = Math.max(0, gamePasses.length - shownCount);
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td =>
            td.setContent(`*... and ${remaining}+ more gamepasses.* [View full inventory on Roblox](https://www.roblox.com/users/${result.robloxId}/inventory#!/game-passes)`)
        );
    }

    return container;
}

function buildFavoritesContainer(result, accentColor) {
    if (result?.favorites?.error) {
        return buildErrorContainer("Favorite Games", result.favorites.error, accentColor);
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);
    const favorites = asArray(result?.favorites);

    if (favorites.length === 0) {
        container.addTextDisplayComponents(td => td.setContent("## Favorite Games\nUser does not have any favorited games."));
        return container;
    }

    container.addTextDisplayComponents(td => td.setContent(`## Favorite Games (${favorites.length})`));
    container.addSeparatorComponents(sep => sep);

    let textLength = 0;
    let shownCount = 0;
    let truncated = false;
    const lines = [];

    for (const favorite of favorites) {
        const name = favorite?.name || favorite?.groupName || "Unknown";
        const id = favorite?.id || favorite?.groupId || "?";
        const url = `https://www.roblox.com/games/${id}`;
        const line = `- **[${name}](${url})** (ID: ${id})`;

        if (textLength + line.length > MAX_DISCORD_TEXT) {
            truncated = true;
            break;
        }
        lines.push(line);
        textLength += line.length;
        shownCount += 1;
    }

    if (lines.length > 0) {
        for (const chunk of chunkText(lines.join("\n"), 3500)) {
            container.addTextDisplayComponents(td => td.setContent(chunk));
        }
    }

    if (truncated) {
        const remaining = Math.max(0, favorites.length - shownCount);
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td =>
            td.setContent(`*... and ${remaining}+ more favorites.* [View profile on Roblox](https://www.roblox.com/users/${result.robloxId}/profile)`)
        );
    }

    return container;
}

async function buildBadgesContainer(result, accentColor) {
    if (result?.badges?.error) {
        return buildErrorContainer("Badge Review", result.badges.error, accentColor);
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);
    const badges = asArray(result?.badges?.data);
    const suspicious = asArray(result?.badges?.suspicious);

    if (badges.length === 0 && suspicious.length === 0) {
        container.addTextDisplayComponents(td => td.setContent("## Badge Review\nUser does not have any badges or suspicious place records."));
        return container;
    }

    container.addTextDisplayComponents(td => td.setContent(`## Badge Review (${badges.length} badges)`));
    container.addSeparatorComponents(sep => sep);

    const placeCounts = new Map();
    for (const badge of badges) {
        const placeId = badge?.placeId;
        if (!placeId) continue;
        placeCounts.set(placeId, (placeCounts.get(placeId) || 0) + 1);
    }

    const topPlaces = Array.from(placeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const idsToResolve = new Set([...topPlaces.map(place => place[0]), ...suspicious.map(entry => entry?.placeId)].filter(Boolean));
    let namesMap = new Map();

    try {
        namesMap = await roblox.getPlaceDetails(Array.from(idsToResolve));
    } catch {
        namesMap = new Map();
    }

    if (topPlaces.length > 0) {
        const lines = topPlaces.map(([placeId, count]) => {
            const name = namesMap.get(placeId) || `Place ${placeId}`;
            return `- **[${name}](https://www.roblox.com/games/${placeId})** — ${count} badges`;
        });
        container.addTextDisplayComponents(td => td.setContent(`### 🎮 Most Played Games\n${lines.join("\n")}`));
        container.addSeparatorComponents(sep => sep);
    }

    if (suspicious.length > 0) {
        const lines = suspicious.map(entry => {
            const placeId = entry?.placeId;
            const name = namesMap.get(placeId) || `Place ${placeId}`;
            return `- **[${name}](https://www.roblox.com/games/${placeId})**\n  - *Reason:* ${entry?.reason ?? "Unknown"}`;
        });
        container.addTextDisplayComponents(td => td.setContent(`### ⚠️ Suspicious Places\n${lines.join("\n")}`));
        return container;
    }

    container.addTextDisplayComponents(td => td.setContent("### ✅ Suspicious Places\nUser has no known suspicious badge records."));
    return container;
}

function buildCheatingRecordContainer(result, accentColor) {
    const cheatingRecord = getCheatingRecord(result);
    const xTrackerRecords = asArray(cheatingRecord?.sources?.xTracker?.records);
    const clanwareCases = asArray(cheatingRecord?.sources?.clanware?.cases);
    const sourceErrors = cheatingRecord?.sourceErrors || {};

    if (cheatingRecord.totalCount === 0 && Object.keys(sourceErrors).length === 0) {
        return new ContainerBuilder()
            .setAccentColor(accentColor)
            .addTextDisplayComponents(td =>
                td.setContent(
                    "## Cheating Record\n" +
                    "User has no xTracker or Clanware cheating records.\n\n" +
                    `**41st Tryout Policy:** ${CHEATING_RECORD_POLICY_NOTICE}`
                )
            );
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);
    container.addTextDisplayComponents(td => td.setContent(`## Cheating Record (${cheatingRecord.totalCount})`));
    container.addTextDisplayComponents(td => td.setContent(`### 41st Tryout Policy Notice\n${CHEATING_RECORD_POLICY_NOTICE}`));

    if (Object.keys(sourceErrors).length > 0) {
        container.addSeparatorComponents(sep => sep);
        const errorLines = Object.entries(sourceErrors).map(([source, message]) => `- **${source}:** ${message}`);
        container.addTextDisplayComponents(td => td.setContent(`### Source Availability\n${errorLines.join("\n")}`));
    }

    if (xTrackerRecords.length > 0) {
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent("### xTracker\nOnly evidence from the last **1 year** is displayed."));

        const sortedEvidence = [...xTrackerRecords].sort((a, b) => new Date(b?.date).getTime() - new Date(a?.date).getTime());
        const lines = [];
        let textLength = 0;
        let shownCount = 0;
        let truncated = false;

        for (const evidence of sortedEvidence) {
            const date = evidence?.date || "Unknown date";
            const reason = evidence?.reason || "No reason provided";
            const evidenceLink = evidence?.url ? `\n  - [Evidence](${evidence.url})` : "";
            const line = `- **${reason}**\n  - Date: ${date}${evidenceLink}`;

            if (textLength + line.length > MAX_DISCORD_TEXT) {
                truncated = true;
                break;
            }
            lines.push(line);
            textLength += line.length;
            shownCount += 1;
        }

        if (lines.length > 0) {
            for (const chunk of chunkText(lines.join("\n\n"), 3500)) {
                container.addTextDisplayComponents(td => td.setContent(chunk));
            }
        }

        if (truncated) {
            const remaining = Math.max(0, sortedEvidence.length - shownCount);
            container.addTextDisplayComponents(td => td.setContent(`*... and ${remaining}+ more xTracker records.*`));
        }
    }

    if (clanwareCases.length > 0) {
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent("### Clanware\nArchived exploiter cases are included in this source."));

        const lines = [];
        let textLength = 0;
        let shownCount = 0;
        let truncated = false;

        for (const entry of clanwareCases) {
            const status = entry?.status || "Unknown";
            const strike = Number.isFinite(Number(entry?.strike)) ? ` | Strike ${entry.strike}` : "";
            const created = entry?.dateCreated || "Unknown";
            const updated = entry?.dateUpdated || "Unknown";
            const endDate = entry?.endDate || "N/A";
            const counts = `Evidence: ${entry?.evidenceCount ?? 0} | Alts: ${entry?.altsCount ?? 0} | Account Sharing: ${entry?.accountSharingCount ?? 0}`;
            const link = entry?.url ? `\n  - [Case API Record](${entry.url})` : "";
            const line =
                `- **Case #${entry?.caseId ?? "?"}** — ${status}${strike}\n` +
                `  - Created: ${created}\n` +
                `  - Updated: ${updated}\n` +
                `  - End Date: ${endDate}\n` +
                `  - ${counts}${link}`;

            if (textLength + line.length > MAX_DISCORD_TEXT) {
                truncated = true;
                break;
            }

            lines.push(line);
            textLength += line.length;
            shownCount += 1;
        }

        if (lines.length > 0) {
            for (const chunk of chunkText(lines.join("\n\n"), 3500)) {
                container.addTextDisplayComponents(td => td.setContent(chunk));
            }
        }

        if (truncated) {
            const remaining = Math.max(0, clanwareCases.length - shownCount);
            container.addTextDisplayComponents(td => td.setContent(`*... and ${remaining}+ more Clanware cases.*`));
        }
    }

    return container;
}

function buildInventoryContainer(result, accentColor) {
    if (isInventoryPrivate(result)) {
        return buildPrivateInventoryNoticeContainer("Inventory Details", accentColor);
    }

    if (result?.inventory?.error) {
        return buildErrorContainer("Inventory Details", result.inventory.error, accentColor);
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);
    const inventory = asArray(result?.inventory);

    if (inventory.length === 0) {
        container.addTextDisplayComponents(td =>
            td.setContent("## Inventory Details (0)\nUser does not have any inventory assets.")
        );
        return container;
    }

    container.addTextDisplayComponents(td => td.setContent(`## Inventory Details (${inventory.length})`));
    container.addSeparatorComponents(sep => sep);

    const counts = {};
    for (const item of inventory) {
        const type = item?.type || "Unknown";
        counts[type] = (counts[type] || 0) + 1;
    }

    const developmentTypes = config.ROBLOX.ASSET_TYPES.DEVELOPMENT;
    const developmentLines = [];
    let developmentTotal = 0;

    for (const type of developmentTypes) {
        if (counts[type]) {
            developmentLines.push(`- **${type}:** ${counts[type]}`);
            developmentTotal += counts[type];
        }
    }

    if (developmentTotal > 0) {
        const developmentText = `### 🛠️ Development Assets (${developmentTotal})\n${developmentLines.join("\n")}`;
        container.addTextDisplayComponents(td => td.setContent(developmentText));
    }

    const groups = {
        "👕 Clothing": ["TShirt", "Shirt", "Pants"],
        "🎩 Accessories": [
            "Hat", "HairAccessory", "FaceAccessory", "NeckAccessory", "ShoulderAccessory", "FrontAccessory",
            "BackAccessory", "WaistAccessory", "TShirtAccessory", "ShirtAccessory", "PantsAccessory",
            "JacketAccessory", "SweaterAccessory", "ShortsAccessory", "LeftShoeAccessory", "RightShoeAccessory",
            "DressSkirtAccessory", "EyebrowAccessory", "EyelashAccessory"
        ],
        "🏃 Animations": [
            "ClimbAnimation", "DeathAnimation", "FallAnimation", "IdleAnimation", "JumpAnimation",
            "RunAnimation", "SwimAnimation", "WalkAnimation", "PoseAnimation", "EmoteAnimation", "MoodAnimation"
        ],
        "👤 Body Parts": ["Head", "Face", "Torso", "RightArm", "LeftArm", "LeftLeg", "RightLeg", "Package", "DynamicHead", "Gear"]
    };

    let avatarText = "## <:closet:1454347534574162025> Avatar Assets\n";
    let hasAvatarAssets = false;

    for (const [groupName, types] of Object.entries(groups)) {
        let groupTotal = 0;
        for (const type of types) {
            groupTotal += counts[type] || 0;
        }

        if (groupTotal > 0) {
            avatarText += `\n**${groupName} (${groupTotal})**\n`;
            for (const type of types) {
                if (counts[type]) {
                    avatarText += `- ${type}: ${counts[type]}\n`;
                }
            }
            hasAvatarAssets = true;
        }
    }

    if (hasAvatarAssets) {
        if (developmentTotal > 0) container.addSeparatorComponents(sep => sep);
        for (const chunk of chunkText(avatarText, 3500)) {
            container.addTextDisplayComponents(td => td.setContent(chunk));
        }
    }

    if (developmentTotal === 0 && !hasAvatarAssets) {
        container.addTextDisplayComponents(td => td.setContent("*No categorized assets found.*"));
    }

    return container;
}

function buildAIAnalysisContainer(result, accentColor) {
    const prediction = result?.aiPrediction;
    if (!prediction) {
        return buildErrorContainer("AI Analysis", "No prediction data available.", accentColor);
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);

    container.addTextDisplayComponents(td =>
        td.setContent(`## 🤖 AI Analysis: ${prediction.suspicionString} (${prediction.cumulativeScore}% alt)`)
    );
    container.addSeparatorComponents(sep => sep);
    container.addTextDisplayComponents(td => td.setContent(`**Confidence:** ${prediction.confidence}%`));

    if (prediction.summary) {
        container.addTextDisplayComponents(td => td.setContent(`*${prediction.summary}*`));
    }

    if (prediction.recommendation && prediction.recommendation.length > 0) {
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent("### 💡 Recommendations"));

        const recommendations = Array.isArray(prediction.recommendation) ? prediction.recommendation : [prediction.recommendation];
        const recommendationText = recommendations.map(recommendation => `- ${recommendation}`).join("\n");

        for (const chunk of chunkText(recommendationText, 3500)) {
            container.addTextDisplayComponents(td => td.setContent(chunk));
        }
    }

    const breakdown = prediction.breakdown || prediction.areaScores;
    if (breakdown && Object.keys(breakdown).length > 0) {
        const sortedAreas = Object.values(breakdown)
            .sort((a, b) => (b.score || 0) - (a.score || 0));

        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent("### Breakdown"));

        const areaLines = sortedAreas.map(area => {
            const suspiciousSignals = Array.isArray(area.suspiciousSignals) ? area.suspiciousSignals : [];
            const reassuringSignals = Array.isArray(area.reassuringSignals) ? area.reassuringSignals : [];

            let line = `**${area.title}** - ${area.score}% (${area.direction || "neutral"})`;
            if (suspiciousSignals.length > 0) {
                line += `\n${suspiciousSignals.map(signal => `- 🚩 ${signal.explanation}`).join("\n")}`;
            }
            if (reassuringSignals.length > 0) {
                line += `\n${reassuringSignals.map(signal => `- ✅ ${signal.explanation}`).join("\n")}`;
            }
            return line;
        });

        for (const chunk of chunkText(areaLines.join("\n\n"), 3500)) {
            container.addTextDisplayComponents(td => td.setContent(chunk));
        }
    } else if (prediction.contributors && prediction.contributors.length > 0) {
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent("### Top Signals"));

        const signalLines = prediction.contributors
            .slice(0, 6)
            .map(signal => `- ${signal.contribution > 0 ? "🚩" : "✅"} ${signal.description}`);

        for (const chunk of chunkText(signalLines.join("\n"), 3500)) {
            container.addTextDisplayComponents(td => td.setContent(chunk));
        }
    }

    container.addSeparatorComponents(sep => sep);
    container.addTextDisplayComponents(td =>
        td.setContent("*AI predictions are probabilistic and may be incorrect. Always manually verify.*")
    );

    return container;
}

const ui = {
    addExpandableSection,
    buildAIAnalysisContainer,
    buildBadgesContainer,
    buildCheatingRecordContainer,
    buildConnectionsContainer,
    buildFavoritesContainer,
    buildGamepassesContainer,
    buildGroupsContainer,
    buildInventoryContainer,
    buildJoinProfileContainer,
    buildPrivateInventoryNoticeContainer,
    formatRobux,
    getCheatingRecord,
    getCheatingRecordPreviewContent,
    isInventoryPrivate,
    makeCustomId,
    parseCustomId
};

module.exports = {
    permission: "OFFICER",
    data: new SlashCommandBuilder()
        .setName("background-check")
        .setDescription("Run a background check on a Roblox user")
        .addStringOption(option =>
            option
                .setName("roblox-username")
                .setDescription("Enter the Roblox username to review")
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

            const cheatingRecord = ui.getCheatingRecord(result);
            const hasCheatingRecord = cheatingRecord.totalCount > 0;
            const cheatingRecordSummary = ui.getCheatingRecordPreviewContent(result);
            const inventoryPrivate = ui.isInventoryPrivate(result);
            const overviewNotices = [];

            if (inventoryPrivate) {
                overviewNotices.push(
                    "### Private Inventory\n" +
                    "This user's inventory is private, so this background check only shows join date, connections, groups, favorites, and cheating records."
                );
            }

            if (hasCheatingRecord) {
                overviewNotices.push(
                    "### <:cheater:1454312229980864542> Cheating Record Found\n" +
                    "Review the Cheating Record section below. These records do not affect 41st tryout pass/fail."
                );
            }

            const selectionContainer = new ContainerBuilder().setAccentColor(config.GENERAL.ACCENT_COLOR);

            selectionContainer.addTextDisplayComponents(td =>
                td.setContent(
                    `## <:check:1454306643503349935> Background Check Overview — ` +
                    `[${result.username}](https://www.roblox.com/users/${result.robloxId}/profile)` +
                    (overviewNotices.length > 0 ? `\n\n${overviewNotices.join("\n\n")}` : "")
                )
            );

            // AI Prediction
            if (!inventoryPrivate && result.aiPrediction) {
                const title = "### 🤖 AI Analysis";
                const score = result.aiPrediction.cumulativeScore;
                const rating = result.aiPrediction.suspicionString;

                // Recommendations
                let recText = "";
                if (result.aiPrediction.recommendation && result.aiPrediction.recommendation.length > 0) {
                    const recs = Array.isArray(result.aiPrediction.recommendation) ? result.aiPrediction.recommendation : [result.aiPrediction.recommendation];
                    recText = `\n\n**Recommended Actions:**\n${recs.map(r => `- ${r}`).join("\n")}`;
                }

                const content = `**Rating:** ${rating} (Alt Score: ${score}%)\n**Confidence:** ${result.aiPrediction.confidence}%${recText}`;

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
            if (!inventoryPrivate) {
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
            if (!inventoryPrivate) {
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
                const title = hasCheatingRecord
                    ? "### <:cheater:1454312229980864542> Cheating Record Found"
                    : "### <:cheater:1454312229980864542> Cheating Record";
                const content = cheatingRecordSummary;
                ui.addExpandableSection(selectionContainer, {
                    title,
                    content,
                    customId: ui.makeCustomId("xtracker", result.robloxId, interaction.user.id),
                    buttonLabel: hasCheatingRecord ? "Review Record" : "Expand →",
                    buttonStyle: hasCheatingRecord ? ButtonStyle.Danger : undefined
                });
            }

            // Badges
            if (!inventoryPrivate) {
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
            if (!inventoryPrivate && result.badgeGraph) {
                selectionContainer.addMediaGalleryComponents(gallery =>
                    gallery.addItems(item =>
                        item
                            .setURL(`attachment://${result.badgeGraph.filename}`)
                            .setDescription("Badge timeline")
                    )
                );
            }

            // Risk Visual
            if (!inventoryPrivate && result.riskVisual) {
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
                    ...(!inventoryPrivate && result.badgeGraph ? [{ attachment: result.badgeGraph.buffer, name: result.badgeGraph.filename }] : []),
                    ...(!inventoryPrivate && result.riskVisual ? [{ attachment: result.riskVisual.buffer, name: result.riskVisual.filename }] : [])
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
                favorites: async () => ({
                    type: "components",
                    payload: ui.buildFavoritesContainer(result, ACCENT_COLOR)
                }),
                xtracker: async () => ({
                    type: "components",
                    payload: ui.buildCheatingRecordContainer(result, ACCENT_COLOR)
                })
            };

            if (inventoryPrivate) {
                sectionHandlers.inventory = async () => ({
                    type: "components",
                    payload: ui.buildPrivateInventoryNoticeContainer("Inventory Details", ACCENT_COLOR)
                });
                sectionHandlers.gamepasses = async () => ({
                    type: "components",
                    payload: ui.buildPrivateInventoryNoticeContainer("Gamepasses Details", ACCENT_COLOR)
                });
                sectionHandlers.badges = async () => ({
                    type: "components",
                    payload: ui.buildPrivateInventoryNoticeContainer("Badge Review", ACCENT_COLOR)
                });
                sectionHandlers.ai = async () => ({
                    type: "components",
                    payload: ui.buildPrivateInventoryNoticeContainer("AI Analysis", ACCENT_COLOR)
                });
            } else {
                sectionHandlers.inventory = async () => ({
                    type: "components",
                    payload: ui.buildInventoryContainer(result, ACCENT_COLOR)
                });
                sectionHandlers.gamepasses = async () => ({
                    type: "components",
                    payload: ui.buildGamepassesContainer(result, ACCENT_COLOR)
                });
                sectionHandlers.badges = async () => ({
                    type: "components",
                    payload: await ui.buildBadgesContainer(result, ACCENT_COLOR)
                });
                sectionHandlers.ai = async () => ({
                    type: "components",
                    payload: ui.buildAIAnalysisContainer(result, ACCENT_COLOR)
                });
            }

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
