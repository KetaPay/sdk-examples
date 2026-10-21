export const title = 'the same event delivered twice is answered 200 both times (handled once)'

export default async function ({ assert, webhook }) {
  const id = `evt_${crypto.randomUUID()}`
  const escrow = { id: 'esc_scenario', object: 'escrow' }
  assert.equal(await webhook('milestone.released', escrow, undefined, { id }), 200)
  assert.equal(await webhook('milestone.released', escrow, undefined, { id }), 200)
}
