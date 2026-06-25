const { TelegramClient } = require('telegram')
const { StringSession } = require('telegram/sessions')
const { NewMessage } = require('telegram/events')
const input = require('input')
const https = require('https')
const http = require('http')
const fs = require('fs')

const API_ID = 2040
const API_HASH = 'b18441a1ff607e10a989891a5462e627'
const YOUR_PHONE = '+79248287898'
const BOT_TOKEN_CHAT_ID = 8651432575
const BOT_TOKEN = '8664720856:AAHJ-Bo7COT-Zalw0ZElQiIJJ356H_wY'
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mpyphadcrdvmxnjyhorg.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1weXBoYWRjcmR2bXhuanlob3JnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjAyODM5MywiZXhwIjoyMDk3NjA0MzkzfQ.iExYvEpqVj9HeiNdrk8GfeaWRxw3wczYrdcXgJvFY9o'
const TG_USER_ID = 8651432575
const SESSION_FILE = './session.txt'

function loadSession() {
  if (process.env.SESSION_STRING) return process.env.SESSION_STRING
  if (fs.existsSync(SESSION_FILE)) return fs.readFileSync(SESSION_FILE, 'utf8').trim()
  return ''
}

async function supaFetch(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
  })
  return r.json()
}

function sendNotification(text) {
  const body = JSON.stringify({ chat_id: BOT_TOKEN_CHAT_ID, text, parse_mode: 'HTML' })
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  })
  req.on('error', () => {})
  req.write(body)
  req.end()
}

async function createLead(ownerID, displayName, telegramUsername, equipmentDescription) {
  const body = JSON.stringify({
    owner_id: ownerID,
    display_name: displayName.slice(0, 120),
    telegram_username: telegramUsername || null,
    equipment_description: equipmentDescription?.slice(0, 500) || null,
    status: 'new',
    external_profile: 'auto-monitor',
  })
  const r = await fetch(`${SUPA_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    },
    body,
  })
  const data = await r.json()
  return data[0] ?? null
}

async function getOwnerAndSettings() {
  const profiles = await supaFetch(`profiles?select=id&telegram_user_id=eq.${TG_USER_ID}&limit=1`)
  const ownerID = profiles[0]?.id
  if (!ownerID) return null
  const [sourcesData, modelsData] = await Promise.all([
    supaFetch(`sources?select=url&owner_id=eq.${ownerID}&source_type=eq.telegram_channel&monitor_enabled=eq.true`),
    supaFetch(`equipment_models?select=model_name&owner_id=eq.${ownerID}&active=eq.true`),
  ])
  const groups = Array.isArray(sourcesData)
    ? sourcesData.map(s => s.url.replace('https://t.me/', '').replace('https://telegram.me/', '')).filter(Boolean)
    : []
  const models = Array.isArray(modelsData) ? modelsData.map(m => m.model_name.toLowerCase()) : []
  return { ownerID, groups, models }
}

function startHttpServer(getClient) {
  const PORT = process.env.PORT || 3001
  const SECRET = process.env.PREVIEW_SECRET || 'zemobmen-preview'
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200)
      return res.end(JSON.stringify({ ok: true }))
    }
    const auth = req.headers['authorization']
    if (auth !== `Bearer ${SECRET}`) {
      res.writeHead(401)
      return res.end(JSON.stringify({ error: 'Unauthorized' }))
    }
    const match = req.url.match(/^\/messages\/([A-Za-z0-9_]+)(\?.*)?$/)
    if (req.method === 'GET' && match) {
      const client = getClient()
      if (!client) {
        res.writeHead(503)
        return res.end(JSON.stringify({ error: 'Client not ready' }))
      }
      const username = match[1]
      const limitMatch = (req.url || '').match(/limit=(\d+)/)
      const limit = Math.min(parseInt(limitMatch?.[1] || '15', 10), 30)
      try {
        const msgs = await client.getMessages(username, { limit })
        const result = msgs.map(m => ({
          id: m.id, text: m.message || '', date: m.date, views: m.views || null,
          has_photo: !!(m.media && m.media.className === 'MessageMediaPhoto'),
          has_video: !!(m.media && (m.media.className === 'MessageMediaDocument' || m.media.className === 'MessageMediaVideo')),
          url: `https://t.me/${username}/${m.id}`,
        }))
        res.writeHead(200)
        return res.end(JSON.stringify({ messages: result }))
      } catch (e) {
        res.writeHead(500)
        return res.end(JSON.stringify({ error: e.message }))
      }
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  })
  server.listen(PORT, () => console.log(`HTTP server on port ${PORT}`))
}

async function connectTelegram(sessionString) {
  for (let attempt = 1; ; attempt++) {
    const client = new TelegramClient(
      new StringSession(sessionString), API_ID, API_HASH, { connectionRetries: 1 }
    )
    try {
      const started = client.start({
        phoneNumber: async () => YOUR_PHONE,
        password: async () => await input.text('2FA: '),
        phoneCode: async () => await input.text('Code: '),
        onError: (err) => console.log('TG error:', err.message),
      })
      const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 40000))
      await Promise.race([started, timer])
      console.log(`Telegram connected on attempt ${attempt}`)
      return client
    } catch (err) {
      const delay = Math.min(20000 * attempt, 120000)
      console.error(`Attempt ${attempt} failed: ${err.message}. Retry in ${delay / 1000}s`)
      try { await client.destroy() } catch (_) {}
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

async function main() {
  const sessionString = loadSession()
  const clientRef = { value: null }
  startHttpServer(() => clientRef.value)

  const client = await connectTelegram(sessionString)
  try { fs.writeFileSync(SESSION_FILE, client.session.save()) } catch (_) {}
  clientRef.value = client

  let settings = await getOwnerAndSettings()
  console.log(`Monitoring: groups=${settings?.groups?.length ?? 0}, models=${settings?.models?.length ?? 0}`)
  sendNotification(`Мониторинг запущен. Групп: ${settings?.groups?.length ?? 0}, Моделей: ${settings?.models?.length ?? 0}`)

  setInterval(async () => { settings = await getOwnerAndSettings() }, 5 * 60 * 1000)

  client.addEventHandler(async (event) => {
    const message = event.message
    if (!message?.text) return
    const text = message.text
    const lower = text.toLowerCase()
    const models = settings?.models ?? []
    if (models.length === 0 || !models.some(m => lower.includes(m))) return
    try {
      const sender = await message.getSender()
      const chat = await message.getChat()
      const username = sender?.username ? `@${sender.username}` : sender?.firstName ?? 'unknown'
      const chatTitle = chat?.title ?? 'group'
      let leadId = null
      if (settings?.ownerID) {
        const lead = await createLead(
          settings.ownerID,
          sender?.username ?? sender?.firstName ?? 'unknown',
          sender?.username ? `@${sender.username}` : null,
          text.slice(0, 500)
        )
        leadId = lead?.id?.slice(0, 8)
      }
      sendNotification(
        `Новый продавец майнера!\n\n${username}\n${chatTitle}\n\n${text.slice(0, 400)}\n\n` +
        (leadId ? `Лид создан: ${leadId}` : '')
      )
    } catch (e) { console.error('Handler error:', e.message) }
  }, new NewMessage({}))

  process.on('SIGINT', () => process.exit())
  await new Promise(() => {})
}

main().catch(e => console.error('Fatal:', e.message))
