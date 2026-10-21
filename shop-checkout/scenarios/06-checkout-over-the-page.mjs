export const title = 'a JSON checkout gets the url back, for @ketapay/checkout or @ketapay/react to open over the page'

export default async function ({ assert, get, post, latestSession, unique }) {
  const checkout = await post('/checkout', { product: 'kettle', email: unique('buyer') })
  const session = await latestSession()
  assert.equal(checkout.status, 200)
  assert.equal(checkout.body.url, session.url)
  assert.equal(checkout.body.return_url, session.return_url)
  assert.equal(session.amount, 3_800_000)
  assert.equal((await get(`/orders/${session.external_reference}`)).body.status, 'awaiting_payment')
}
