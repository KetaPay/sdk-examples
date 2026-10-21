// Replaces the endpoint's signing secret, for example after it leaked. KetaPay signs with both the
// new and the old secret for a while, so you can deploy the new one without missing a delivery.
// Usage: npm run rotate -- <endpoint id>
import { ketapay } from './ketapay.js'

const id = process.argv[2]
if (!id) {
  console.error('Usage: npm run rotate -- <endpoint id>')
  process.exit(1)
}
const { secret, previous_secret_expires_at } = await ketapay.webhookEndpoints.rotateSecret(id)
console.log(`Update webhooks/.env, then restart the server (the new secret is not shown again):`)
console.log(`KETAPAY_WEBHOOK_SECRET=${secret}`)
console.log(`KETAPAY_WEBHOOK_SECRET_PREVIOUS=${process.env.KETAPAY_WEBHOOK_SECRET ?? '<your old secret>'}`)
console.log(`The old secret stops signing at ${previous_secret_expires_at}: remove it from .env after that.`)
