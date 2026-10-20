// A shop selling its own goods, with KetaPay escrow as a way to pay.
//
// 1. POST /checkout          creates a checkout session with no `seller`: the shop is the seller
// 2. KetaPay's page          the buyer pays; the money is held by KetaPay
// 3. POST /webhooks          escrow.funded marks the order paid; escrow.completed marks it done
// 4. POST /orders/:id/ship   the shop marks it delivered with its key alone
// 5. The buyer confirms delivery with KetaPay, and the shop is paid into its KetaPay balance
import express from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import KetaPay from '@ketapay/node'

// ../.env when there is one (shared with the PHP version); environment variables, such as
// Codespaces secrets, win over it
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {}

const { KETAPAY_SECRET_KEY, KETAPAY_WEBHOOK_SECRET, KETAPAY_BASE_URL, BASE_URL = 'http://localhost:4242' } = process.env
if (!KETAPAY_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Set KETAPAY_SECRET_KEY to your sk_test_ key in shop-checkout/.env (see .env.example).')
  process.exit(1)
}

const ketapay = new KetaPay({ apiKey: KETAPAY_SECRET_KEY, ...(KETAPAY_BASE_URL ? { baseUrl: KETAPAY_BASE_URL } : {}) })

// Your database. Kept in memory here: orders are lost when the server restarts.
const orders = new Map()

const app = express()
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

// Step 1: the buyer clicked "Pay with escrow"
app.post('/checkout', express.urlencoded({ extended: false }), async (req, res) => {
  const order = { id: randomUUID(), status: 'awaiting_payment', escrow_id: null }
  const session = await ketapay.checkoutSessions.create({
    amount: 2_500_000, // kobo: ₦25,000
    category: 'goods',
    title: 'Brass desk lamp',
    description: 'Brass desk lamp with a warm LED bulb, brushed finish, boxed with a UK plug.',
    buyer: { email: req.body.email },
    // No `seller`: the shop sells this itself and is paid into its KetaPay balance
    external_reference: order.id,
    return_url: `${BASE_URL}/order.html?order=${order.id}`,
  })
  orders.set(order.id, { ...order, session_id: session.id })
  res.redirect(303, session.url)
})

// Step 3: KetaPay tells the shop what happened. Read the raw body: the signature covers it exactly.
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = await ketapay.webhooks.verify(req.body, req.get('KetaPay-Signature'), KETAPAY_WEBHOOK_SECRET)
  } catch (err) {
    console.warn(`Refused a webhook: ${err.message}`)
    return res.sendStatus(400)
  }
  const escrow = event.data.object
  const order = orders.get(escrow.external_reference)
  if (order) {
    if (event.type === 'escrow.funded') Object.assign(order, { status: 'paid', escrow_id: escrow.id })
    if (event.type === 'escrow.completed') order.status = 'completed'
    if (event.type === 'escrow.refunded') order.status = 'refunded'
    console.log(`${event.type}: order ${order.id} is ${order.status}`)
  }
  res.sendStatus(200)
})

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id)
  order ? res.json(order) : res.sendStatus(404)
})

// Step 4: the shop sent the lamp. As the seller, its key alone marks the milestone delivered;
// the buyer is then asked to confirm, and releasing pays the shop.
app.post('/orders/:id/ship', async (req, res) => {
  const order = orders.get(req.params.id)
  if (!order || order.status !== 'paid') return res.sendStatus(409)
  const escrow = await ketapay.escrows.retrieve(order.escrow_id)
  await ketapay.escrows.milestones.deliver(escrow.id, escrow.milestones[0].id, { note: 'Shipped with GIG Logistics' })
  order.status = 'shipped'
  res.json(order)
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

app.listen(4242, () => console.log(`Shop running on ${BASE_URL}`))
