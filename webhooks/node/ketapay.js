// Shared by the server and the scripts: the client, the secrets, and where handled events are kept
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import KetaPay from '@ketapay/node'

// ../.env when there is one (shared with the PHP version); environment variables win over it
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {}

const { KETAPAY_SECRET_KEY, KETAPAY_BASE_URL, KETAPAY_WEBHOOK_SECRET, KETAPAY_WEBHOOK_SECRET_PREVIOUS } = process.env
if (!KETAPAY_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Set KETAPAY_SECRET_KEY to your sk_test_ key in webhooks/.env (see .env.example).')
  process.exit(1)
}

export const ketapay = new KetaPay({ apiKey: KETAPAY_SECRET_KEY, ...(KETAPAY_BASE_URL ? { baseUrl: KETAPAY_BASE_URL } : {}) })

// Both secrets while a rotation is under way: a delivery signed with either is genuine
export const secrets = [KETAPAY_WEBHOOK_SECRET, KETAPAY_WEBHOOK_SECRET_PREVIOUS].filter(Boolean)

// Your database. A JSON file here: the ids of events already handled, and the newest one's time.
const STORE = fileURLToPath(new URL('./handled.json', import.meta.url))
const load = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : { ids: [], since: null })

// Handles an event once, however often it arrives: KetaPay retries until you answer 2xx, and
// `catch-up` may fetch one the server also got. Returns false when it was already handled.
export function handle(event) {
  const store = load()
  if (store.ids.includes(event.id)) return false
  // Your work goes here: mark the order paid, email the seller, update your books...
  console.log(`${event.created_at}  ${event.type}  ${event.data.object.id ?? ''}`)
  store.ids.push(event.id)
  if (!store.since || event.created_at > store.since) store.since = event.created_at
  writeFileSync(STORE, JSON.stringify(store))
  return true
}

export const lastHandledAt = () => load().since
