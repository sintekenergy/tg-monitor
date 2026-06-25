const { parentPort } = require('worker_threads')
// Temporarily disabled - waiting for fresh session
console.log('Worker: disabled, waiting for new SESSION_STRING')
parentPort.on('message', (msg) => {
  if (msg.type === 'getMessages') {
    parentPort.postMessage({ type: 'getMessages', id: msg.id, error: 'not_ready' })
  }
})
// Keep worker alive but don't connect to Telegram
setInterval(() => {}, 60000)
