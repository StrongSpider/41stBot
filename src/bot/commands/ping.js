'use strict'

const { SlashCommandBuilder } = require('discord.js')

// Funny 41st lines to spice up the command. Ranger leads the way.
const LINES = [
	'Ranger Platoon Leads the Way!',
	'I miss stingrayman21...',
	'CrypticIntentions is so cute!',
	'Just me thinking about how cool Ranger is...',
	'Ranger Platoon diffs everyone else ngl',
	'12/12/24 never forget',
	'9/3/25 always remember',
	'12/22/25 forever in my heart',
	'FUCK YOU <@999736048596816014>',
]

module.exports = {
	permission: 'ALL',
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Check the bot latency'),
	/**
	 * @param {import('discord.js').ChatInputCommandInteraction} interaction
	 */
	async execute(interaction) {
		try {
			const pick = LINES[Math.floor(Math.random() * LINES.length)]
			await interaction.reply('Pong! ' + pick)
		} catch (error) {
			const Logger = require('../../api/logger')
			Logger.error('ping command error:', error)
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true })
			} else {
				await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true })
			}
		}
	}
}
