import { paidOrder, step } from './_flow.mjs'

export const title = 'seller sends it, buyer confirms, seller paid less the commission, which Swapmart earns'

export default async function (ctx) {
  const { assert, ketapay, get } = ctx
  const { session, escrow, order } = await paidOrder(ctx)
  assert.equal(session.seller.email, 'tunde@example.com')
  assert.deepEqual([session.commission.rate_bps, session.fees.commission], [500, 2_250_000])
  assert.equal((await get(`/orders/${order}`)).body.status, 'paid')

  assert.equal((await step(ctx, order, 'seller')).body.status, 'shipped')
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).milestones[0].status, 'delivered')
  assert.equal((await step(ctx, order, 'buyer')).body.status, 'completed')

  const after = await ketapay.escrows.retrieve(escrow.id)
  assert.equal(after.status, 'completed')
  assert.equal(after.milestones[0].commission, 2_250_000)
  assert.equal((await get('/orders')).body.find((o) => o.id === order).commission, 2_250_000)
}
