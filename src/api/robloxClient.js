'use strict'

// Only the Roblox endpoints used by this bot. Public lookups do not need a cookie.
let csrfToken = ''
let csrfCookie = ''

function userId(value) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid Roblox id')
  return id
}

async function request(url, { body, authenticated = false } = {}) {
  const cookieManager = authenticated ? require('./cookieManager') : null
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookieManager) {
      const cookie = cookieManager.getCookie()
      if (!cookie) throw new Error('Roblox cookie is not configured')
      if (cookie !== csrfCookie) {
        csrfToken = ''
        csrfCookie = cookie
      }
      headers.Cookie = cookieManager.getCookieHeader()
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    }
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    })
    if (cookieManager) {
      const setCookies = response.headers.getSetCookie?.() || response.headers.get('set-cookie')
      const updated = cookieManager.extractCookieFromSetCookieHeader(setCookies)
      if (updated) cookieManager.updateCookie(updated)
      const token = response.headers.get('x-csrf-token')
      if (response.status === 403 && token && attempt === 0) {
        csrfToken = token
        csrfCookie = cookieManager.getCookie()
        await response.arrayBuffer()
        continue
      }
    }
    if (!response.ok) {
      await response.arrayBuffer()
      throw new Error(`Roblox API request failed (HTTP ${response.status})`)
    }
    return response.json()
  }
}

async function getUsernameFromId(id) {
  const data = await request(`https://users.roblox.com/v1/users/${userId(id)}`)
  if (typeof data.name !== 'string' || !data.name.trim()) throw new Error('User not found')
  return data.name
}

async function getIdFromUsername(username) {
  const name = String(username || '').trim()
  if (!name) throw new Error('Invalid Roblox username')
  const result = await request('https://users.roblox.com/v1/usernames/users', {
    body: { usernames: [name], excludeBannedUsers: false }
  })
  const user = result.data?.[0]
  if (!user) throw new Error('User not found')
  return userId(user.id)
}

async function getRankInGroup(groupId, id) {
  const group = userId(groupId)
  const result = await request(`https://groups.roblox.com/v2/users/${userId(id)}/groups/roles`)
  if (!Array.isArray(result.data)) throw new Error('Invalid Roblox group response')
  return result.data.find(entry => entry.group?.id === group)?.role?.rank ?? 0
}

async function getHeadshotUrl(id) {
  const result = await request(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId(id)}&size=420x420&format=Png&isCircular=false`)
  if (!Array.isArray(result.data)) throw new Error('Invalid Roblox thumbnail response')
  return result.data[0]?.imageUrl || undefined
}

async function getPresences(ids) {
  const userIds = ids.map(userId)
  const userPresences = []
  // Roblox accepts at most 100 users per presence request.
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const result = await request('https://presence.roblox.com/v1/presence/users', {
      body: { userIds: userIds.slice(offset, offset + 100) }, authenticated: true
    })
    if (!Array.isArray(result.userPresences)) throw new Error('Invalid Roblox presence response')
    userPresences.push(...result.userPresences)
  }
  return { userPresences }
}

module.exports = { getUsernameFromId, getIdFromUsername, getRankInGroup, getHeadshotUrl, getPresences }
