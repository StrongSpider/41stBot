const {
    normalizeDiscordMessageUrl,
    parseDiscordMessageUrl,
    fetchGuildMessageByUrl
} = require('../../bot/utils/discordMessage.js')

describe('discordMessage', () => {
    it('normalizes and parses Discord jump links', () => {
        expect(normalizeDiscordMessageUrl('<https://canary.discordapp.com/channels/10/20/30/?foo=bar#jump>'))
            .toBe('https://discord.com/channels/10/20/30')

        expect(parseDiscordMessageUrl('https://ptb.discord.com/channels/10/20/30/')).toEqual({
            url: 'https://discord.com/channels/10/20/30',
            guildId: '10',
            channelId: '20',
            messageId: '30'
        })
    })

    it('fetches a guild message directly from its jump link', async () => {
        const fetchedMessage = { id: '30' }
        const channel = {
            messages: {
                fetch: jest.fn().mockResolvedValue(fetchedMessage)
            }
        }
        const guild = {
            channels: {
                fetch: jest.fn().mockResolvedValue(channel)
            }
        }

        await expect(fetchGuildMessageByUrl(guild, 'https://discord.com/channels/10/20/30'))
            .resolves
            .toBe(fetchedMessage)

        expect(guild.channels.fetch).toHaveBeenCalledWith('20')
        expect(channel.messages.fetch).toHaveBeenCalledWith('30')
    })
})
