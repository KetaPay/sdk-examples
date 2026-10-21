import { paidOrder } from './_flow.mjs'

export const title = 'a refund turns the download off'

export default async function (ctx) {
  const { assert, get, webhook } = ctx
  const { escrow, order, funded } = await paidOrder(ctx)
  await funded()
  assert.equal((await get(`/orders/${order}/download`)).status, 200)
  assert.equal(await webhook('escrow.refunded', { ...escrow, status: 'refunded' }), 200)
  assert.equal((await get(`/orders/${order}`)).body.status, 'refunded')
  assert.equal((await get(`/orders/${order}/download`)).status, 403)
}
