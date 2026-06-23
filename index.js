const { TelegramClient } = require('telegram')
const { StringSession } = require('telegram/sessions')
const { NewMessage } = require('telegram/events')
const input = require('input')
const https = require('https')
const fs = require('fs')

const API_ID = 2040
const API_HASH = 'b18441a1ff607e10a989891a5462e627'

const YOUR_PHONE = '+79248287898'
const BOT_TOKEN_CHAT_ID = 8651432575
const BOT_TOKEN = '8664720856:AAHJ-Bo7COT-Zalw0ZElQILQjiJJ356H_wY'

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
    external_profile: 'авто-мониторинг',
  })
  const r = await fetch(`${SUPA_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body,
  })
  const data = await r.json()
  return data[0] ?? null
}

async function getOwnerAndSettings() {
  const profiles = await supaFetch(`profiles?select=id&telegram_user_id=eq.${TG_USER_ID}&limit=1`)
  const ownerID = profiles[0]?.id
  if (!ownerID) return null

  const [groupsData, modelsData] = await Promise.all([
    supaFetch(`monitor_groups?select=username&owner_id=eq.${ownerID}&active=eq.true`),
    supaFetch(`equipment_models?select=model_name&owner_id=eq.${ownerID}&active=eq.true`),
  ])

  const groups = Array.isArray(groupsData) ? groupsData.map(g => g.username) : []
  const models = Array.isArray(modelsData) ? modelsData.map(m => m.model_name.toLowerCase()) : []

  return { ownerID, groups, models }
}

async function main() {
  const sessionString = loadSession()

  const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, { connectionRetries: 5 })

  await client.start({
    phoneNumber: async () => YOUR_PHONE,
    password: async () => await input.text('Введи пароль 2FA: '),
    phoneCode: async () => await input.text('Введи код из Telegram: '),
    onError: (err) => console.log('Ошибка:', err),
  })

  fs.writeFileSync(SESSION_FILE, client.session.save())
  console.log('✅ Авторизован!')

  let settings = await getOwnerAndSettings()
  console.log(`👁 Мониторинг запущен. Групп: ${settings?.groups?.length ?? 0}, Моделей: ${settings?.models?.length ?? 0}`)
  sendNotification(`✅ Мониторинг запущен.\nГрупп: ${settings?.groups?.length ?? 0}, Моделей: ${settings?.models?.length ?? 0}`)

  setInterval(async () => {
    settings = await getOwnerAndSettings()
    console.log(`[refresh] Групп: ${settings?.groups?.length ?? 0}, Моделей: ${settings?.models?.length ?? 0}`)
  }, 5 * 60 * 1000)

  client.addEventHandler(async (event) => {
    const message = event.message
    if (!message?.text) return

    const lower = message.text.toLowerCase()
    const models = settings?.models ?? []
    if (!models.length || !models.some(m => lower.includes(m))) return

    try {
      const sender = await message.getSender()
      const chat = await message.getChat()
      const username = sender?.username ? `@${sender.username}` : sender?.firstName ?? 'неизвестен'
      const chatTitle = chat?.title ?? 'группа'

      console.log(`[${new Date().toLocaleTimeString()}] Найдено: ${username} в ${chatTitle}`)

      let leadId = null
      if (settings?.ownerID) {
        const lead = await createLead(settings.ownerID, sender?.username ?? sender?.firstName ?? 'неизвестен', sender?.username ? `@${sender.username}` : null, message.text.slice(0, 500))
        leadId = lead?.id?.slice(0, 8)
      }

      sendNotification(`🔔 <b>Новый продавец!</b>\n\n👤 ${username}\n💬 ${chatTitle}\n\n📝 ${message.text.slice(0, 400)}\n\n${leadId ? `✅ Лид создан: /черновик ${leadId}` : ''}`)
    } catch (e) {
      console.error('Ошибка:', e.message)
    }
  }, new NewMessage({}))

  process.on('SIGINT', () => { console.log('\nОстановлен.'); process.exit() })
  await new Promise(() => {})
}

main().catch(console.error)
