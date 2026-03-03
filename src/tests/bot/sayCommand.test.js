'use strict'

const { MessageFlags } = require('discord.js')

const sayCommand = require('../../bot/commands/say.js')

describe('say command', () => {
    it('sends the message to the selected channel and confirms ephemerally', async () => {
        const send = jest.fn().mockResolvedValue(undefined)
        const reply = jest.fn().mockResolvedValue(undefined)
        const channel = {
            isTextBased: () => true,
            send,
            toString: () => '<#123>'
        }
        const interaction = {
            options: {
                getChannel: jest.fn().mockReturnValue(channel),
                getString: jest.fn().mockReturnValue('hello world')
            },
            reply,
            deferred: false,
            replied: false
        }

        await sayCommand.execute(interaction)

        expect(send).toHaveBeenCalledWith({ content: 'hello world' })
        expect(reply).toHaveBeenCalledWith({
            content: 'Sent message in <#123>.',
            flags: MessageFlags.Ephemeral
        })
    })

    it('returns an ephemeral error when the selected channel cannot receive messages', async () => {
        const reply = jest.fn().mockResolvedValue(undefined)
        const interaction = {
            options: {
                getChannel: jest.fn().mockReturnValue({ isTextBased: () => false }),
                getString: jest.fn().mockReturnValue('hello world')
            },
            reply,
            deferred: false,
            replied: false
        }

        await sayCommand.execute(interaction)

        expect(reply).toHaveBeenCalledWith({
            content: 'Failed to send message. Selected channel cannot receive messages.',
            flags: MessageFlags.Ephemeral
        })
    })
})
