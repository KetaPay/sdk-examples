import { paidOrder, step } from './_flow.mjs'

export const title = 'a wrong one-time code is refused with KetaPay\'s message, and nothing moves'

export default async function (ctx) {
  const { assert, ketapay, get } = ctx
  const { escrow, order } = await paidOrder(ctx, 'ps5')
  const wrong = await step(ctx, order, 'seller', '000000')
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.code, 'code_invalid')
  assert.ok(wrong.body.error)
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).milestones[0].status, 'funded')
  assert.equal((await get(`/orders/${order}`)).body.status, 'paid')
}
