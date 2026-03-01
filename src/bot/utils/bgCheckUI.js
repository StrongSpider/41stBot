"use strict";

const { ContainerBuilder, ButtonStyle, ComponentType, MessageFlags } = require("discord.js");
const customization = require("../../../config.json");
const roblox = require("../../api/roblox.js");

const CUSTOM_ID_PREFIX = "bgcf";
const MAX_DISCORD_TEXT = 3800;
const MAX_TOTAL = 3900;
const CHEATING_RECORD_POLICY_NOTICE = "Cheating records from xTracker and Clanware are not part of the 41st Tryout Background Check and must not be used to pass or fail anyone.";

/**
 * Utility: chunkText for splitting description into chunks for text displays
 */
function chunkText(input, maxLen = 3500) {
    const text = String(input ?? "");
    if (text.length <= maxLen) return [text];

    const chunks = [];
    let i = 0;

    while (i < text.length) {
        let end = Math.min(i + maxLen, text.length);
        const nl = text.lastIndexOf("\n", end);
        if (nl > i + 200) end = nl;
        chunks.push(text.slice(i, end));
        i = end;
    }

    return chunks;
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function formatRobux(value) {
    const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
    return `<:robux:1444752443614171279> **${n.toLocaleString()}**`;
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

function addPrivateInventoryNotice(container) {
    container.addSeparatorComponents(sep => sep);
    container.addTextDisplayComponents(td =>
        td.setContent(
            "### Private Inventory\n" +
            "This user's inventory is private, so this background check only shows join date, connections, groups, favorites, and cheating records."
        )
    );

    return container;
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
        if (xTrackerCount > 0) {
            sourceBits.push(`xTracker: **${xTrackerCount}**`);
        }
        if (clanwareCount > 0) {
            sourceBits.push(`Clanware: **${clanwareCount}**`);
        }

        return `${sourceBits.join(" | ")}`;
    }

    if (unavailableSources.length > 0) {
        return `No cheating records found from available sources.\nUnavailable: ${unavailableSources.join(", ")}`;
    }

    return `No xTracker or Clanware cheating records found.`;
}

function addCheatingRecordAlert(container, result) {
    const cheatingRecord = getCheatingRecord(result);
    const xTrackerCount = Number(cheatingRecord?.sources?.xTracker?.recordCount ?? 0);
    const clanwareCount = Number(cheatingRecord?.sources?.clanware?.caseCount ?? 0);
    const sourceLines = [];

    if (xTrackerCount > 0) {
        sourceLines.push(`- **xTracker:** ${xTrackerCount} recent record${xTrackerCount === 1 ? "" : "s"}`);
    }
    if (clanwareCount > 0) {
        sourceLines.push(`- **Clanware:** ${clanwareCount} exploiter case${clanwareCount === 1 ? "" : "s"}`);
    }

    container.addSeparatorComponents(sep => sep);
    container.addTextDisplayComponents(td =>
        td.setContent(
            "## <:cheater:1454312229980864542> Cheating Record Found\n" +
            `${sourceLines.join("\n")}\n` +
            `**41st Tryout Policy:** ${CHEATING_RECORD_POLICY_NOTICE}`
        )
    );

    return container;
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

    const desc = typeof profile.description === "string" ? profile.description : "";
    container.addSeparatorComponents(sep => sep);

    if (!desc) {
        container.addTextDisplayComponents(td => td.setContent("*No description.*"));
    } else {
        container.addTextDisplayComponents(td => td.setContent("### Description"));
        for (const part of chunkText(desc, 3200)) {
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

    let out = `## Groups Details (${list.length})`;

    function tryAppend(line) {
        const next = `\n${line}`;
        if (out.length + next.length > MAX_TOTAL) return false;
        out += next;
        return true;
    }

    const primaryGroup = list.find(g => g.IsPrimary || g.isPrimary);
    if (primaryGroup) {
        const pName = primaryGroup.Name || primaryGroup.name || primaryGroup.groupName || "Unknown";
        const pId = primaryGroup.Id || primaryGroup.id || primaryGroup.groupId || "?";
        const pRole = primaryGroup.Role || primaryGroup.role || primaryGroup.roleName || "?";
        const pRank = primaryGroup.Rank || primaryGroup.rank || primaryGroup.roleRank || "?";

        tryAppend("### 👑 Primary Group");
        tryAppend(`**${pName}** (ID: ${pId})`);
        tryAppend(`Role: ${pRole} (${pRank})`);
    }

    const sorted = [...list].sort((a, b) => {
        const isBaseA = a.IsBaseRank !== undefined ? a.IsBaseRank : a.isBaseRank;
        const isBaseB = b.IsBaseRank !== undefined ? b.IsBaseRank : b.isBaseRank;
        if (isBaseA !== isBaseB) return isBaseA ? 1 : -1;
        const rankA = a.Rank || a.rank || a.roleRank || 0;
        const rankB = b.Rank || b.rank || b.roleRank || 0;
        return rankB - rankA;
    });

    const highRankGroups = sorted.filter(g => !(g.IsBaseRank !== undefined ? g.IsBaseRank : g.isBaseRank));
    const baseRankGroups = sorted.filter(g => (g.IsBaseRank !== undefined ? g.IsBaseRank : g.isBaseRank));

    let shown = 0;
    let truncated = false;

    function addGroupSection(title, groups) {
        if (groups.length === 0 || truncated) return;
        if (!tryAppend(title)) {
            truncated = true;
            return;
        }
        for (const g of groups) {
            const name = g.Name || g.name || g.groupName || "Unknown";
            const id = g.Id || g.id || g.groupId || "?";
            const role = g.Role || g.role || g.roleName || "?";
            const rank = g.Rank || g.rank || g.roleRank || "?";
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
            const safe = "\n*... more groups.*";
            if (out.length + safe.length <= MAX_TOTAL) out += safe;
        }
    }

    container.addTextDisplayComponents(td => td.setContent(out));
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
    const selfCreatedValue = gamePasses.reduce((acc, gp) => {
        const isSelf = Number(gp?.creator?.creatorId) === Number(result?.robloxId);
        const price = typeof gp?.price === "number" ? gp.price : 0;
        return acc + (isSelf ? price : 0);
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

    let textLen = statsText.length;
    let shownCount = 0;
    let truncated = false;
    const lines = [];

    for (const gp of sorted) {
        const name = gp?.name || "Unknown";
        const id = gp?.gamePassId || "?";
        const price = typeof gp?.price === "number" ? formatRobux(gp.price) : "*No Price*";
        const line = `- **[${name}](https://www.roblox.com/game-pass/${id})** — ${price}`;

        if (textLen + line.length > MAX_DISCORD_TEXT) {
            truncated = true;
            break;
        }
        lines.push(line);
        textLen += line.length;
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

    let textLen = 0;
    let shownCount = 0;
    let truncated = false;
    const lines = [];

    for (const fav of favorites) {
        const name = fav?.name || fav?.groupName || "Unknown";
        const id = fav?.id || fav?.groupId || "?";
        const url = `https://www.roblox.com/games/${id}`;
        const line = `- **[${name}](${url})** (ID: ${id})`;

        if (textLen + line.length > MAX_DISCORD_TEXT) {
            truncated = true;
            break;
        }
        lines.push(line);
        textLen += line.length;
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
    for (const b of badges) {
        const pid = b?.placeId;
        if (!pid) continue;
        placeCounts.set(pid, (placeCounts.get(pid) || 0) + 1);
    }

    const topPlaces = Array.from(placeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const idsToResolve = new Set([...topPlaces.map(p => p[0]), ...suspicious.map(s => s?.placeId)].filter(Boolean));
    let namesMap = new Map();
    try {
        namesMap = await roblox.getPlaceDetails(Array.from(idsToResolve));
    } catch {
        namesMap = new Map();
    }

    if (topPlaces.length > 0) {
        const lines = topPlaces.map(([pid, count]) => {
            const name = namesMap.get(pid) || `Place ${pid}`;
            return `- **[${name}](https://www.roblox.com/games/${pid})** — ${count} badges`;
        });
        container.addTextDisplayComponents(td => td.setContent(`### 🎮 Most Played Games\n${lines.join("\n")}`));
        container.addSeparatorComponents(sep => sep);
    }

    if (suspicious.length > 0) {
        const lines = suspicious.map(s => {
            const pid = s?.placeId;
            const name = namesMap.get(pid) || `Place ${pid}`;
            return `- **[${name}](https://www.roblox.com/games/${pid})**\n  - *Reason:* ${s?.reason ?? "Unknown"}`;
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
    container.addTextDisplayComponents(td =>
        td.setContent(
            "### 41st Tryout Policy Notice\n" +
            `${CHEATING_RECORD_POLICY_NOTICE}`
        )
    );

    if (Object.keys(sourceErrors).length > 0) {
        container.addSeparatorComponents(sep => sep);
        const errorLines = Object.entries(sourceErrors).map(([source, message]) => `- **${source}:** ${message}`);
        container.addTextDisplayComponents(td => td.setContent(`### Source Availability\n${errorLines.join("\n")}`));
    }

    if (xTrackerRecords.length > 0) {
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td =>
            td.setContent("### xTracker\nOnly evidence from the last **1 year** is displayed.")
        );

        const sortedEvidence = [...xTrackerRecords].sort((a, b) => new Date(b?.date).getTime() - new Date(a?.date).getTime());
        const lines = [];
        let textLen = 0;
        let shownCount = 0;
        let truncated = false;

        for (const ev of sortedEvidence) {
            const date = ev?.date || "Unknown date";
            const reason = ev?.reason || "No reason provided";
            const evidenceLink = ev?.url ? `\n  - [Evidence](${ev.url})` : "";
            const line = `- **${reason}**\n  - Date: ${date}${evidenceLink}`;

            if (textLen + line.length > MAX_DISCORD_TEXT) {
                truncated = true;
                break;
            }
            lines.push(line);
            textLen += line.length;
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
        container.addTextDisplayComponents(td =>
            td.setContent("### Clanware\nArchived exploiter cases are included in this source.")
        );

        const lines = [];
        let textLen = 0;
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

            if (textLen + line.length > MAX_DISCORD_TEXT) {
                truncated = true;
                break;
            }

            lines.push(line);
            textLen += line.length;
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

    const devTypes = customization.ROBLOX.ASSET_TYPES.DEVELOPMENT;
    const devLines = [];
    let devTotal = 0;
    for (const type of devTypes) {
        if (counts[type]) {
            devLines.push(`- **${type}:** ${counts[type]}`);
            devTotal += counts[type];
        }
    }

    if (devTotal > 0) {
        const devText = `### 🛠️ Development Assets (${devTotal})\n${devLines.join("\n")}`;
        container.addTextDisplayComponents(td => td.setContent(devText));
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
    let avatarTotal = 0;
    let hasAvatar = false;

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
            avatarTotal += groupTotal;
            hasAvatar = true;
        }
    }

    if (hasAvatar) {
        if (devTotal > 0) container.addSeparatorComponents(sep => sep);
        for (const chunk of chunkText(avatarText, 3500)) {
            container.addTextDisplayComponents(td => td.setContent(chunk));
        }
    }

    if (devTotal === 0 && !hasAvatar) {
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

    // Header
    container.addTextDisplayComponents(td =>
        td.setContent(`## 🤖 AI Analysis: ${prediction.suspicionString} (${prediction.cumulativeScore}%)`)
    );
    container.addSeparatorComponents(sep => sep);

    // Confidence
    container.addTextDisplayComponents(td =>
        td.setContent(`**Confidence:** ${prediction.confidence}%`)
    );

    if (prediction.summary) {
        container.addTextDisplayComponents(td =>
            td.setContent(`*${prediction.summary}*`)
        );
    }

    // Recommendations
    if (prediction.recommendation && prediction.recommendation.length > 0) {
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent("### 💡 Recommendations"));

        const recs = Array.isArray(prediction.recommendation) ? prediction.recommendation : [prediction.recommendation];
        const recText = recs.map(r => `- ${r}`).join("\n");

        for (const chunk of chunkText(recText, 3500)) {
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
            const suspicious = Array.isArray(area.suspiciousSignals) ? area.suspiciousSignals : [];
            const reassuring = Array.isArray(area.reassuringSignals) ? area.reassuringSignals : [];

            let line = `**${area.title}** - ${area.score}% (${area.direction || "neutral"})`;
            if (suspicious.length > 0) {
                line += `\n${suspicious.map(signal => `- 🚩 ${signal.explanation}`).join("\n")}`;
            }
            if (reassuring.length > 0) {
                line += `\n${reassuring.map(signal => `- ✅ ${signal.explanation}`).join("\n")}`;
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

    // Disclaimer
    container.addSeparatorComponents(sep => sep);
    container.addTextDisplayComponents(td =>
        td.setContent("*AI predictions are probabilistic and may be incorrect. Always manually verify.*")
    );

    return container;
}

module.exports = {
    chunkText,
    asArray,
    formatRobux,
    isInventoryPrivate,
    getCheatingRecord,
    makeCustomId,
    parseCustomId,
    addExpandableSection,
    addPrivateInventoryNotice,
    getCheatingRecordPreviewContent,
    addCheatingRecordAlert,
    buildErrorContainer,
    buildPrivateInventoryNoticeContainer,
    buildJoinProfileContainer,
    buildConnectionsContainer,
    buildGroupsContainer,
    buildGamepassesContainer,
    buildFavoritesContainer,
    buildBadgesContainer,
    buildCheatingRecordContainer,
    getXTrackerPreviewContent: getCheatingRecordPreviewContent,
    addXTrackerAlert: addCheatingRecordAlert,
    buildXTrackerContainer: buildCheatingRecordContainer,
    buildInventoryContainer,
    buildAIAnalysisContainer
};
