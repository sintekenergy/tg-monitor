const http = require('http')
const https = require('https')
const fs = require('fs')
const { Worker } = require('worker_threads')
const path = require('path')

const BOT_TOKEN_CHAT_ID = 8651432575
const BOT_TOKEN = '8664720856:AAHJ-Bo7COT-Zalw0ZElQiIJJ356H_wY'
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mpyphadcrdvmxnjyhorg.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1weXBoYWRjcmR2bXhuanlob3JnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjAyODM5MywiZXhwIjoyMDk3NjA0MzkzfQ.iExYvEpqVj9HeiNdrk8GfeaWRxw3wczYrdcXgJvFY9o'
const TG_USER_ID = 8651432575
const PORT = process.env.PORT || 3001
const SECRET = process.env.PREVIEW_SECRET || 'zemobmen-preview'

let tgReady = false
let pendingRequests = new Map()
let msgId = 0

const worker = new Worker(path.join(__dirname, 'tg-worker.js'))
worker.on('message', (msg) => {
  if (msg.type === 'connected') { tgReady = true; console.log('Main: TG worker connected'); sendNotification('Мониторинг запущен') }
  if (msg.type === 'getMessages') {
    const cb = pendingRequests.get(msg.id)
    if (cb) { pendingRequests.delete(msg.id); cb(msg) }
  }
  if (msg.type === 'newMessage') { handleNewMessage(msg).catch(e => console.error('newMsg error:', e.message)) }
})
worker.on('error', e => console.error('Worker error:', e.message))
worker.on('exit', code => { console.log('Worker exited with code', code); tgReady = false })

function getMessages(username, limit) {
  return new Promise((resolve, reject) => {
    if (!tgReady) { reject(new Error('not_ready')); return }
    const id = ++msgId
    const timer = setTimeout(() => { pendingRequests.delete(id); reject(new Error('timeout')) }, 15000)
    pendingRequests.set(id, (msg) => {
      clearTimeout(timer)
      if (msg.error) reject(new Error(msg.error === 'not_ready' ? 'Client not ready' : msg.error))
      else resolve(msg.messages)
    })
    worker.postMessage({ type: 'getMessages', id, username, limit })
  })
}

function sendNotification(text) {
  const body = JSON.stringify({ chat_id: BOT_TOKEN_CHAT_ID, text, parse_mode: 'HTML' })
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  })
  req.on('error', () => {}); req.write(body); req.end()
}

async function supaFetch(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
  })
  return r.json()
}

let settings = null
async function refreshSettings() {
  try {
    const profiles = await supaFetch(`profiles?select=id&telegram_user_id=eq.${TG_USER_ID}&limit=1`)
    const ownerID = profiles[0]?.id
    if (!ownerID) { settings = null; return }
    const [sourcesData, modelsData] = await Promise.all([
      supaFetch(`sources?select=url&owner_id=eq.${ownerID}&source_type=eq.telegram_channel&monitor_enabled=eq.true`),
      supaFetch(`equipment_models?select=model_name&owner_id=eq.${ownerID}&active=eq.true`),
    ])
    settings = {
      ownerID,
      groups: Array.isArray(sourcesData) ? sourcesData.map(s => s.url.replace('https://t.me/','').replace('https://telegram.me/','')).filter(Boolean) : [],
      models: Array.isArray(modelsData) ? modelsData.map(m => m.model_name.toLowerCase()) : [],
    }
  } catch (e) { console.error('refreshSettings error:', e.message) }
}

async function handleNewMessage({ text, senderId }) {
  if (!settings) return
  const lower = text.toLowerCase()
  if (!settings.models.length || !settings.models.some(m => lower.includes(m))) return
  try {
    const body = JSON.stringify({
      owner_id: settings.ownerID, display_name: senderId, telegram_username: null,
      equipment_description: text.slice(0, 500), status: 'new', external_profile: 'auto-monitor',
    })
    await fetch(`${SUPA_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body,
    })
    sendNotification(`Новый продавец!\n\n${text.slice(0, 400)}`)
  } catch (e) { console.error('handleNewMessage error:', e.message) }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  if (req.url === '/health') {
    res.writeHead(200)
    return res.end(JSON.stringify({ ok: true, tg: tgReady }))
  }

  const auth = req.headers['authorization']
  if (auth !== `Bearer ${SECRET}`) {
    res.writeHead(401)
    return res.end(JSON.stringify({ error: 'Unauthorized' }))
  }

  const match = req.url && req.url.match(/^\/messages\/([A-Za-z0-9_]+)/)
  if (req.method === 'GET' && match) {
    if (!tgReady) {
      res.writeHead(503)
      return res.end(JSON.stringify({ error: 'Client not ready' }))
    }
    const username = match[1]
    const limitMatch = req.url.match(/limit=(\d+)/)
    const limit = Math.min(parseInt(limitMatch ? limitMatch[1] : '15', 10), 30)
    getMessages(username, limit).then(messages => {
      res.writeHead(200)
      res.end(JSON.stringify({ messages }))
    }).catch(e => {
      res.writeHead(e.message === 'Client not ready' ? 503 : 500)
      res.end(JSON.stringify({ error: e.message }))
    })
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`HTTP server on port ${PORT}`)
  refreshSettings().catch(e => console.error('init settings error:', e.message))
  setInterval(() => refreshSettings().catch(e => console.error('refresh settings error:', e.message)), 5 * 60 * 1000)
})
