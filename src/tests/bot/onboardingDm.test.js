jest.mock('../../../config.json', () => ({
    GENERAL: {
        EMBED_COLOR: 'DarkGreen'
    }
}))

const { buildOnboardingDmPayload } = require('../../bot/utils/onboardingDm.js')

describe('buildOnboardingDmPayload', () => {
    it('builds the onboarding DM embed and verification button', () => {
        const expiresAt = Date.parse('2030-01-01T00:00:00.000Z')
        const expiresAtUnix = Math.floor(expiresAt / 1000)

        const payload = buildOnboardingDmPayload({
            AuthenticationUrl: 'https://example.com/auth?verify=test-token',
            ExpiresAt: expiresAt
        }, {
            thumbnailUrl: 'https://cdn.example.com/41st-icon.png'
        })

        expect(payload.embeds).toHaveLength(1)
        expect(payload.components).toHaveLength(1)

        const embed = payload.embeds[0].toJSON()
        expect(embed.title).toBe('Verify Your Account')
        expect(embed.description).toBe("Click the button below to link your Roblox account with 41st's database.")
        expect(embed.thumbnail).toEqual({ url: 'https://cdn.example.com/41st-icon.png' })
        expect(embed.fields).toEqual([
            { name: 'Expires', value: `<t:${expiresAtUnix}:R> (<t:${expiresAtUnix}:f>)` },
            { name: 'Need a new link?', value: 'Run `/verify start` in the server at any time.' }
        ])

        const row = payload.components[0].toJSON()
        expect(row.components).toHaveLength(1)
        expect(row.components[0]).toMatchObject({
            label: 'Verify with Roblox',
            style: 5,
            url: 'https://example.com/auth?verify=test-token'
        })
    })

    it('throws when the verification URL is missing', () => {
        expect(() => buildOnboardingDmPayload({ ExpiresAt: Date.now() + 60_000 })).toThrow(
            'AuthenticationUrl is required to build the onboarding DM.'
        )
    })
})
