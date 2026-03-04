'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { randomInt } = require('node:crypto');

// 8ball answers
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
 * @returns {string}
 */
function pickAnswer() {
  return ANSWERS[randomInt(ANSWERS.length)];
}

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a yes or no question')
    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('Enter your yes or no question')
    ),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      const answer = pickAnswer();
      await interaction.reply(`🎱 ${answer}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.reply({ content: '8ball failed to respond. ' + msg, flags: MessageFlags.Ephemeral }).catch(() => { });
    }
  }
};
