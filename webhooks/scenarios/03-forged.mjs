export const title = 'a delivery signed with any other secret is refused'

export default async function ({ assert, webhook }) {
  assert.equal(await webhook('escrow.funded', { id: 'esc_scenario', object: 'escrow' }, 'whsec_forged'), 400)
}
