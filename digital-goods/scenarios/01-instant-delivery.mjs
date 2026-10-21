import { paidOrder } from './_flow.mjs'

export const title = 'payment lands, the store delivers by itself, the buyer downloads it and confirms, the store is paid'

export default async function (ctx) {
  const { assert, ketapay, get, post } = ctx
  const { session, escrow, order, funded } = await paidOrder(ctx)
  assert.equal(session.category, 'digital')
  assert.equal(session.seller.type, 'business')
  assert.equal((await get(`/orders/${order}/download`)).status, 403)

  assert.equal(await funded(), 200)
  assert.equal((await get(`/orders/${order}`)).body.status, 'delivered')
  const delivered = (await ketapay.escrows.retrieve(escrow.id)).milestones[0]
  assert.equal(delivered.status, 'delivered')
  assert.match(delivered.delivery.note, /^Download ready: /)
  const file = await fetch(`http://localhost:4242/orders/${order}/download`)
  assert.equal(file.status, 200)
  assert.match(await file.text(), /Jollof & Beyond/)

  const { session_id } = (await post(`/orders/${order}/buyer/code`)).body
  const confirmed = await post(`/orders/${order}/buyer/confirm`, { session_id, code: '123456' })
  assert.equal(confirmed.body.status, 'completed')
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).status, 'completed')
}
