export const title = 'a delivery signed by KetaPay is verified and answered 200'

export default async function ({ assert, webhook }) {
  assert.equal(await webhook('escrow.funded', { id: 'esc_scenario', object: 'escrow' }), 200)
}
