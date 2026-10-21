export const title = 'a webhook not signed by KetaPay is refused and changes nothing'

export default async function ({ assert, get, post, latestSession, pay, webhook, unique }) {
  await post('/listings/ps5/buy', { email: unique('buyer') }, true)
  const session = await latestSession()
  const escrow = await pay(session)
  assert.equal(await webhook('escrow.funded', escrow, 'whsec_forged'), 400)
  assert.equal((await get(`/orders/${session.external_reference}`)).body.status, 'awaiting_payment')
}
