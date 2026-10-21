export const title = 'escrow.refunded marks the order refunded'

export default async function ({ assert, get, post, latestSession, pay, webhook, unique }) {
  await post('/checkout', { product: 'lamp', email: unique('buyer') }, true)
  const session = await latestSession()
  const escrow = await pay(session)
  await webhook('escrow.funded', escrow)
  assert.equal(await webhook('escrow.refunded', { ...escrow, status: 'refunded' }), 200)
  assert.equal((await get(`/orders/${session.external_reference}`)).body.status, 'refunded')
}
