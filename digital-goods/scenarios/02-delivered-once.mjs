import { paidOrder } from './_flow.mjs'

export const title = 'the same escrow.funded twice delivers once, and both copies are answered 200'

export default async function (ctx) {
  const { assert, ketapay, get } = ctx
  const { escrow, order, funded } = await paidOrder(ctx, 'course-excel')
  assert.deepEqual(await Promise.all([funded(), funded()]), [200, 200])
  assert.equal(await funded(), 200)
  assert.equal((await get(`/orders/${order}`)).body.status, 'delivered')
  const deliveries = (await ketapay.escrows.retrieve(escrow.id)).timeline.filter((t) => t.type === 'milestone_delivered')
  assert.equal(deliveries.length, 1)
}
