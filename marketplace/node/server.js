// Swapmart: a marketplace where customers buy from and sell to each other. KetaPay holds the money,
// and Swapmart takes a commission on each sale.
//
// 1. POST /listings/:id/buy                checkout session with the buyer, the listing's seller and the commission
// 2. KetaPay's checkout page               the buyer pays; KetaPay holds the money
// 3. POST /orders/:id/seller/code|confirm  the seller proves it's them with a one-time code, then marks it sent
// 4. POST /orders/:id/buyer/code|confirm   the buyer proves it's them, then confirms it arrived: the seller is paid
// 5. POST /webhooks                        keeps the order in step with KetaPay, whatever happens elsewhere
//
// Swapmart's key alone never moves its customers' money: each step that does needs that customer's token.
// The pages in ../public: listings (/), the buyer's order, the seller's sale, and the platform admin.
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
    price: 45_000_000, // kobo: ₦450,000
    seller: { email: 'tunde@example.com', name: 'Tunde Bello' },
  },
  'ps5': {
    title: 'PlayStation 5, disc edition',
    description: 'Bought 2024, two controllers, all cables, works perfectly. Original box.',
    price: 52_000_000,
    seller: { email: 'chioma@example.com', name: 'Chioma Eze' },
  },
  'bicycle': {
    title: 'Road bike, 54cm frame',
    description: 'Aluminium frame, Shimano gears, new tyres, serviced last month. Pickup in Yaba.',
    price: 18_000_000,
    seller: { email: 'musa@example.com', name: 'Musa Bello' },
  },
}
const orders = new Map()

const app = express()
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

app.get('/api/listings', (_req, res) =>
  res.json(Object.entries(LISTINGS).map(([id, l]) => ({ id, title: l.title, price: l.price, seller: l.seller.name }))),
)

// Step 1: the buyer clicked "Buy with escrow"
app.post('/listings/:id/buy', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  const listing = LISTINGS[req.params.id]
  if (!listing) return res.sendStatus(404)
  const order = { id: randomUUID(), title: listing.title, status: 'awaiting_payment', escrow_id: null, webhooks: [] }
  const session = await ketapay.checkoutSessions.create({
    amount: listing.price,
    category: 'goods',
    title: listing.title,
    description: listing.description,
    buyer: { email: req.body.email },
    seller: listing.seller,
    // Swapmart's cut, taken from the seller's side when the money is released
    commission: { rate_bps: COMMISSION_BPS },
    external_reference: order.id,
    return_url: `${BASE_URL}/order.html?order=${order.id}`,
  })
  orders.set(order.id, { ...order, buyer: req.body.email, seller: listing.seller.email, commission: session.fees.commission })
  // A JSON post ("Pay on this page", @ketapay/checkout) gets the url back to open over the page
  if (req.is('json')) return res.json({ url: session.url, return_url: session.return_url })
  res.redirect(303, session.url)
})

// Steps 3 and 4, first half: KetaPay sends this customer a one-time code
app.post('/orders/:id/:role/code', express.json(), async (req, res) => {
  const { order, email } = party(req)
  if (!order) return res.sendStatus(404)
  const session = await ketapay.customerSessions.create({ email })
  res.json({ session_id: session.id })
})

// Second half: the code proves it's them, and their token lets Swapmart act for them, this once
app.post('/orders/:id/:role/confirm', express.json(), async (req, res) => {
  const { order, role } = party(req)
  if (!order?.escrow_id) return res.sendStatus(404)
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
  res.json(summary(order))
})

function party(req) {
  const order = orders.get(req.params.id)
  const role = req.params.role === 'seller' ? 'seller' : 'buyer'
  return { order, role, email: order?.[role] }
}

// Step 5: KetaPay tells Swapmart what happened. Read the raw body: the signature covers it exactly.
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
    if (event.type === 'milestone.delivered') order.status = 'shipped'
    if (event.type === 'escrow.completed') order.status = 'completed'
    if (event.type === 'escrow.refunded') order.status = 'refunded'
    console.log(`${event.type}: order ${order.id} is ${order.status}`)
  }
  res.sendStatus(200)
})

// The platform admin's list, newest first, with the commission each sale earns
app.get('/orders', (_req, res) => res.json([...orders.values()].reverse().map(summary)))

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id)
  order ? res.json(summary(order)) : res.sendStatus(404)
})

// The "what's happening" panel: the escrow as KetaPay has it, and the webhooks Swapmart received
app.get('/orders/:id/activity', async (req, res) => {
  const order = orders.get(req.params.id)
  if (!order) return res.sendStatus(404)
  const escrow = order.escrow_id ? await ketapay.escrows.retrieve(order.escrow_id) : null
  res.json({ escrow, webhooks: order.webhooks })
})

function summary(order) {
  const { id, title, buyer, seller, status, commission } = order
  return { id, title, buyer, seller, status, commission }
}

// A wrong code or a step out of order comes back as a KetaPay error with a message to show
app.use((err, _req, res, _next) => {
  if (err instanceof KetaPayError) return res.status(err.statusCode ?? 400).json({ error: err.message, code: err.code })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
})

app.listen(4242, () => console.log(`Swapmart running on ${BASE_URL}`))
