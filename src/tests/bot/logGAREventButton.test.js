const { Collection, ComponentType, MessageFlags } = require('discord.js')

jest.mock('../../../config.json', () => ({
    DISCORD: {
        ROLES: {
            OFFICER: 'officer-role'
        }
    }
}))

jest.mock('../../api/database', () => ({
    getEventEpLock: jest.fn(),
    getEventTypes: jest.fn(),
    getRobloxIdByDiscord: jest.fn(),
    assertEventEpWriteUnlocked: jest.fn(),
    incrementCurrentEventPoints: jest.fn(),
    createWeeklyEvent: jest.fn(),
    isEventEpLockError: jest.fn().mockReturnValue(false)
}))

jest.mock('../../api/webhook.js', () => ({
    sendEventCreateWebhook: jest.fn()
}))

const database = require('../../api/database')
const { sendEventCreateWebhook } = require('../../api/webhook.js')
const logGAREventButton = require('../../bot/events/interactionCreate/logGAREventButton.js')

function buttonInteraction() {
    return {
        customId: 'log_gar_event',
        user: { id: '100000000000000001' },
        isButton: () => true,
        isModalSubmit: () => false,
        showModal: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        deferred: false,
        replied: false
    }
}

function modalInteraction({ proofContentType = 'image/png', proofName = 'proof.png' } = {}) {
    const logger = { id: '100000000000000001' }
    const attendee = { id: '100000000000000002' }
    const proof = {
        id: 'attachment-1',
        contentType: proofContentType,
        name: proofName,
        url: 'https://cdn.discordapp.com/attachments/proof.png'
    }
    const targetChannel = {
        send: jest.fn().mockResolvedValue({ url: 'https://discord.com/channels/guild/channel/message' })
    }

    return {
        interaction: {
            customId: 'log_gar_event_modal',
            user: logger,
            isButton: () => false,
            isModalSubmit: () => true,
            fields: {
                getStringSelectValues: jest.fn().mockReturnValue(['GAR Patrol']),
                getTextInputValue: jest.fn(customId => (
                    customId === 'gar_event_host' ? 'Captain Rex' : 'Joint patrol with another unit'
                )),
                getSelectedUsers: jest.fn().mockReturnValue(new Collection([[attendee.id, attendee]])),
                getUploadedFiles: jest.fn().mockReturnValue(new Collection([[proof.id, proof]]))
            },
            channel: targetChannel,
            guild: {
                members: { cache: new Collection() }
            },
            deferReply: jest.fn(function () {
                this.deferred = true
                return Promise.resolve()
            }),
            editReply: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue(undefined),
            deferred: false,
            replied: false
        },
        targetChannel
    }
}

describe('interactionCreate/logGAREventButton', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        database.getEventEpLock.mockResolvedValue({ enabled: false })
        database.getEventTypes.mockResolvedValue(['Training', 'GAR Patrol', 'GAR Faces'])
        database.getRobloxIdByDiscord.mockImplementation(async discordId => ({
            '100000000000000001': 101,
            '100000000000000002': 102
        })[discordId] || null)
        database.assertEventEpWriteUnlocked.mockResolvedValue(undefined)
        database.incrementCurrentEventPoints.mockResolvedValue(undefined)
        database.createWeeklyEvent.mockResolvedValue('event-id')
        sendEventCreateWebhook.mockResolvedValue(undefined)
    })

    it('opens one modal containing the complete GAR event form', async () => {
        const interaction = buttonInteraction()

        await logGAREventButton(interaction)

        expect(interaction.showModal).toHaveBeenCalledTimes(1)
        const modal = interaction.showModal.mock.calls[0][0].toJSON()
        expect(modal.custom_id).toBe('log_gar_event_modal')
        expect(modal.components).toHaveLength(5)
        expect(modal.components.map(label => label.component.type)).toEqual([
            ComponentType.StringSelect,
            ComponentType.TextInput,
            ComponentType.UserSelect,
            ComponentType.TextInput,
            ComponentType.FileUpload
        ])
        expect(modal.components[0].component.options.map(option => option.value)).toEqual([
            'GAR Patrol',
            'GAR Faces'
        ])
        expect(modal.components[1].component.custom_id).toBe('gar_event_host')
        expect(modal.components[1].component.required).toBe(true)
        expect(modal.components[3].component.custom_id).toBe('gar_event_note')
        expect(modal.components[3].component.required).toBe(false)
    })

    it('submits the event for approval without awarding EP', async () => {
        const { interaction, targetChannel } = modalInteraction()

        await logGAREventButton(interaction)

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral })
        expect(targetChannel.send).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Event: Patrol'),
            components: [expect.anything()],
            files: [expect.objectContaining({
                attachment: 'https://cdn.discordapp.com/attachments/proof.png',
                name: 'proof.png'
            })]
        }))
        expect(targetChannel.send.mock.calls[0][0].content).toContain('Host: Captain Rex')
        expect(targetChannel.send.mock.calls[0][0].content).not.toContain('Event: GAR Patrol')
        expect(targetChannel.send.mock.calls[0][0].content).toContain('Note: Joint patrol with another unit')
        expect(targetChannel.send.mock.calls[0][0].content).not.toContain('Host: <@100000000000000001>')
        expect(targetChannel.send.mock.calls[0][0].content).toContain('<@100000000000000001>')
        expect(targetChannel.send.mock.calls[0][0].content).toContain('<@100000000000000002>')
        const approvalRow = targetChannel.send.mock.calls[0][0].components[0].toJSON()
        expect(approvalRow.components.map(component => component.custom_id)).toEqual([
            'confirm_minor',
            'deny_minor'
        ])
        expect(database.incrementCurrentEventPoints).not.toHaveBeenCalled()
        expect(database.createWeeklyEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: 'GAR Patrol',
            host: 101,
            supervisor: -1,
            attendees: expect.arrayContaining([101, 102]),
            message: 'https://discord.com/channels/guild/channel/message'
        }))
        expect(sendEventCreateWebhook).toHaveBeenCalledWith(expect.objectContaining({
            eventId: 'event-id',
            type: 'GAR Patrol',
            host: 101
        }))
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: 'GAR event submitted for approval! Event ID:\n```event-id```'
        })
    })

    it('rejects a non-image proof before publishing or awarding EP', async () => {
        const { interaction, targetChannel } = modalInteraction({
            proofContentType: 'text/plain',
            proofName: 'proof.txt'
        })

        await logGAREventButton(interaction)

        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '<:warning:1297618648810393630> `Screenshot proof must be an image.`'
        })
        expect(targetChannel.send).not.toHaveBeenCalled()
        expect(database.incrementCurrentEventPoints).not.toHaveBeenCalled()
        expect(database.createWeeklyEvent).not.toHaveBeenCalled()
    })

    it('does not open the modal while event EP writes are locked', async () => {
        database.getEventEpLock.mockResolvedValue({ enabled: true, reason: 'Maintenance' })
        const interaction = buttonInteraction()

        await logGAREventButton(interaction)

        expect(interaction.showModal).not.toHaveBeenCalled()
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            flags: MessageFlags.Ephemeral
        }))
    })
})
