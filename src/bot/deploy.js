const { REST, Routes } = require('discord.js');
const config = require('../../config.json');
const { CLIENT_ID: BOT_CLIENT_ID, GUILD_ID: BOT_GUILD_ID, TOKEN: BOT_TOKEN } = config.DISCORD.BOT;
const path = require('node:path');
const { loadCommandRegistry } = require('./commandRegistry.js')

const LoggerClass = require('../api/logger.js')
const logger = new LoggerClass('Deploy', 'BOT')

const commandsPath = path.join(__dirname, 'commands');
const commands = loadCommandRegistry(commandsPath, logger).deploymentCommands;

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(BOT_TOKEN);

// and deploy your commands!
(async () => {
    try {
        logger.info(`Started refreshing application (/) commands.`);

        const globalCommands = commands.filter(c => c.type === 4);
        const guildCommands = commands.filter(c => c.type !== 4);

        // Deploy Guild Commands
        if (guildCommands.length > 0) {
            logger.info(`Deploying ${guildCommands.length} guild commands...`);
            await rest.put(
                Routes.applicationGuildCommands(BOT_CLIENT_ID, BOT_GUILD_ID),
                { body: guildCommands },
            );
            logger.info(`Successfully reloaded guild commands.`);
        }

        // Deploy Global Commands
        if (globalCommands.length > 0) {
            logger.info(`Deploying ${globalCommands.length} global commands...`);
            await rest.put(
                Routes.applicationCommands(BOT_CLIENT_ID),
                { body: globalCommands },
            );
            logger.info(`Successfully reloaded global commands.`);
        }

    } catch (error) {
        logger.error(error);
    }
})();
