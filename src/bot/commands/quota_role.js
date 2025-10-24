const { SlashCommandBuilder } = require('@discordjs/builders')
const { CommandInteraction } = require('discord.js')

const quota = require('../../api/quota.js');

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('quota-role')
        .setDescription(`List a role's users and their quota status`)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to check quotas for')
                .setRequired(true)),
    /**
     * @param {CommandInteraction} interaction 
     */
    async execute(interaction) {
        await interaction.deferReply()

        const role = interaction.options.getRole('role');
        if (!role) {
            return interaction.editReply('No role provided.');
        }

        const members = role.members.filter(member => !member.user.bot);
        const failedReports = [];
        const passedReports = [];

        for (const member of members.values()) {
            let name = member.nickname || member.user.displayName;
            name = name.replace(/\[IN\]/g, '').replace(/\s+/g, '');

            const roles = member.roles.cache.map(r => r.id);
            if (member.permissions.has('Administrator')) {
                roles.push('admin');
            }

            const quotaData = {
                id: member.id,
                username: name,
                roles
            };

            const quotaReport = await quota.checkQuota(quotaData);

            if (quotaReport.status === 'EXEMPT') {
                continue;
            }

            if (quotaReport.status === 'NOT VERIFIED') {
                failedReports.push(quotaReport);
            }

            if (!quotaReport.met) {
                failedReports.push(quotaReport);
            } else {
                passedReports.push(quotaReport);
            }
        }

        if (failedReports.length === 0) {
            return interaction.editReply(`All members with role ${role.name} have met their quotas.`);
        }

        const chunks = [];
        let current = '# Users who failed quota\n\n';

        for (const report of failedReports) {
            let block = `**${report.username}**\n`;
            if (report.purge) {
                block += '<:warning:1297618648810393630> Purge Notice <:warning:1297618648810393630>\n';
            }

            if (report.status === 'NOT VERIFIED') {
                block += `Failed Quota due to verification\n`;
                block += '\n';

                if ((current + block).length > 1900) {
                    chunks.push(current);
                    current = '';
                }
                current += block;

                continue;
            }


            for (const q of report.quotas) {
                const rName = interaction.guild.roles.cache.get(q.roleId)?.name || 'Unknown Role';
                const symbol = q.passed ? '✅' : '❌';
                block += `${symbol} ${rName}\n`;
            }
            block += '\n';

            if ((current + block).length > 1900) {
                chunks.push(current);
                current = '';
            }
            current += block;
        }

        if (current) {
            chunks.push(current);
        }

        await interaction.editReply(chunks[0]);

        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp(chunks[i]);
        }
    }
}