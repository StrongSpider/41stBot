'use strict'

jest.mock('../api/cookieManager', () => ({
  getCookie: jest.fn(() => 'test-cookie'),
  getCookieHeader: jest.fn(() => '.ROBLOSECURITY=test-cookie'),
  extractCookieFromSetCookieHeader: jest.fn(),
  updateCookie: jest.fn()
}))

const originalFetch = global.fetch
let client
const cookies = require('../api/cookieManager')
const response = (data, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => data,
  arrayBuffer: jest.fn(async () => new ArrayBuffer(0))
})

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn()
  // Reset the client's CSRF cache between tests.
  jest.isolateModules(() => { client = require('../api/robloxClient') })
})
afterAll(() => { global.fetch = originalFetch })

test('looks up usernames and IDs without sending credentials', async () => {
  fetch.mockResolvedValueOnce(response({ name: 'Builderman' }))
    .mockResolvedValueOnce(response({ data: [{ id: 156 }] }))
  await expect(client.getUsernameFromId('156')).resolves.toBe('Builderman')
  await expect(client.getIdFromUsername(' Builderman ')).resolves.toBe(156)
  expect(fetch.mock.calls[0][0]).toBe('https://users.roblox.com/v1/users/156')
  expect(fetch.mock.calls[0][1].headers.Cookie).toBeUndefined()
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ usernames: ['Builderman'], excludeBannedUsers: false })
})

test('returns group rank, zero for nonmembers, and the headshot URL', async () => {
  fetch.mockResolvedValueOnce(response({ data: [{ group: { id: 42 }, role: { rank: 100 } }] }))
    .mockResolvedValueOnce(response({ data: [] }))
    .mockResolvedValueOnce(response({ data: [{ imageUrl: 'https://example.com/headshot.png' }] }))
  await expect(client.getRankInGroup(42, 156)).resolves.toBe(100)
  await expect(client.getRankInGroup(42, 156)).resolves.toBe(0)
  await expect(client.getHeadshotUrl(156)).resolves.toBe('https://example.com/headshot.png')
})

test('batches presence requests and retries a CSRF challenge with the current cookie', async () => {
  fetch.mockResolvedValueOnce(response({}, 403, { 'x-csrf-token': 'token' }))
    .mockResolvedValueOnce(response({ userPresences: [{ userId: 1, placeId: 42 }] }))
    .mockResolvedValueOnce(response({ userPresences: [{ userId: 101 }] }))
  await expect(client.getPresences(Array.from({ length: 101 }, (_, i) => i + 1)))
    .resolves.toEqual({ userPresences: [{ userId: 1, placeId: 42 }, { userId: 101 }] })
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(fetch.mock.calls[1][1].headers).toMatchObject({ Cookie: '.ROBLOSECURITY=test-cookie', 'X-CSRF-Token': 'token' })
  expect(JSON.parse(fetch.mock.calls[1][1].body).userIds).toHaveLength(100)
  expect(JSON.parse(fetch.mock.calls[2][1].body).userIds).toEqual([101])
})

test('persists rotated cookies and reads credentials again for the next request', async () => {
  cookies.extractCookieFromSetCookieHeader.mockReturnValueOnce('rotated-cookie')
  fetch.mockResolvedValue(response({ userPresences: [] }, 200, { 'set-cookie': '.ROBLOSECURITY=rotated-cookie; Path=/' }))
  await client.getPresences([1])
  expect(cookies.updateCookie).toHaveBeenCalledWith('rotated-cookie')
  cookies.getCookie.mockReturnValueOnce('rotated-cookie')
  cookies.getCookieHeader.mockReturnValueOnce('.ROBLOSECURITY=rotated-cookie')
  await client.getPresences([1])
  expect(fetch.mock.calls[1][1].headers.Cookie).toBe('.ROBLOSECURITY=rotated-cookie')
})

test('rejects invalid IDs, missing users and HTTP failures', async () => {
  await expect(client.getUsernameFromId('invalid')).rejects.toThrow('Invalid Roblox id')
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockResolvedValueOnce(response({ data: [] }))
    .mockResolvedValueOnce(response({}, 429))
    .mockResolvedValueOnce(response({}, 403, { 'x-csrf-token': 'one' }))
    .mockResolvedValueOnce(response({}, 403, { 'x-csrf-token': 'two' }))
  await expect(client.getIdFromUsername('missing')).rejects.toThrow('User not found')
  await expect(client.getUsernameFromId(1)).rejects.toThrow('HTTP 429')
  await expect(client.getPresences([1])).rejects.toThrow('HTTP 403')
  expect(fetch).toHaveBeenCalledTimes(4)
})
