'use strict'

const { SlashCommandBuilder } = require('discord.js')

/**
 * /ping command
 *
 * Quick liveness check. Replies with "Pong!" and a random quip.
 *
 * Notes
 *  - Public reply by default
 *  - Lines pass through an ASCII scrubber to avoid emojis or fancy glyphs
 *
 * @file ping.js
 */

/**
 * Remove any non-ASCII characters so we keep output plain ASCII
 * @param {string} s
 * @returns {string}
 */
function asciiOnly(s) {
	return String(s).replace(/[^ -~]/g, '')
}

/**
 * Quips shown after Pong! Keep these plain ASCII.
 */
const LINES = [
	'Ranger Platoon Leads the Way!',
	'I miss stingrayman21...',
	'CrypticIntentions is so cute!',
	'Just me thinking about how cool Ranger is...',
	'Ranger Platoon diffs everyone else ngl',
	'12/12/24 never forget',
	'9/3/25 always remember',
	'FUCK YOU <@999736048596816014>'
]

module.exports = {
	permission: 'ALL',
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Check bot responsiveness'),
	/**
	 * @param {import('discord.js').ChatInputCommandInteraction} interaction
	 */
	async execute(interaction) {
		const pick = LINES[Math.floor(Math.random() * LINES.length)]
		await interaction.reply('Pong! ' + asciiOnly(pick))
	}
}