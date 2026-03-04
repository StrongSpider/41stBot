'use strict'

const database = require('../../api/database.js')

const MAX_EVENT_TYPE_AUTOCOMPLETE_CHOICES = 25

/**
 * Normalize a focused autocomplete value for event-type matching.
 * A trailing * is ignored so prefix-pattern inputs still suggest base event names.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEventTypeAutocompleteValue(value) {
    const raw = String(value || '').trim().toLowerCase()
    return raw.endsWith('*') ? raw.slice(0, -1) : raw
}

/**
 * Build event-type autocomplete choices from the stored event type list.
 * @param {unknown} focusedValue
 * @param {{ matcher?: 'startsWith'|'includes' }} [options]
 * @returns {Promise<Array<{name:string, value:string}>>}
 */
async function getEventTypeAutocompleteChoices(focusedValue, options = {}) {
    const matcher = options.matcher === 'includes' ? 'includes' : 'startsWith'
    const term = normalizeEventTypeAutocompleteValue(focusedValue)
    const allTypes = await database.getRankedEventTypes()

    return allTypes
        .filter(type => {
            const value = String(type).toLowerCase()
            if (!term) return true
            return matcher === 'includes' ? value.includes(term) : value.startsWith(term)
        })
        .slice(0, MAX_EVENT_TYPE_AUTOCOMPLETE_CHOICES)
        .map(type => ({ name: type, value: type }))
}

/**
 * Respond to an autocomplete interaction with event-type choices.
 * @param {import('discord.js').AutocompleteInteraction} interaction
 * @param {{ matcher?: 'startsWith'|'includes' }} [options]
 */
async function respondWithEventTypeAutocomplete(interaction, options = {}) {
    try {
        const focused = interaction.options.getFocused()
        const suggestions = await getEventTypeAutocompleteChoices(focused, options)
        await interaction.respond(suggestions)
    } catch {
        await interaction.respond([]).catch(() => { })
    }
}

module.exports = {
    MAX_EVENT_TYPE_AUTOCOMPLETE_CHOICES,
    getEventTypeAutocompleteChoices,
    respondWithEventTypeAutocomplete
}
