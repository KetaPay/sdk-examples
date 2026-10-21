// Runs an example's scenarios against its Node or PHP server, the way a browser and KetaPay would
// reach it: over HTTP on port 4242. Payment uses KetaPay's sandbox helper; webhooks are signed with
// the example's KETAPAY_WEBHOOK_SECRET, like KetaPay signs them.
//
// Usage: npm run scenarios -- <example> <node|php>      (needs <example>/.env with an sk_test_ key)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import KetaPay from '@ketapay/node'

const [example, language = 'node'] = process.argv.slice(2)
const dir = fileURLToPath(new URL(`../${example ?? ''}`, import.meta.url))
if (!example || !existsSync(join(dir, 'scenarios')) || !['node', 'php'].includes(language)) {
  console.error('Usage: npm run scenarios -- <example> <node|php>')
  process.exit(1)
}
try {
  process.loadEnvFile(join(dir, '.env'))
} catch {}
const { KETAPAY_SECRET_KEY: apiKey, KETAPAY_BASE_URL: baseUrl, KETAPAY_WEBHOOK_SECRET: secret } = process.env
if (!apiKey?.startsWith('sk_test_') || !secret) {
  console.error(`Set KETAPAY_SECRET_KEY (sk_test_) and KETAPAY_WEBHOOK_SECRET in ${example}/.env`)
  process.exit(1)
}

const SITE = 'http://localhost:4242'
const server =
  language === 'node'
    ? spawn('node', ['server.js'], { cwd: join(dir, 'node'), stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('php', ['-S', 'localhost:4242', existsSync(join(dir, 'php', 'index.php')) ? 'index.php' : 'server.php'], {
        cwd: join(dir, 'php'),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
for (let i = 0; i < 50 && !(await fetch(SITE).then(() => true, () => false)); i++) await sleep(100)
await sleep(200)

const ketapay = new KetaPay({ apiKey, ...(baseUrl ? { baseUrl } : {}) })
const ctx = {
  assert,
  ketapay,
  get: async (path) => {
    const res = await fetch(`${SITE}${path}`)
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null }
  },
  post: async (path, body, form = false) => {
    const res = await fetch(`${SITE}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body) : JSON.stringify(body ?? {}),
    })
    const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null
    return { status: res.status, body: json, location: res.headers.get('location') }
  },
  // The newest checkout session (the one the example just created) and its order id
  latestSession: async () => (await ketapay.checkoutSessions.list({ limit: 1 })).data[0],
  // Pays a session with the sandbox helper and returns the funded escrow
  pay: async (session) => ketapay.escrows.retrieve((await ketapay.testHelpers.checkoutSessions.pay(session.id)).escrow_id),
  // Sends a webhook to the example as KetaPay would: its event, signed with the endpoint's secret.
  // `id` resends the same event; `signedAt` (unix seconds) signs it as if sent then.
  webhook: async (type, object, signWith = secret, { id = `evt_${crypto.randomUUID()}`, signedAt } = {}) => {
    const body = JSON.stringify({ id, object: 'event', type, created_at: new Date().toISOString(), data: { object } })
    const signature = await ketapay.webhooks.generateTestSignatureHeader(body, signWith, signedAt)
    const res = await fetch(`${SITE}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'KetaPay-Signature': signature },
      body,
    })
    return res.status
  },
  unique: (who) => `${who}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`,
}

let failed = 0
for (const file of readdirSync(join(dir, 'scenarios')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort()) {
  const scenario = await import(pathToFileURL(join(dir, 'scenarios', file)))
  try {
    await scenario.default(ctx)
    console.log(`  ok    ${file.replace('.mjs', '')}: ${scenario.title}`)
  } catch (err) {
    failed++
    console.log(`  FAIL  ${file.replace('.mjs', '')}: ${scenario.title}\n        ${err.message.split('\n').join('\n        ')}`)
  }
}
server.kill()
if (failed) console.log(`\n${language} server log:\n${log.split('\n').slice(-20).join('\n')}`)
console.log(`\n${example} on ${language}: ${failed ? `${failed} failed` : 'all passed'}`)
process.exit(failed ? 1 : 0)
