export const title = "an order can't be shipped before KetaPay confirms the payment"

export default async function ({ assert, post, latestSession }) {
  await post('/checkout', { product: 'headphones', email: 'early@example.com' }, true)
  const session = await latestSession()
  const shipped = await post(`/orders/${session.external_reference}/ship`)
  assert.equal(shipped.status, 409)
}
