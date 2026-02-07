const { REST, Routes } = require('discord.js');
const config = require('../../config.json');
const { CLIENT_ID: BOT_CLIENT_ID, GUILD_ID: BOT_GUILD_ID, TOKEN: BOT_TOKEN } = config.DISCORD.BOT;
const fs = require('node:fs');
const path = require('node:path');
const Logger = require('../api/logger.js');

const commands = [];

// Grab all the command folders from the commands directory you created earlier
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    } else {
        Logger.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(BOT_TOKEN);

// and deploy your commands!
(async () => {
    try {
        Logger.info(`Started refreshing application (/) commands.`);

        const globalCommands = commands.filter(c => c.type === 4);
        const guildCommands = commands.filter(c => c.type !== 4);

        // Deploy Guild Commands
        if (guildCommands.length > 0) {
            Logger.info(`Deploying ${guildCommands.length} guild commands...`);
            await rest.put(
                Routes.applicationGuildCommands(BOT_CLIENT_ID, BOT_GUILD_ID),
                { body: guildCommands },
            );
            Logger.info(`Successfully reloaded guild commands.`);
        }

        // Deploy Global Commands
        if (globalCommands.length > 0) {
            Logger.info(`Deploying ${globalCommands.length} global commands...`);
            await rest.put(
                Routes.applicationCommands(BOT_CLIENT_ID),
                { body: globalCommands },
            );
            Logger.info(`Successfully reloaded global commands.`);
        }

    } catch (error) {
        Logger.error(error);
    }
})();