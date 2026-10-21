// Ade Gadgets: a shop selling its own goods, with KetaPay escrow as a way to pay.
//
// 1. POST /checkout            a checkout session with no `seller`: the shop itself is the seller
// 2. KetaPay's checkout        the buyer pays, on KetaPay's page or over the shop's ("Pay on this page", ../react); KetaPay holds the money
// 3. POST /webhooks            escrow.funded marks the order paid; escrow.completed marks it done
// 4. POST /orders/:id/ship     the shop marks it delivered with its key alone (it is the seller)
// 5. The buyer confirms delivery with KetaPay, and the shop is paid into its KetaPay balance
//
// The pages in ../public: the catalog (/), the buyer's order (/order.html) and the shop admin (/admin.html).
import express from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import KetaPay from '@ketapay/node'

// ../.env when there is one (shared with the PHP version); environment variables win over it
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {}

const { KETAPAY_SECRET_KEY, KETAPAY_WEBHOOK_SECRET, KETAPAY_BASE_URL, BASE_URL = 'http://localhost:4242' } = process.env
if (!KETAPAY_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Set KETAPAY_SECRET_KEY to your sk_test_ key in shop-checkout/.env (see .env.example).')
  process.exit(1)
}

const ketapay = new KetaPay({ apiKey: KETAPAY_SECRET_KEY, ...(KETAPAY_BASE_URL ? { baseUrl: KETAPAY_BASE_URL } : {}) })

// The catalog lives on the server: the price sent to KetaPay never comes from the browser
const PRODUCTS = {
  lamp: { name: 'Brass desk lamp', price: 2_500_000, description: 'Brass desk lamp with a warm LED bulb, brushed finish, boxed with a UK plug.' },
  kettle: { name: 'Glass electric kettle', price: 3_800_000, description: 'Borosilicate glass kettle, 1.7 litres, blue LED, auto shut-off. New and sealed.' },
  headphones: { name: 'Wireless headphones', price: 6_200_000, description: 'Over-ear wireless headphones, noise cancelling, 30-hour battery, carry case.' },
}

// Your database. In memory here: orders are lost when the server restarts.
const orders = new Map()

const app = express()
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

app.get('/api/products', (_req, res) => res.json(Object.entries(PRODUCTS).map(([id, p]) => ({ id, name: p.name, price: p.price }))))

// Step 1: the buyer clicked "Pay with escrow"
app.post('/checkout', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  const product = PRODUCTS[req.body.product]
  if (!product) return res.sendStatus(404)
  const order = { id: randomUUID(), product: product.name, buyer: req.body.email, status: 'awaiting_payment', escrow_id: null, webhooks: [] }
  const session = await ketapay.checkoutSessions.create({
    amount: product.price, // kobo
    category: 'goods',
    title: product.name,
    description: product.description,
    buyer: { email: req.body.email },
    // No `seller`: the shop sells this itself and is paid into its KetaPay balance
    external_reference: order.id,
    return_url: `${BASE_URL}/order.html?order=${order.id}`,
  })
  orders.set(order.id, order)
  // A JSON post ("Pay on this page", @ketapay/checkout) gets the url back to open over the page
  if (req.is('json')) return res.json({ url: session.url, return_url: session.return_url })
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
    order.webhooks.push({ type: event.type, received_at: new Date().toISOString() })
    if (event.type === 'escrow.funded') Object.assign(order, { status: 'paid', escrow_id: escrow.id })
    if (event.type === 'escrow.completed') order.status = 'completed'
    if (event.type === 'escrow.refunded') order.status = 'refunded'
    console.log(`${event.type}: order ${order.id} is ${order.status}`)
  }
  res.sendStatus(200)
})

// The shop admin's list, newest first
app.get('/orders', (_req, res) => res.json([...orders.values()].reverse().map(summary)))

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id)
  order ? res.json(summary(order)) : res.sendStatus(404)
})

// The "what's happening" panel: the escrow as KetaPay has it, and the webhooks this server received
app.get('/orders/:id/activity', async (req, res) => {
  const order = orders.get(req.params.id)
  if (!order) return res.sendStatus(404)
  const escrow = order.escrow_id ? await ketapay.escrows.retrieve(order.escrow_id) : null
  res.json({ escrow, webhooks: order.webhooks })
})

// Step 4: the shop sent it. As the seller, its key alone marks the milestone delivered; the buyer
// is then asked to confirm, and that pays the shop.
app.post('/orders/:id/ship', async (req, res) => {
  const order = orders.get(req.params.id)
  if (!order || order.status !== 'paid') return res.status(409).json({ error: 'Only a paid order can be shipped.' })
  const escrow = await ketapay.escrows.retrieve(order.escrow_id)
  await ketapay.escrows.milestones.deliver(escrow.id, escrow.milestones[0].id, { note: 'Shipped with GIG Logistics' })
  order.status = 'shipped'
  res.json(summary(order))
})

function summary(order) {
  return { id: order.id, product: order.product, buyer: order.buyer, status: order.status }
}

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

app.listen(4242, () => console.log(`Ade Gadgets running on ${BASE_URL}`))
