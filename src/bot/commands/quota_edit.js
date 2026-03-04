const { SlashCommandBuilder, CommandInteraction, ContainerBuilder, ComponentType, TextInputStyle, TextInputBuilder, ModalBuilder, ButtonStyle, MessageFlags, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const database = require('../../api/database.js');
const customization = require('../../../config.json');

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('QuotaEdit', 'BOT')

const ITEMS_PER_PAGE = 9;

/**
 * Coerces listRoleQuotas() items into a normalized quota object.
 * Supports either an object with fields or a plain roleId string.
 * @param {any} item
 * @returns {{ roleId: string, quotaEP?: number, eventCaps?: any[], overwrites?: ("all"|string|null), exclusive?: (string|null), purges?: boolean }}
 */
function asQuota(item) {
    if (!item) return null;
    if (typeof item === 'string') return { roleId: item };
    if (typeof item === 'object' && item.roleId) return item;
    return null;
}

/**
 * Formats a value for display as a role mention when applicable.
 * @param {string|null|undefined} value
 * @param {boolean} allowAll
 */
function formatRoleLike(value, allowAll = false) {
    if (allowAll && value === 'all') return '`all`';
    if (!value) return '`none`';
    if (/^\d{17,20}$/.test(String(value))) return `<@&${value}> (${value})`;
    return `\`${String(value)}\``;
}

/**
 * Load, merge, and persist a role quota using setRoleQuota().
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} roleId
 * @param {{ quotaEP?: number, eventCaps?: any[], overwrites?: ("all"|string|null), exclusive?: (string|null), purges?: boolean }} patch
 * @returns {Promise<{ roleId: string, quotaEP: number, eventCaps: any[], overwrites: ("all"|string|null), exclusive: (string|null), purges: boolean }>}
 */
async function persistQuota(interaction, roleId, patch) {
    let current = await database.getRoleQuota(roleId);
    if (!current) current = { roleId, quotaEP: 0, eventCaps: [], overwrites: null, exclusive: null, purges: true };
    const updated = {
        roleId,
        quotaEP: patch.quotaEP !== undefined ? patch.quotaEP : (current.quotaEP ?? 0),
        eventCaps: patch.eventCaps !== undefined ? patch.eventCaps : (current.eventCaps ?? []),
        overwrites: patch.overwrites !== undefined ? patch.overwrites : (current.overwrites ?? null),
        exclusive: patch.exclusive !== undefined ? patch.exclusive : (current.exclusive ?? null),
        purges: patch.purges !== undefined ? patch.purges : (current.purges ?? true),
    };
    // Pass purges to storage if supported; extra args are harmless if ignored
    await database.setRoleQuota(roleId, updated.quotaEP, updated.eventCaps, updated.overwrites, updated.exclusive, updated.purges);
    return updated;
}

/**
 * Parses a types string into an array of strings. Accepts comma or newline separated values.
 * Preserves internal spaces.
 * @param {string} s
 */
function parseTypes(s) {
    return s
        .split(/\n|,/)
        .map(v => v.trim())
        .filter(v => v.length > 0);
}

/**
 * Fetches all quotas and returns a sorted list by roleId.
 */
async function fetchSortedQuotas() {
    const list = await database.listRoleQuotas();
    const quotas = (Array.isArray(list) ? list : [])
        .map(asQuota)
        .filter(Boolean)
        .sort((a, b) => (b.quotaEP || 0) - (a.quotaEP || 0));
    return quotas;
}

/**
 * Generates the list page for quotas.
 * @param {number} pageIdx
 */
async function generatePage(pageIdx) {
    const quotas = await fetchSortedQuotas();
    const selectionContainer = new ContainerBuilder()
        .setAccentColor(customization.GENERAL.ACCENT_COLOR)
        .addTextDisplayComponents(textDisplay => textDisplay.setContent('### Role Quotas'))
        .addSeparatorComponents(separator => separator);

    const total = quotas.length;
    const startIndex = (pageIdx - 1) * ITEMS_PER_PAGE;
    for (let idx = startIndex; idx < startIndex + ITEMS_PER_PAGE; idx++) {
        const q = quotas[idx];
        if (!q) break;

        selectionContainer.addSectionComponents(section =>
            section
                .addTextDisplayComponents(textDisplay => textDisplay.setContent(`<@&${q.roleId}> ${(q.quotaEP === 0 && q.overwrites === "all") ? "**EXEMPTION QUOTA**" : ""}`))
                .setButtonAccessory(button => {
                    return button
                        .setCustomId('config-' + q.roleId)
                        .setLabel('Edit')
                        .setStyle(ButtonStyle.Secondary);
                })
        );
    }

    selectionContainer
        .addSeparatorComponents(separator => separator)
        .addSectionComponents(section =>
            section
                .addTextDisplayComponents(textDisplay => textDisplay.setContent('**41st Elite Corps Quotas Admin Panel**'))
                .setButtonAccessory(button => {
                    return button
                        .setCustomId('create-quota')
                        .setLabel('Create new quota')
                        .setStyle(ButtonStyle.Primary);
                })
        );

    // When there are no quotas yet, show a hint
    if (total === 0) {
        selectionContainer.addSectionComponents(section =>
            section.addTextDisplayComponents(textDisplay => textDisplay.setContent('No role quotas found. Click **Create new quota** to begin.'))
        );
    }

    return selectionContainer;
}

/**
 * Generates the detailed edit view for a quota.
 * @param {{ roleId: string, quotaEP: number, eventCaps: any[], overwrites: ("all"|string|null), exclusive: (string|null), purges: boolean }} config
 */
async function generateEdit(config) {
    const selectionContainer = new ContainerBuilder()
        .setAccentColor(customization.GENERAL.ACCENT_COLOR)
        .addTextDisplayComponents(textDisplay => textDisplay.setContent(`### Configure Role Quota\n\n**Role:** <@&${config.roleId}>`))
        .addSeparatorComponents(separator => separator)
        .addSectionComponents(section =>
            section
                .addTextDisplayComponents(textDisplay => textDisplay.setContent(`**Quota EP (required):** \`${config.quotaEP ?? 0}\``))
                .setButtonAccessory(button =>
                    button
                        .setCustomId('edit-ep-' + config.roleId)
                        .setLabel('Edit EP')
                        .setStyle(ButtonStyle.Primary)
                )
        )
        .addSectionComponents(section =>
            section
                .addTextDisplayComponents(textDisplay => textDisplay.setContent(`**Overwrites:** ${formatRoleLike(config.overwrites, true)}\n\`all\`, \`ROLE_ID\`, or \`null\` for none.`))
                .setButtonAccessory(button =>
                    button
                        .setCustomId('edit-overwrites-' + config.roleId)
                        .setLabel('Edit Overwrites')
                        .setStyle(ButtonStyle.Secondary)
                )
        )
        .addSectionComponents(section =>
            section
                .addTextDisplayComponents(textDisplay => textDisplay.setContent(`**Exclusive With:** ${formatRoleLike(config.exclusive, false)}\n\`ROLE_ID\` or \`null\` for none.`))
                .setButtonAccessory(button =>
                    button
                        .setCustomId('edit-exclusive-' + config.roleId)
                        .setLabel('Edit Exclusive')
                        .setStyle(ButtonStyle.Secondary)
                )
        )
        .addSectionComponents(section =>
            section
                .addTextDisplayComponents(textDisplay => textDisplay.setContent(`**Purges Enabled:** \`${config.purges === false ? 'false' : 'true'}\``))
                .setButtonAccessory(button =>
                    button
                        .setCustomId('toggle-purges-' + config.roleId)
                        .setLabel('Toggle Purges')
                        .setStyle(ButtonStyle.Secondary)
                )
        )
        .addSeparatorComponents(separator => separator)
        .addTextDisplayComponents(textDisplay => textDisplay.setContent('### Event Caps'));

    const caps = Array.isArray(config.eventCaps) ? config.eventCaps : [];
    if (caps.length === 0) {
        selectionContainer.addSectionComponents(section =>
            section.addTextDisplayComponents(textDisplay => textDisplay.setContent('No event caps set.'))
                .setButtonAccessory(button =>
                    button
                        .setCustomId('add-cap-' + config.roleId)
                        .setLabel('Add Cap')
                        .setStyle(ButtonStyle.Primary)
                )
        );
    } else {
        caps.forEach((cap, index) => {
            selectionContainer.addSectionComponents(section =>
                section
                    .addTextDisplayComponents(textDisplay => textDisplay.setContent(`**${cap.alias ?? 'Unnamed Cap'} [${cap.count}]**\n\`\`\`\n${cap.types.join("\n")}\`\`\``))
                    .setButtonAccessory(button =>
                        button
                            .setCustomId(`edit-cap-${config.roleId}-${index}`)
                            .setLabel('Edit Cap')
                            .setStyle(ButtonStyle.Secondary)
                    )
            );
            selectionContainer.addSectionComponents(section =>
                section
                    .addTextDisplayComponents(textDisplay => textDisplay.setContent('\u200b'))
                    .setButtonAccessory(button =>
                        button
                            .setCustomId(`remove-cap-${config.roleId}-${index}`)
                            .setLabel('Remove Cap')
                            .setStyle(ButtonStyle.Danger)
                    )
            );
        });

        selectionContainer.addSeparatorComponents(separator => separator)
            .addSectionComponents(section =>
                section
                    .addTextDisplayComponents(textDisplay => textDisplay.setContent('Add a new event cap.'))
                    .setButtonAccessory(button =>
                        button
                            .setCustomId('add-cap-' + config.roleId)
                            .setLabel('Add Cap')
                            .setStyle(ButtonStyle.Primary)
                    )
            );
    }

    return selectionContainer;
}

/**
 * Generates the pagination action row.
 * @param {number} pageIdx
 */
async function generatePageActionRow(pageIdx) {
    const totalItems = (await fetchSortedQuotas()).length;
    const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
    const safePage = Math.min(Math.max(1, pageIdx), totalPages);

    const prevButton = new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId('goto-page-' + (safePage - 1)).setLabel('←');
    const nextButton = new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId('goto-page-' + (safePage + 1)).setLabel('→');
    const pageDisplay = new ButtonBuilder()
        .setLabel(`Page ${safePage}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId('page-display')
        .setDisabled(true);

    if (safePage === 1) prevButton.setDisabled(true);
    if (safePage >= totalPages) nextButton.setDisabled(true);

    return new ActionRowBuilder().addComponents(prevButton, pageDisplay, nextButton);
}

/**
 * Generates the configuration action row for the edit view.
 * @param {string} roleId
 */
function generateConfigActionRow(roleId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId('goto-page-1').setLabel('← Back'),
        new ButtonBuilder().setStyle(ButtonStyle.Danger).setCustomId('delete-quota-' + roleId).setLabel('Delete Quota')
    );
}

module.exports = {
    permission: 'HICOM',
    data: new SlashCommandBuilder()
        .setName('quota-edit')
        .setDescription('Open the role quota editor'),
    /**
     * @param {CommandInteraction} interaction
     */
    async execute(interaction) {
        const sessionId = interaction.id; // isolate modals to this run
        const initialPage = await generatePage(1);
        const initialActionRow = await generatePageActionRow(1);

        const message = await interaction.reply({ components: [initialPage, initialActionRow], flags: MessageFlags.IsComponentsV2 });
        const buttonCollector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: DISCORD_TIMEOUT });

        // Modal handler
        const modalListener = async i => {
            if (!i.isModalSubmit()) return;
            const parts = i.customId.split('-');
            if (parts[0] !== sessionId) return; // ignore other sessions

            try {
                // Create Quota Modal Submission => `${sessionId}-create-modal-roleId`
                if (parts[1] === 'create' && parts[2] === 'modal' && parts[3] === 'roleId') {
                    const roleId = i.fields.getTextInputValue('roleId');
                    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
                    if (!role) return await i.reply({ content: `Invalid Role ID: ${roleId}`, flags: MessageFlags.Ephemeral });

                    const created = await persistQuota(interaction, roleId, {});
                    await message.edit({ components: [await generateEdit(created), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                // Edit EP => `${sessionId}-edit-modal-ep-<roleId>`
                if (parts[1] === 'edit' && parts[2] === 'modal' && parts[3] === 'ep') {
                    const roleId = parts[4];
                    const raw = i.fields.getTextInputValue('quotaEP');
                    const value = Number.parseInt(raw, 10);
                    if (!Number.isFinite(value) || value < 0) return await i.reply({ content: 'quotaEP must be a non-negative integer.', flags: MessageFlags.Ephemeral });
                    const updated = await persistQuota(interaction, roleId, { quotaEP: value });
                    await message.edit({ components: [await generateEdit(updated), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                // Edit Overwrites => `${sessionId}-edit-modal-overwrites-<roleId>`
                if (parts[1] === 'edit' && parts[2] === 'modal' && parts[3] === 'overwrites') {
                    const roleId = parts[4];
                    const raw = i.fields.getTextInputValue('overwrites').trim();
                    let value = null;
                    if (raw.toLowerCase() === 'null' || raw === '') value = null;
                    else if (raw.toLowerCase() === 'all') value = 'all';
                    else {
                        const role = await interaction.guild.roles.fetch(raw).catch(() => null);
                        if (!role) return await i.reply({ content: `Invalid role ID for overwrites: ${raw}`, flags: MessageFlags.Ephemeral });
                        value = role.id;
                    }
                    const updated = await persistQuota(interaction, roleId, { overwrites: value });
                    await message.edit({ components: [await generateEdit(updated), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                // Edit Exclusive => `${sessionId}-edit-modal-exclusive-<roleId>`
                if (parts[1] === 'edit' && parts[2] === 'modal' && parts[3] === 'exclusive') {
                    const roleId = parts[4];
                    const raw = i.fields.getTextInputValue('exclusive').trim();
                    let value = null;
                    if (raw.toLowerCase() === 'null' || raw === '') value = null;
                    else {
                        const role = await interaction.guild.roles.fetch(raw).catch(() => null);
                        if (!role) return await i.reply({ content: `Invalid role ID for exclusive: ${raw}`, flags: MessageFlags.Ephemeral });
                        value = role.id;
                    }
                    const updated = await persistQuota(interaction, roleId, { exclusive: value });
                    await message.edit({ components: [await generateEdit(updated), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                // Add Cap => `${sessionId}-add-cap-modal-<roleId>`
                if (parts[1] === 'add' && parts[2] === 'cap' && parts[3] === 'modal') {
                    const roleId = parts[4];
                    const alias = i.fields.getTextInputValue('alias').trim();
                    const countRaw = i.fields.getTextInputValue('count').trim();
                    const count = Number.parseInt(countRaw, 10);
                    const typesRaw = i.fields.getTextInputValue('types');
                    const types = parseTypes(typesRaw);
                    if (!alias) return await i.reply({ content: 'Alias cannot be empty.', flags: MessageFlags.Ephemeral });
                    if (!Number.isFinite(count) || count < 1) return await i.reply({ content: 'Count must be a positive integer.', flags: MessageFlags.Ephemeral });
                    if (types.length === 0) return await i.reply({ content: 'Provide at least one event type.', flags: MessageFlags.Ephemeral });

                    const current = await database.getRoleQuota(roleId);
                    const caps = Array.isArray(current?.eventCaps) ? [...current.eventCaps] : [];
                    caps.push({ alias, count, types });
                    const updated = await persistQuota(interaction, roleId, { eventCaps: caps });
                    await message.edit({ components: [await generateEdit(updated), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                // Edit Cap => `${sessionId}-edit-cap-modal-<roleId>-<index>`
                if (parts[1] === 'edit' && parts[2] === 'cap' && parts[3] === 'modal') {
                    const roleId = parts[4];
                    const index = Number.parseInt(parts[5], 10);
                    const alias = i.fields.getTextInputValue('alias').trim();
                    const countRaw = i.fields.getTextInputValue('count').trim();
                    const count = Number.parseInt(countRaw, 10);
                    const typesRaw = i.fields.getTextInputValue('types');
                    const types = parseTypes(typesRaw);

                    if (!Number.isFinite(index) || index < 0) return await i.reply({ content: 'Invalid cap index.', flags: MessageFlags.Ephemeral });
                    if (!alias) return await i.reply({ content: 'Alias cannot be empty.', flags: MessageFlags.Ephemeral });
                    if (!Number.isFinite(count) || count < 1) return await i.reply({ content: 'Count must be a positive integer.', flags: MessageFlags.Ephemeral });
                    if (types.length === 0) return await i.reply({ content: 'Provide at least one event type.', flags: MessageFlags.Ephemeral });

                    const current = await database.getRoleQuota(roleId);
                    const caps = Array.isArray(current?.eventCaps) ? [...current.eventCaps] : [];
                    if (!caps[index]) return await i.reply({ content: 'Cap not found.', flags: MessageFlags.Ephemeral });
                    caps[index] = { alias, count, types };
                    const updated = await persistQuota(interaction, roleId, { eventCaps: caps });
                    await message.edit({ components: [await generateEdit(updated), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }
            } catch (err) {
                logger.error(err);
                try { await i.reply({ content: 'An error occurred handling the form.', flags: MessageFlags.Ephemeral }); } catch { }
            }
        };

        interaction.client.on('interactionCreate', modalListener);
        setTimeout(() => interaction.client.off('interactionCreate', modalListener), DISCORD_TIMEOUT);

        // Button interactions
        buttonCollector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: `These buttons aren't for you!`, flags: MessageFlags.Ephemeral });
            try {
                if (i.customId.startsWith('goto-page-')) {
                    const pageIdx = Number.parseInt(i.customId.split('-')[2], 10);
                    const quotasCount = (await fetchSortedQuotas()).length;
                    const totalPages = Math.max(1, Math.ceil(quotasCount / ITEMS_PER_PAGE));
                    if (!Number.isFinite(pageIdx) || pageIdx < 1 || pageIdx > totalPages) return i.reply({ content: `Invalid page index: ${pageIdx}`, flags: MessageFlags.Ephemeral });
                    const page = await generatePage(pageIdx);
                    const actionRow = await generatePageActionRow(pageIdx);
                    await message.edit({ components: [page, actionRow], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                if (i.customId === 'create-quota') {
                    const modal = new ModalBuilder()
                        .setCustomId(`${sessionId}-create-modal-roleId`)
                        .setTitle('Create Role Quota')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder().setCustomId('roleId').setLabel('Discord Role ID').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Enter the Discord Role ID')
                            )
                        );
                    return i.showModal(modal);
                }

                if (i.customId.startsWith('config-')) {
                    const roleId = i.customId.split('-')[1];
                    const current = await database.getRoleQuota(roleId);
                    const cfg = current ? { ...current, purges: (current.purges ?? true) } : { roleId, quotaEP: 0, eventCaps: [], overwrites: null, exclusive: null, purges: true };

                    await message.edit({ components: [await generateEdit(cfg), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }
                if (i.customId.startsWith('toggle-purges-')) {
                    const roleId = i.customId.split('-')[2];
                    const current = await database.getRoleQuota(roleId);
                    const currentPurges = (current && typeof current.purges === 'boolean') ? current.purges : true;
                    const updated = await persistQuota(interaction, roleId, { purges: !currentPurges });
                    await message.edit({ components: [await generateEdit(updated), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                if (i.customId.startsWith('delete-quota-')) {
                    const roleId = i.customId.split('-')[2];
                    try { await database.deleteRoleQuota(roleId); } catch { }
                    const page = await generatePage(1);
                    const actionRow = await generatePageActionRow(1);
                    await message.edit({ components: [page, actionRow], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }

                if (i.customId.startsWith('edit-ep-')) {
                    const roleId = i.customId.split('-')[2];
                    const current = await database.getRoleQuota(roleId);
                    const epVal = current?.quotaEP ?? 0;
                    const modal = new ModalBuilder()
                        .setCustomId(`${sessionId}-edit-modal-ep-${roleId}`)
                        .setTitle('Edit Quota EP')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder().setCustomId('quotaEP').setLabel('Quota EP (integer)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(epVal))
                            )
                        );
                    return i.showModal(modal);
                }

                if (i.customId.startsWith('edit-overwrites-')) {
                    const roleId = i.customId.split('-')[2];
                    const current = await database.getRoleQuota(roleId);
                    const val = current?.overwrites === null || current?.overwrites === undefined ? '' : String(current.overwrites);
                    const modal = new ModalBuilder()
                        .setCustomId(`${sessionId}-edit-modal-overwrites-${roleId}`)
                        .setTitle('Edit Overwrites')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder().setCustomId('overwrites').setLabel('Overwrites (role ID, "all", or "null")').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('all | <role_id> | null').setValue(val)
                            )
                        );
                    return i.showModal(modal);
                }

                if (i.customId.startsWith('edit-exclusive-')) {
                    const roleId = i.customId.split('-')[2];
                    const current = await database.getRoleQuota(roleId);
                    const val = current?.exclusive === null || current?.exclusive === undefined ? '' : String(current.exclusive);
                    const modal = new ModalBuilder()
                        .setCustomId(`${sessionId}-edit-modal-exclusive-${roleId}`)
                        .setTitle('Edit Exclusive With')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder().setCustomId('exclusive').setLabel('Exclusive (role ID or "null")').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('<role_id> | null').setValue(val)
                            )
                        );
                    return i.showModal(modal);
                }

                if (i.customId.startsWith('add-cap-')) {
                    const roleId = i.customId.split('-')[2];
                    const modal = new ModalBuilder()
                        .setCustomId(`${sessionId}-add-cap-modal-${roleId}`)
                        .setTitle('Add Event Cap')
                        .addComponents(
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('alias').setLabel('Alias').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. Green Combat Event')),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('count').setLabel('Required Count (integer ≥ 1)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 1')),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('types').setLabel('Types (comma or newline separated)').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Type A, Type B, ...'))
                        );
                    return i.showModal(modal);
                }

                if (i.customId.startsWith('edit-cap-')) {
                    const [_, __, roleId, indexStr] = i.customId.split('-');
                    const index = Number.parseInt(indexStr, 10);
                    const current = await database.getRoleQuota(roleId);
                    const cap = current?.eventCaps?.[index];
                    if (!cap) return i.reply({ content: 'Cap not found.', flags: MessageFlags.Ephemeral });
                    const typesText = Array.isArray(cap.types) ? cap.types.join('\n') : '';
                    const modal = new ModalBuilder()
                        .setCustomId(`${sessionId}-edit-cap-modal-${roleId}-${index}`)
                        .setTitle('Edit Event Cap')
                        .addComponents(
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('alias').setLabel('Alias').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(cap.alias ?? ''))),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('count').setLabel('Required Count (integer ≥ 1)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(cap.count ?? 1))),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('types').setLabel('Types (comma or newline separated)').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(typesText))
                        );
                    return i.showModal(modal);
                }

                if (i.customId.startsWith('remove-cap-')) {
                    const [_, __, roleId, indexStr] = i.customId.split('-');
                    const index = Number.parseInt(indexStr, 10);
                    const current = await database.getRoleQuota(roleId);
                    const caps = Array.isArray(current?.eventCaps) ? [...current.eventCaps] : [];
                    if (!Number.isFinite(index) || !caps[index]) return i.reply({ content: 'Cap not found.', flags: MessageFlags.Ephemeral });
                    caps.splice(index, 1);
                    const updated = await persistQuota(interaction, roleId, { eventCaps: caps });
                    await message.edit({ components: [await generateEdit(updated), generateConfigActionRow(roleId)], flags: MessageFlags.IsComponentsV2 });
                    return await i.deferUpdate();
                }
            } catch (err) {
                logger.error(err);
                try { await i.reply({ content: 'An error occurred handling the button.', flags: MessageFlags.Ephemeral }); } catch { }
            }
        });

        buttonCollector.on('end', () => {
            interaction.followUp({ content: 'Quotas admin session ended.', flags: MessageFlags.Ephemeral }).catch(() => { });
        });
    },
};
