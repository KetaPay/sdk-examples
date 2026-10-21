import { paidOrder } from './_flow.mjs'

export const title = 'a wrong code when confirming is refused and the store is not paid'

export default async function (ctx) {
  const { assert, ketapay, post } = ctx
  const { escrow, order, funded } = await paidOrder(ctx)
  await funded()
  const { session_id } = (await post(`/orders/${order}/buyer/code`)).body
  const wrong = await post(`/orders/${order}/buyer/confirm`, { session_id, code: '000000' })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.code, 'code_invalid')
  assert.equal((await ketapay.escrows.retrieve(escrow.id)).milestones[0].status, 'delivered')
}
