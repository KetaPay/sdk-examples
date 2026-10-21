// A marketplace: your customers buy from and sell to each other, KetaPay holds the money, and you
// take a commission on each sale.
//
// 1. POST /listings/:id/buy               checkout session with the buyer, the seller and your commission
// 2. KetaPay's page                       the buyer pays; the money is held by KetaPay
// 3. POST /orders/:id/seller/code|confirm the seller proves it's them with a one-time code, then marks it sent
// 4. POST /orders/:id/buyer/code|confirm  the buyer proves it's them, then confirms it arrived: the seller is paid
// 5. POST /webhooks                       keeps the order in step with KetaPay, whatever happens elsewhere
//
// Your key alone never moves your customers' money: each step that does needs that customer's token.
import express from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import KetaPay, { KetaPayError } from '@ketapay/node'

// ../.env when there is one (shared with the PHP version); environment variables win over it
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {}

const { KETAPAY_SECRET_KEY, KETAPAY_WEBHOOK_SECRET, KETAPAY_BASE_URL, BASE_URL = 'http://localhost:4242' } = process.env
const COMMISSION_BPS = Number(process.env.COMMISSION_BPS ?? 500)
if (!KETAPAY_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Set KETAPAY_SECRET_KEY to your sk_test_ key in marketplace/.env (see .env.example).')
  process.exit(1)
}

const ketapay = new KetaPay({ apiKey: KETAPAY_SECRET_KEY, ...(KETAPAY_BASE_URL ? { baseUrl: KETAPAY_BASE_URL } : {}) })

// Your database. In memory here: orders are lost when the server restarts.
const LISTINGS = {
  'iphone-15': {
    title: 'iPhone 15 Pro Max, 256GB',
    description: 'Used, 91% battery, no scratches, Face ID works. Box and cable included.',
    amount: 45_000_000, // kobo: ₦450,000
    seller: { email: 'tunde@example.com', name: 'Tunde Bello' },
  },
}
const orders = new Map()

const app = express()
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

// Step 1: the buyer clicked "Buy with escrow"
app.post('/listings/:id/buy', express.urlencoded({ extended: false }), async (req, res) => {
  const listing = LISTINGS[req.params.id]
  if (!listing) return res.sendStatus(404)
  const order = { id: randomUUID(), status: 'awaiting_payment', escrow_id: null }
  const buyer = { email: req.body.email }
  const session = await ketapay.checkoutSessions.create({
    amount: listing.amount,
    category: 'goods',
    title: listing.title,
    description: listing.description,
    buyer,
    seller: listing.seller,
    // Your cut, taken from the seller's side when the money is released
    commission: { rate_bps: COMMISSION_BPS },
    external_reference: order.id,
    return_url: `${BASE_URL}/order.html?order=${order.id}`,
  })
  orders.set(order.id, { ...order, buyer: buyer.email, seller: listing.seller.email })
  res.redirect(303, session.url)
})

// Steps 3 and 4, first half: KetaPay sends this customer a one-time code
app.post('/orders/:id/:role/code', express.json(), async (req, res) => {
  const { order, email } = party(req)
  if (!order) return res.sendStatus(404)
  const session = await ketapay.customerSessions.create({ email })
  res.json({ session_id: session.id })
})

// Second half: the code proves it's them, and their token lets you act for them, this once
app.post('/orders/:id/:role/confirm', express.json(), async (req, res) => {
  const { order, role } = party(req)
  if (!order) return res.sendStatus(404)
  const { token } = await ketapay.customerSessions.verify(req.body.session_id, req.body.code)
  const escrow = await ketapay.escrows.retrieve(order.escrow_id)
  const milestone = escrow.milestones[0]
  if (role === 'seller') {
    await ketapay.escrows.milestones.deliver(escrow.id, milestone.id, { note: 'Sent with GIG Logistics' }, { customerToken: token })
    order.status = 'shipped'
  } else {
    await ketapay.escrows.milestones.release(escrow.id, milestone.id, {}, { customerToken: token })
    order.status = 'completed'
  }
  res.json(order)
})

function party(req) {
  const order = orders.get(req.params.id)
  const role = req.params.role === 'seller' ? 'seller' : 'buyer'
  return { order, role, email: order?.[role] }
}

// Step 5: KetaPay tells you what happened. Read the raw body: the signature covers it exactly.
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
    if (event.type === 'milestone.delivered') order.status = 'shipped'
    if (event.type === 'escrow.completed') order.status = 'completed'
    if (event.type === 'escrow.refunded') order.status = 'refunded'
    console.log(`${event.type}: order ${order.id} is ${order.status}`)
  }
  res.sendStatus(200)
})

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id)
  order ? res.json({ id: order.id, status: order.status }) : res.sendStatus(404)
})

// A wrong code or a step out of order comes back as a KetaPay error with a message to show
app.use((err, _req, res, _next) => {
  if (err instanceof KetaPayError) return res.status(err.statusCode ?? 400).json({ error: err.message, code: err.code })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
})

app.listen(4242, () => console.log(`Marketplace running on ${BASE_URL}`))
