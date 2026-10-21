// Pagebound: a store selling its own e-books and courses, with KetaPay escrow as a way to pay.
// Delivery is instant: when KetaPay says the buyer has paid, the store delivers by itself, and the
// buyer confirms the download works, which pays the store.
//
// 1. POST /checkout                          a checkout session with no `seller`: the store is the seller
// 2. KetaPay's checkout page                 the buyer pays; KetaPay holds the money
// 3. POST /webhooks                          escrow.funded: the store delivers at once, with its key alone
// 4. GET /orders/:id/download                the buyer downloads it, from the order page
// 5. POST /orders/:id/buyer/code|confirm     the buyer confirms it works with a one-time code: the store is paid
//
// The pages in ../public: the store (/) and the buyer's order with the download (/order.html).
import express from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import KetaPay, { KetaPayError } from '@ketapay/node'

// ../.env when there is one (shared with the PHP version); environment variables win over it
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {}

const { KETAPAY_SECRET_KEY, KETAPAY_WEBHOOK_SECRET, KETAPAY_BASE_URL, BASE_URL = 'http://localhost:4242' } = process.env
if (!KETAPAY_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Set KETAPAY_SECRET_KEY to your sk_test_ key in digital-goods/.env (see .env.example).')
  process.exit(1)
}

const ketapay = new KetaPay({ apiKey: KETAPAY_SECRET_KEY, ...(KETAPAY_BASE_URL ? { baseUrl: KETAPAY_BASE_URL } : {}) })

const PRODUCTS = {
  'ebook-cooking': {
    name: 'Jollof & Beyond (e-book)',
    price: 450_000, // kobo: ₦4,500
    description: '120-page e-book of West African recipes, PDF and EPUB, with a printable shopping list.',
    file: 'Jollof & Beyond\n\nChapter 1: The perfect party jollof…\n',
  },
  'course-excel': {
    name: 'Excel for small businesses (video course)',
    price: 2_500_000,
    description: 'Eight video lessons, three hours in all: bookkeeping, stock and payroll sheets, with templates.',
    file: 'Excel for small businesses\n\nLesson 1: Setting up your bookkeeping sheet…\n',
  },
}

// Your database. In memory here: orders are lost when the server restarts.
const orders = new Map()

const app = express()
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

app.get('/api/products', (_req, res) => res.json(Object.entries(PRODUCTS).map(([id, p]) => ({ id, name: p.name, price: p.price }))))

// Step 1: the buyer clicked "Pay with escrow"
app.post('/checkout', express.urlencoded({ extended: false }), async (req, res) => {
  const product = PRODUCTS[req.body.product]
  if (!product) return res.sendStatus(404)
  const order = { id: randomUUID(), product: req.body.product, buyer: req.body.email, status: 'awaiting_payment', escrow_id: null, webhooks: [] }
  const session = await ketapay.checkoutSessions.create({
    amount: product.price,
    category: 'digital',
    title: product.name,
    description: product.description,
    buyer: { email: req.body.email },
    // No `seller`: the store sells this itself and is paid into its KetaPay balance
    external_reference: order.id,
    return_url: `${BASE_URL}/order.html?order=${order.id}`,
  })
  orders.set(order.id, order)
  res.redirect(303, session.url)
})

// Step 3: KetaPay tells the store the buyer paid, and the store delivers at once. Webhooks can arrive
// more than once, so delivery happens only for an order that isn't delivered yet.
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
    if (event.type === 'escrow.funded' && order.status === 'awaiting_payment') {
      // Claimed before the call, so a copy arriving meanwhile skips it; put back if it fails, so
      // KetaPay's retry delivers it
      Object.assign(order, { status: 'delivering', escrow_id: escrow.id })
      try {
        // The store is the seller, so its key alone marks it delivered
        await ketapay.escrows.milestones.deliver(escrow.id, escrow.milestones[0].id, {
          note: `Download ready: ${PRODUCTS[order.product].name}`.slice(0, 160),
        })
        order.status = 'delivered'
      } catch (err) {
        order.status = 'awaiting_payment'
        throw err
      }
    }
    if (event.type === 'escrow.completed') order.status = 'completed'
    if (event.type === 'escrow.refunded') order.status = 'refunded'
    console.log(`${event.type}: order ${order.id} is ${order.status}`)
  }
  res.sendStatus(200)
})

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id)
  order ? res.json({ id: order.id, product: PRODUCTS[order.product].name, status: order.status }) : res.sendStatus(404)
})

// Step 4: the download, only once paid and never after a refund
app.get('/orders/:id/download', (req, res) => {
  const order = orders.get(req.params.id)
  if (!order || !['delivered', 'completed'].includes(order.status)) return res.sendStatus(403)
  res.attachment(`${order.product}.txt`).type('text/plain').send(PRODUCTS[order.product].file)
})

// Step 5: the buyer confirms the download works, approved with a one-time code (123456 in test mode)
app.post('/orders/:id/buyer/code', express.json(), async (req, res) => {
  const order = orders.get(req.params.id)
  if (!order) return res.sendStatus(404)
  res.json({ session_id: (await ketapay.customerSessions.create({ email: order.buyer })).id })
})

app.post('/orders/:id/buyer/confirm', express.json(), async (req, res) => {
  const order = orders.get(req.params.id)
  if (!order?.escrow_id) return res.sendStatus(404)
  const { token } = await ketapay.customerSessions.verify(req.body.session_id, req.body.code)
  const escrow = await ketapay.escrows.retrieve(order.escrow_id)
  await ketapay.escrows.milestones.release(escrow.id, escrow.milestones[0].id, {}, { customerToken: token })
  order.status = 'completed'
  res.json({ id: order.id, status: order.status })
})

// The "what's happening" panel: the escrow as KetaPay has it, and the webhooks the store received
app.get('/orders/:id/activity', async (req, res) => {
  const order = orders.get(req.params.id)
  if (!order) return res.sendStatus(404)
  res.json({ escrow: order.escrow_id ? await ketapay.escrows.retrieve(order.escrow_id) : null, webhooks: order.webhooks })
})

app.use((err, _req, res, _next) => {
  if (err instanceof KetaPayError) return res.status(err.statusCode ?? 400).json({ error: err.message, code: err.code })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
})

app.listen(4242, () => console.log(`Pagebound running on ${BASE_URL}`))
