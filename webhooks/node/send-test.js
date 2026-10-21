// Asks KetaPay to send a sample event to your endpoint now, and shows how your server answered.
// Usage: npm run send-test -- <endpoint id> [event type, default escrow.funded]
import { ketapay } from './ketapay.js'

const [id, type = 'escrow.funded'] = process.argv.slice(2)
if (!id) {
  console.error('Usage: npm run send-test -- <endpoint id> [event type]')
  process.exit(1)
}
const result = await ketapay.webhookEndpoints.test(id, type)
console.log(result)
