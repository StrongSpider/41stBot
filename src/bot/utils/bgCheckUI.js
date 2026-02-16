"use strict";

const { ContainerBuilder, ButtonStyle, ComponentType, MessageFlags } = require("discord.js");
const customization = require("../../../config.json");
const roblox = require("../../api/roblox.js");

const CUSTOM_ID_PREFIX = "bgcf";
const MAX_DISCORD_TEXT = 3800;
const MAX_TOTAL = 3900;

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

function addExpandableSection(container, { title, content, customId, buttonLabel = "Expand →" }) {
    container.addSeparatorComponents(sep => sep);

    container.addSectionComponents(section =>
        section
            .addTextDisplayComponents(td => td.setContent(`${title}\n${content}`))
            .setButtonAccessory(btn =>
                btn
                    .setCustomId(customId)
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Secondary)
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

function buildXTrackerContainer(result, accentColor) {
    const xt = result?.xTracker;
    const evidence = asArray(xt?.evidence);

    if (evidence.length === 0) {
        return new ContainerBuilder()
            .setAccentColor(accentColor)
            .addTextDisplayComponents(td => td.setContent("## Cheating Records (xTracker)\nUser has no cheating records within the last year."));
    }

    const container = new ContainerBuilder().setAccentColor(accentColor);
    container.addTextDisplayComponents(td => td.setContent(`## Cheating Records (${evidence.length})`));
    container.addTextDisplayComponents(td => td.setContent("### Only evidence from the last **1 year** is displayed."));
    container.addSeparatorComponents(sep => sep);

    const sortedEvidence = [...evidence].sort((a, b) => new Date(b?.date).getTime() - new Date(a?.date).getTime());

    let textLen = 0;
    let shownCount = 0;
    let truncated = false;
    const lines = [];

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
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent(`*... and ${remaining}+ more records.*`));
    }

    return container;
}

function buildInventoryContainer(result, accentColor) {
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

    // Context / Explanation
    if (prediction.probability !== undefined) {
        container.addTextDisplayComponents(td =>
            td.setContent(`*Probability of being an alt/bot account: ${Math.round(prediction.probability * 100)}%*`)
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

    // Contributors
    if (prediction.contributors && prediction.contributors.length > 0) {
        container.addSeparatorComponents(sep => sep);
        container.addTextDisplayComponents(td => td.setContent("### 🔍 Detailed Risk Breakdown"));

        const riskMap = {
            badgeAvgTimeGap: { title: "Badge Acquisition Speed", desc: "User earns badges unusually fast, suggesting automation." },
            badgeClusterCount: { title: "Badge Clustering", desc: "Many badges earned in rapid succession." },
            suspiciousBadgePlaceCount: { title: "Suspicious Games", desc: "Detected activity in known farming games." },
            accountAge: { title: "Account Age", desc: "Account is relatively new." },
            friendCount: { title: "Social Graph", desc: "Low number of friends." },
            groupCount: { title: "Community Participation", desc: "Low group membership count." },
            inventoryCount: { title: "Asset Collection", desc: " sparse inventory often indicates a throwaway account." },
            gamePassCount: { title: "Spending History", desc: "Lack of gamepass purchases." },
            // Add other keys as needed based on featureExtractor.js
        };

        const lines = prediction.contributors.slice(0, 10).map(c => {
            const info = riskMap[c.key] || { title: c.key, desc: "Contributes to risk score." };
            const val = typeof c.rawVal === 'number' ? Math.round(c.rawVal * 100) / 100 : c.rawVal;

            // Dynamic text based on contribution sign (positive = risky, negative = safe)
            const isRisk = c.contribution > 0;
            const icon = isRisk ? "⚠️" : "✅";
            const impactText = isRisk ? "Increases Suspicion" : "Reduces Suspicion";

            return `**${icon} ${info.title}**\n> ${info.desc}\n> *Value: ${val} | ${impactText}*`;
        });

        for (const chunk of chunkText(lines.join("\n\n"), 3500)) {
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
    makeCustomId,
    parseCustomId,
    addExpandableSection,
    buildErrorContainer,
    buildJoinProfileContainer,
    buildConnectionsContainer,
    buildGroupsContainer,
    buildGamepassesContainer,
    buildFavoritesContainer,
    buildBadgesContainer,
    buildXTrackerContainer,
    buildInventoryContainer,
    buildAIAnalysisContainer
};
