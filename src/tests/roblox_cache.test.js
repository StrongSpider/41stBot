
// 1. Mock DB explicitly
jest.mock('../api/db', () => {
    return {
        getUserById: jest.fn(),
        getUserByUsername: jest.fn(),
        upsertUser: jest.fn(),
    }
})

// 2. Mock other dependencies
jest.mock('noblox.js')
jest.mock('../api/logger')

// 3. Import dependencies
const roblox = require('../api/roblox')
const db = require('../api/db')
const noblox = require('noblox.js')

describe('Roblox Cache', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        console.log('DB Mock State:', db)
    })

    test('getUsernameFromId: should fetch from API and save to DB on cache miss', async () => {
        // Explicitly check if mock is working
        if (typeof db.getUserById.mockResolvedValue !== 'function') {
            throw new Error(`Mock failed! db.getUserById is: ${typeof db.getUserById} (${db.getUserById})`)
        }

        db.getUserById.mockResolvedValue(null)
        noblox.getUsernameFromId.mockResolvedValue('TestUser')
        db.upsertUser.mockResolvedValue()

        const uname = await roblox.getUsernameFromId(123)

        expect(db.getUserById).toHaveBeenCalledWith(123)
        expect(noblox.getUsernameFromId).toHaveBeenCalledWith(123)
        expect(db.upsertUser).toHaveBeenCalledWith(123, 'TestUser')
        expect(uname).toBe('TestUser')
    })

    test('getUsernameFromId: should return cached value if fresh', async () => {
        db.getUserById.mockResolvedValue({
            robloxId: 123,
            username: 'CachedUser',
            updatedAt: new Date()
        })

        const uname = await roblox.getUsernameFromId(123)

        expect(db.getUserById).toHaveBeenCalledWith(123)
        expect(noblox.getUsernameFromId).not.toHaveBeenCalled()
        expect(uname).toBe('CachedUser')
    })

    test('getUsernameFromId: should refresh from API if cache expired', async () => {
        const oldDate = new Date()
        oldDate.setDate(oldDate.getDate() - 8) // 8 days old

        db.getUserById.mockResolvedValue({
            robloxId: 123,
            username: 'OldUser',
            updatedAt: oldDate
        })
        noblox.getUsernameFromId.mockResolvedValue('NewUser')

        const uname = await roblox.getUsernameFromId(123)

        expect(db.getUserById).toHaveBeenCalledWith(123)
        expect(noblox.getUsernameFromId).toHaveBeenCalledWith(123)
        expect(db.upsertUser).toHaveBeenCalledWith(123, 'NewUser')
        expect(uname).toBe('NewUser')
    })
})
