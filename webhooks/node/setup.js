// Adds a webhook endpoint for your server and prints its signing secret, which is shown only now.
// Usage: npm run setup -- https://your-address/webhooks
import { ketapay } from './ketapay.js'

const url = process.argv[2]
if (!url?.startsWith('https://')) {
  console.error('Usage: npm run setup -- https://your-address/webhooks (KetaPay only sends to https)')
  process.exit(1)
}
const endpoint = await ketapay.webhookEndpoints.create({
  url,
  description: 'sdk-examples webhooks',
  // Leave enabled_events out to get every event, including ones added later
  enabled_events: ['escrow.funded', 'milestone.delivered', 'milestone.released', 'escrow.completed', 'escrow.refunded'],
})
console.log(`Endpoint ${endpoint.id} sends ${endpoint.enabled_events.length} events to ${endpoint.url}`)
console.log(`\nAdd this to webhooks/.env (it is not shown again):\nKETAPAY_WEBHOOK_SECRET=${endpoint.secret}`)
