const { TelegramClient } = require('telegram')
const { StringSession } = require('telegram/sessions')
const { NewMessage } = require('telegram/events')
const input = require('input')
const https = require('https')

// Telegram Desktop credentials (публичные)
const API_ID = 2040
const API_HASH = 'b18441a1ff607e10a989891a5462e627'

// Настройки — заполни перед запуском
const YOUR_PHONE = '+79248287898'
const BOT_TOKEN_CHAT_ID = 8651432575  // твой Telegram ID (куда присылать уведомления)
const BOT_TOKEN = '8664720856:AAHJ-Bo7COT-Zalw0ZElQILQjiJJ356H_wY'

// Модели майнеров которые принимаешь на обмен
const ACCEPTED_MODELS = [
  'antminer s19', 'antminer s21', 'antminer t21',
  'whatsminer m50', 'whatsminer m60', 'whatsminer m30',
  'jasminer', 'avalon', 'bitmain',
  's19j', 's19 pro', 's19xp', 's21 pro',
]

// Группы для мониторинга — добавь username групп
const MONITOR_GROUPS = [
  // 'miningrussia',
  // 'antminer_sell',
  // добавь сюда username групп без @
]

const SESSION_FILE = './session.txt'
const fs = require('fs')

// Сессия берётся из env (Railway) или из файла (локально)
function loadSession() {
  if (process.env.SESSION_STRING) return process.env.SESSION_STRING
  if (fs.existsSync(SESSION_FILE)) return fs.readFileSync(SESSION_FILE, 'utf8').trim()
  return ''
}

function sendTelegramNotification(text) {
  const body = JSON.stringify({
    chat_id: BOT_TOKEN_CHAT_ID,
    text: text,
    parse_mode: 'HTML',
  })
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  })
  req.write(body)
  req.end()
}

function containsAcceptedModel(text) {
  const lower = text.toLowerCase()
  return ACCEPTED_MODELS.some(model => lower.includes(model))
}

async function main() {
  const sessionString = loadSession()

  const client = new TelegramClient(
    new StringSession(sessionString),
    API_ID,
    API_HASH,
    { connectionRetries: 5 }
  )

  await client.start({
    phoneNumber: async () => YOUR_PHONE,
    password: async () => await input.text('Введи пароль 2FA (если есть, иначе Enter): '),
    phoneCode: async () => await input.text('Введи код из Telegram: '),
    onError: (err) => console.log('Ошибка:', err),
  })

  // Сохраняем сессию
  const session = client.session.save()
  fs.writeFileSync(SESSION_FILE, session)
  console.log('✅ Авторизован! Сессия сохранена.')
  console.log('👁 Мониторинг запущен...')

  sendTelegramNotification('✅ Мониторинг запущен. Слежу за группами.')

  client.addEventHandler(async (event) => {
    const message = event.message
    if (!message || !message.text) return

    const text = message.text
    if (!containsAcceptedModel(text)) return

    // Получаем отправителя
    try {
      const sender = await message.getSender()
      const chat = await message.getChat()
      const username = sender?.username ? `@${sender.username}` : sender?.firstName ?? 'неизвестен'
      const chatTitle = chat?.title ?? 'группа'

      const notification =
        `🔔 <b>Новое объявление о майнере!</b>\n\n` +
        `👤 Продавец: ${username}\n` +
        `💬 Группа: ${chatTitle}\n\n` +
        `📝 Сообщение:\n${text.slice(0, 500)}\n\n` +
        `➡️ Добавить лида: /лид ${sender?.username ? username : 'имя'} ${text.slice(0, 100)}`

      sendTelegramNotification(notification)
      console.log(`[${new Date().toLocaleTimeString()}] Найдено: ${username} в ${chatTitle}`)
    } catch (e) {
      console.error('Ошибка обработки:', e)
    }
  }, new NewMessage({ chats: MONITOR_GROUPS.length ? MONITOR_GROUPS : undefined }))

  // Держим процесс живым
  process.on('SIGINT', () => {
    console.log('\nОстановлен.')
    process.exit()
  })

  await new Promise(() => {}) // бесконечно
}

main().catch(console.error)
