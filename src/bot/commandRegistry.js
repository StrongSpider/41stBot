'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Collection, ApplicationCommandType, ApplicationCommandOptionType } = require('discord.js')

const GROUPED_COMMANDS = {
  companies: {
    description: 'Company commands',
    routes: {
      'companies-get': { subcommand: 'get' }
    }
  },
  distribute: {
    description: 'Distribution commands',
    groups: {
      weekly: {
        description: 'Weekly distribution commands'
      }
    },
    routes: {
      'distribute-weekly-medals': { group: 'weekly', subcommand: 'medals' }
    }
  },
  event: {
    description: 'Event logging and lookup commands',
    groups: {
      id: {
        description: 'Event id commands'
      },
      type: {
        description: 'Manage event types'
      }
    },
    routes: {
      'event-get': { subcommand: 'get' },
      'event-log': { subcommand: 'log' },
      'event-delete': { subcommand: 'delete' },
      'event-edit': { subcommand: 'edit' },
      'event-count': { subcommand: 'count' },
      'event-top': { subcommand: 'top' },
      'event-list': { subcommand: 'list' },
      'event-type-add': { group: 'type', subcommand: 'add' },
      'event-type-list': { group: 'type', subcommand: 'list' },
      'event-type-remove': { group: 'type', subcommand: 'remove' }
    }
  },
  ep: {
    description: 'Event point commands',
    routes: {
      'ep-get': { subcommand: 'get' },
      'ep-edit': { subcommand: 'edit' },
      'ep-top': { subcommand: 'top' }
    }
  },
  inactivity: {
    description: 'Inactivity notice commands',
    routes: {
      'inactivity-add': { subcommand: 'add' },
      'inactivity-edit': { subcommand: 'edit' },
      'inactivity-get': { subcommand: 'get' },
      'inactivity-list': { subcommand: 'list' },
      'inactivity-remove': { subcommand: 'remove' }
    }
  },
  payout: {
    description: 'Payout commands',
    routes: {
      'payout-calc': { subcommand: 'calc' }
    }
  },
  quota: {
    description: 'Quota commands',
    routes: {
      'quota-get': { subcommand: 'get' },
      'quota-edit': { subcommand: 'edit' },
      'quota-role': { subcommand: 'role' }
    }
  },
  refresh: {
    description: 'Refresh commands',
    routes: {
      'refresh-username': { subcommand: 'username' }
    }
  },
  reviewer: {
    description: 'Minor Officer reviewer commands',
    routes: {
      reviewer_top: { subcommand: 'top' },
      reviewer_list: { subcommand: 'list' }
    }
  },
  tracker: {
    description: 'Tracker management commands',
    routes: {
      'tracker-lock': { subcommand: 'lock' },
      'tracker-reset': { subcommand: 'reset' }
    }
  },
  unverified: {
    description: 'Unverified-user commands',
    routes: {
      'unverified-list': { subcommand: 'list' }
    }
  },
  unverify: {
    description: 'Unverify commands',
    routes: {
      'unverify-force': { subcommand: 'force' }
    }
  },
  verify: {
    description: 'Verification commands',
    routes: {
      verify: { subcommand: 'start' },
      'verify-force': { subcommand: 'force' }
    }
  }
}

function normalizeCommandName(name) {
  return typeof name === 'string' ? name.replace(/-/g, '') : name
}

function getCommandDataJson(mod) {
  if (!mod || !mod.data) return null
  if (typeof mod.data.toJSON === 'function') return mod.data.toJSON()
  return mod.data
}

function isChatInputCommandJson(json) {
  return Boolean(json) && (json.type == null || json.type === ApplicationCommandType.ChatInput)
}

function makeRouteKey(groupName, subcommandName) {
  const normalizedGroupName = normalizeCommandName(groupName)
  const normalizedSubcommandName = normalizeCommandName(subcommandName)
  return normalizedGroupName
    ? `${normalizedGroupName}/${normalizedSubcommandName}`
    : String(normalizedSubcommandName || '')
}

function getInteractionRouteKey(interaction) {
  const options = interaction?.options

  let groupName = null
  let subcommandName = null

  try {
    if (typeof options?.getSubcommandGroup === 'function') {
      groupName = options.getSubcommandGroup(false)
    }
  } catch { }

  try {
    if (typeof options?.getSubcommand === 'function') {
      subcommandName = options.getSubcommand(false)
    }
  } catch { }

  if (!subcommandName) return null
  return makeRouteKey(groupName, subcommandName)
}

function cloneCommandJsonWithName(sourceJson, nextName) {
  return {
    ...sourceJson,
    name: nextName
  }
}

function cloneSubcommandJson(sourceJson, subcommandName) {
  const subcommandJson = {
    type: ApplicationCommandOptionType.Subcommand,
    name: normalizeCommandName(subcommandName),
    description: sourceJson.description
  }

  if (sourceJson.name_localizations) subcommandJson.name_localizations = sourceJson.name_localizations
  if (sourceJson.description_localizations) subcommandJson.description_localizations = sourceJson.description_localizations
  if (Array.isArray(sourceJson.options) && sourceJson.options.length > 0) {
    subcommandJson.options = sourceJson.options
  }

  return subcommandJson
}

function createGroupedCommandJson(groupName, groupConfig, members) {
  const topLevelOptions = []
  const subcommandGroups = new Map()

  for (const { route, json } of members) {
    const subcommandJson = cloneSubcommandJson(json, route.subcommand)

    if (!route.group) {
      topLevelOptions.push(subcommandJson)
      continue
    }

    const existing = subcommandGroups.get(route.group) || {
      type: ApplicationCommandOptionType.SubcommandGroup,
      name: normalizeCommandName(route.group),
      description: groupConfig.groups?.[route.group]?.description || `${route.group} commands`,
      options: []
    }
    existing.options.push(subcommandJson)
    subcommandGroups.set(route.group, existing)
  }

  for (const groupJson of subcommandGroups.values()) {
    topLevelOptions.push(groupJson)
  }

  return {
    type: ApplicationCommandType.ChatInput,
    name: normalizeCommandName(groupName),
    description: groupConfig.description,
    options: topLevelOptions
  }
}

function createGroupedCommandEntry(json, routeMap) {
  return {
    data: {
      name: json.name,
      toJSON() {
        return json
      }
    },
    resolve(interaction) {
      const routeKey = getInteractionRouteKey(interaction)
      if (!routeKey) return null
      return routeMap.get(routeKey) || null
    }
  }
}

function loadCommandRegistry(commandsDir, logger) {
  const commands = new Collection()
  const deploymentCommands = []
  const modulesByName = new Map()

  const files = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'))
  for (const file of files) {
    const filePath = path.join(commandsDir, file)

    try {
      const mod = require(filePath)
      const json = getCommandDataJson(mod)
      const name = json?.name || mod?.data?.name

      if (!json || typeof name !== 'string' || typeof mod?.execute !== 'function') {
        logger.warn(`Command file missing data or execute: ${filePath}`)
        continue
      }

      modulesByName.set(name, { filePath, mod, json })
    } catch (error) {
      const msg = error && error.message ? error.message : String(error)
      logger.error(`Failed to load command ${filePath} - ${msg}`)
    }
  }

  const groupedCommandNames = new Set()
  for (const [groupName, groupConfig] of Object.entries(GROUPED_COMMANDS)) {
    const members = []
    const routeMap = new Map()

    for (const [commandName, route] of Object.entries(groupConfig.routes)) {
      groupedCommandNames.add(commandName)

      const entry = modulesByName.get(commandName)
      if (!entry) {
        logger.warn(`Grouped command source not found for ${commandName}`)
        continue
      }

      if (!isChatInputCommandJson(entry.json)) {
        logger.warn(`Grouped command source is not a slash command: ${entry.filePath}`)
        continue
      }

      members.push({ route, json: entry.json })
      routeMap.set(makeRouteKey(route.group, route.subcommand), entry.mod)
    }

    if (members.length === 0) continue

    const json = createGroupedCommandJson(groupName, groupConfig, members)
    commands.set(normalizeCommandName(groupName), createGroupedCommandEntry(json, routeMap))
    deploymentCommands.push(json)
  }

  for (const [name, entry] of modulesByName.entries()) {
    if (groupedCommandNames.has(name)) continue
    const normalizedName = normalizeCommandName(name)
    commands.set(normalizedName, entry.mod)
    deploymentCommands.push(cloneCommandJsonWithName(entry.json, normalizedName))
  }

  return {
    commands,
    deploymentCommands
  }
}

function resolveCommand(commands, interaction) {
  const entry = commands && typeof commands.get === 'function'
    ? commands.get(interaction.commandName)
    : null

  if (!entry) return null
  if (typeof entry.resolve === 'function') return entry.resolve(interaction)
  return entry
}

module.exports = {
  loadCommandRegistry,
  normalizeCommandName,
  resolveCommand
}
