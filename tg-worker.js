const { TelegramClient } = require('telegram')
const { StringSession } = require('telegram/sessions')
const { NewMessage } = require('telegram/events')
const { parentPort } = require('worker_threads')
const fs = require('fs')

const API_ID = 2040
const API_HASH = 'b18441a1ff607e10a989891a5462e627'
const SESSION_FILE = './session.txt'

function loadSession() {
  if (process.env.SESSION_STRING) return process.env.SESSION_STRING
  try { return fs.readFileSync(SESSION_FILE, 'utf8').trim() } catch (_) { return '' }
}

let tgClient = null

parentPort.on('message', async (msg) => {
  if (msg.type === 'getMessages') {
    const { id, username, limit } = msg
    if (!tgClient) { parentPort.postMessage({ type: 'getMessages', id, error: 'not_ready' }); return }
    try {
      const msgs = await tgClient.getMessages(username, { limit })
      const result = msgs.map(m => ({
        id: m.id, text: m.message || '', date: m.date, views: m.views || null,
        has_photo: !!(m.media && m.media.className === 'MessageMediaPhoto'),
        has_video: !!(m.media && (m.media.className === 'MessageMediaDocument' || m.media.className === 'MessageMediaVideo')),
        url: `https://t.me/${username}/${m.id}`,
      }))
      parentPort.postMessage({ type: 'getMessages', id, messages: result })
    } catch (e) { parentPort.postMessage({ type: 'getMessages', id, error: e.message }) }
  }
})

async function tryConnect(sessionString) {
  const client = new TelegramClient(
    new StringSession(sessionString), API_ID, API_HASH,
    { connectionRetries: 0, autoReconnect: false }
  )
  let done = false
  const startPromise = client.start({
    phoneNumber: async () => { throw new Error('PHONE_CODE_REQUIRED - set SESSION_STRING in Railway') },
    password: async () => { throw new Error('2FA_REQUIRED - set SESSION_STRING in Railway') },
    phoneCode: async () => { throw new Error('PHONE_CODE_REQUIRED - set SESSION_STRING in Railway') },
    onError: (err) => console.log('TG error:', err.message),
  }).then(v => { done = true; return v }).catch(e => { done = true; throw e })

  const deadline = Date.now() + 30000
  while (!done && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500))
  }

  if (!done) {
    console.log('Worker: connect timeout (30s), destroying...')
    try { await client.destroy() } catch (_) {}
    await Promise.race([startPromise.catch(() => {}), new Promise(r => setTimeout(r, 10000))])
    return null
  }
  try { await startPromise; return client } catch (err) {
    try { await client.destroy() } catch (_) {}
    throw err
  }
}

async function workerMain() {
  const sessionString = loadSession()
  if (!sessionString) { console.log('Worker: no SESSION_STRING, exiting'); return }

  for (let attempt = 1; ; attempt++) {
    console.log(`Worker: connect attempt ${attempt}`)
    try {
      const client = await tryConnect(sessionString)
      if (client) {
        try { fs.writeFileSync(SESSION_FILE, client.session.save()) } catch (_) {}
        tgClient = client
        parentPort.postMessage({ type: 'connected' })
        console.log('Worker: Telegram connected!')

        client.addEventHandler(async (event) => {
          const message = event.message
          if (!message?.text) return
          parentPort.postMessage({ type: 'newMessage', text: message.text, senderId: String(message.senderId) })
        }, new NewMessage({}))

        await new Promise(() => {})
        return
      }
    } catch (err) { console.error(`Worker attempt ${attempt} error: ${err.message}`) }
    const delay = Math.min(15000 * attempt, 120000)
    console.log(`Worker: retry in ${delay/1000}s`)
    await new Promise(r => setTimeout(r, delay))
  }
}

workerMain().catch(e => { console.error('Worker fatal:', e.message) })
