// Handles every event your server missed while it was down. KetaPay keeps them: list everything since
// the newest event you handled, oldest first, and handle each once (handled ones are skipped).
// Usage: npm run catch-up
import { handle, ketapay, lastHandledAt } from './ketapay.js'

const since = lastHandledAt() ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const missed = []
// Lists come newest first, a page at a time; `for await` walks every page
for await (const event of ketapay.events.list({ created_gte: since, limit: 100 })) missed.push(event)

let handled = 0
for (const event of missed.reverse()) if (handle(event)) handled++
console.log(`Caught up: ${handled} new of ${missed.length} events since ${since}`)
