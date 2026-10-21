export const title = 'a product the shop does not sell is refused: prices never come from the browser'

export default async function ({ assert, post, latestSession }) {
  const before = (await latestSession())?.id
  const res = await post('/checkout', { product: 'free-tv', email: 'cheeky@example.com' }, true)
  assert.equal(res.status, 404)
  assert.equal((await latestSession())?.id, before)
}
