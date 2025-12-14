'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const { getRankInGroup, getUsernameFromId } = require('noblox.js')

// Roblox group ids
const GROUP_MAIN_ID = 5810035
const GROUP_FUNDING_ID = 15078901

/**
 * Weight table per game. Keep ids and weights current.
 * Users not in both groups at runtime are skipped automatically.
 */
const weights = {
    ceremony: [
        { userid: 1389759088, weight: 3 }, // Triangle
     //   { userid: 118975846, weight: 6 }, // myname
        { userid: 2973649953, weight: 3 }, // Fox
        { userid: 1795742231, weight: 2 }, // broomy
        { userid: 986252567, weight: 2 }, // senja
        { userid: 674185044, weight: 4 }, // dom
        { userid: 263332709, weight: 3 }, // H3albot
        { userid: 2446167851, weight: 0.5 }, // pokl
        { userid: 448343439, weight: 2 }, // living
        { userid: 334400943, weight: 1 }, // frosty
        { userid: 151195202, weight: 1 }, // mad_jacks
        { userid: 839826187, weight: 1 } // somedude
    ]
}

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder()
        .setName('payout-calc')
        .setDescription('Calculate payout based on 41st weights')
        .addStringOption(option =>
            option.setName('game')
                .setDescription('Game to calculate payout for')
                .setRequired(true)
                .addChoices(
                    { name: 'Ceremonial Game', value: 'ceremony' }
                )
        )
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Base amount used for payout')
                .setRequired(true)
        ),
    /**
     * Execute the command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const game = interaction.options.getString('game')
            const amount = interaction.options.getInteger('amount')

            if (!weights[game]) {
                return interaction.reply({ content: 'Invalid game specified.', flags: MessageFlags.Ephemeral })
            }
            if (!Number.isInteger(amount) || amount <= 0) {
                return interaction.reply({ content: 'Amount must be a positive integer.', flags: MessageFlags.Ephemeral })
            }

            await interaction.deferReply()

            const gameWeights = weights[game]
            const eligible = []

            // Group membership checks can fail or rate-limit. Do them sequentially with try/catch.
            for (let i = 0; i < gameWeights.length; i++) {
                const user = gameWeights[i]
                try {
                    const mainRank = await getRankInGroup(GROUP_MAIN_ID, user.userid)
                    const fundRank = await getRankInGroup(GROUP_FUNDING_ID, user.userid)
                    if (mainRank > 0 && fundRank > 0) eligible.push(user)
                } catch {
                    // skip on lookup failure
                }
            }

            if (eligible.length === 0) {
                return interaction.editReply({ content: 'No users in both 41st and Funding groups were found.' })
            }

            // Sum weights and guard against division by zero
            let weightSum = 0
            for (let i = 0; i < eligible.length; i++) weightSum += Number(eligible[i].weight) || 0
            if (weightSum <= 0) {
                return interaction.editReply({ content: 'Total weight is zero. Check the weight table.' })
            }

            const splitRatio = 0.7
            const splitAmount = amount * splitRatio

            // Build the payout text. Keep heavy operations obvious with inline comments.
            let payout = ''
            payout += `## Payout for ${game} game (70/30 split)\n`
            payout += 'Only users currently in 41st and in Funding Group\n\n'
            payout += `Total Earned Amount (After Split): ${Math.round(splitAmount)}\n\n`

            for (let i = 0; i < eligible.length; i++) {
                const user = eligible[i]
                let username = '`' + String(user.userid) + '`'
                try {
                    const n = await getUsernameFromId(user.userid)
                    if (n) username = n
                } catch { }

                const share = (Number(user.weight) || 0) / weightSum
                const robux = Math.round(share * splitAmount)
                const percent = Math.round(share * 100)
                payout += `**${username}** (${user.userid}) - ${robux} Robux (${percent}%)\n`
            }

            await interaction.editReply(payout)
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to calculate payout. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}