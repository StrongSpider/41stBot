'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { randomInt } = require('node:crypto');

/**
 * Magic 8-ball command
 *
 * Picks a pseudorandom answer from a fixed set and replies to the user.
 * The "question" option is required, so the bot can echo it back.
 *
 * Expected export shape:
 * - permission: string permission tag consumed by your command loader
 * - data: Slash command definition for registration
 * - execute: handler for ChatInputCommandInteraction
 *
 * @file 8ball.js
 */

const ANSWERS = Object.freeze([
  "It is decidedly so",
  "Without a doubt",
  "Yes definitely",
  "Yes",
  "Signs point to yes",
  "Reply hazy, try again",
  "Ask again later",
  "Better not tell you now",
  "Don't count on it",
  "My reply is no",
  "My sources say no",
  "Outlook not so good",
  "Very doubtful"
]);

/**
 * Choose a random answer from ANSWERS.
 * Uses crypto.randomInt for even distribution.
 * @returns {string}
 */
function pickAnswer() {
  return ANSWERS[randomInt(ANSWERS.length)];
}

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the 8ball a yes or no question')
    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('The yes or no question to ask')
    ),
  /**
   * Execute the command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      const answer = pickAnswer();
      await interaction.reply(`🎱 ${answer}`);
    } catch (err) {
      // Fallback reply if something goes wrong
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.reply({ content: '8ball failed to respond. ' + msg, flags: MessageFlags.Ephemeral }).catch(() => { });
    }
  }
};