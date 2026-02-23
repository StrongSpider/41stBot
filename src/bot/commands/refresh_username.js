const { SlashCommandBuilder } = require('discord.js');
const db = require('../../api/db');
const noblox = require('noblox.js');

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('RefreshUsername', 'BOT')

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('refresh-username')
        .setDescription('Force refresh a user\'s Roblox username in the cache.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to refresh (defaults to you)')
                .setRequired(false)
        ),
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        await interaction.deferReply();

        try {
            // 1. Get linked Roblox ID
            const robloxId = await db.getRobloxIdByDiscord(targetUser.id);
            if (!robloxId) {
                return interaction.editReply({
                    content: `❌ ${targetUser} is not linked to a Roblox account.`
                });
            }

            // 2. Fetch current username from Roblox
            const newUsername = await noblox.getUsernameFromId(robloxId);

            // 3. Get old cache data for comparison
            const cached = await db.getUserById(robloxId);
            const oldUsername = cached ? cached.username : 'Unknown/Uncached';

            // 4. Update cache
            await db.upsertUser(robloxId, newUsername);
            logger.info(`Manual username refresh for ${robloxId}: ${oldUsername} -> ${newUsername} (by ${interaction.user.tag})`);

            // 5. Reply
            let msg = `✅ Updated username cache for ID **${robloxId}**.\n`;
            if (oldUsername !== newUsername) {
                msg += `**Old:** ${oldUsername}\n**New:** ${newUsername}`;
            } else {
                msg += `Username is already up to date (**${newUsername}**). (Cache timestamp updated)`;
            }

            await interaction.editReply({ content: msg });

        } catch (error) {
            logger.error(`Error in /refresh-username: ${error.message}`);
            await interaction.editReply({
                content: `❌ An error occurred while refreshing the username: ${error.message}`
            });
        }
    },
};
