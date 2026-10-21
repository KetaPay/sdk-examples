export const title = 'a buyer pays, the shop ships with its key, the buyer confirms and the shop is paid'

export default async function ({ assert, ketapay, get, post, latestSession, pay, webhook, unique }) {
  const email = unique('buyer')
  const checkout = await post('/checkout', { product: 'lamp', email }, true)
  const session = await latestSession()
  assert.equal(checkout.status, 303)
  assert.equal(checkout.location, session.url)
  assert.equal(session.amount, 2_500_000)
  assert.equal(session.seller.type, 'business')
  assert.equal(session.fees.commission, 0)
  const order = session.external_reference

  const escrow = await pay(session)
  assert.equal(await webhook('escrow.funded', escrow), 200)
  assert.equal((await get(`/orders/${order}`)).body.status, 'paid')
  assert.ok((await get('/orders')).body.some((o) => o.id === order))

  const shipped = await post(`/orders/${order}/ship`)
  assert.equal(shipped.body.status, 'shipped')
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).milestones[0].status, 'delivered')

  const token = (await ketapay.customerSessions.verify((await ketapay.customerSessions.create({ email })).id, '123456')).token
  const done = await ketapay.escrows.milestones.release(escrow.id, escrow.milestones[0].id, {}, { customerToken: token })
  assert.equal(done.status, 'completed')
  assert.equal(await webhook('escrow.completed', done), 200)
  assert.equal((await get(`/orders/${order}`)).body.status, 'completed')

  const activity = (await get(`/orders/${order}/activity`)).body
  assert.equal(activity.escrow.status, 'completed')
  assert.deepEqual(activity.webhooks.map((w) => w.type), ['escrow.funded', 'escrow.completed'])
}
