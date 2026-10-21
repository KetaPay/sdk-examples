export const title = 'a genuine delivery replayed 10 minutes later is refused'

export default async function ({ assert, webhook }) {
  const signedAt = Math.floor(Date.now() / 1000) - 600
  assert.equal(await webhook('escrow.funded', { id: 'esc_scenario', object: 'escrow' }, undefined, { signedAt }), 400)
}
