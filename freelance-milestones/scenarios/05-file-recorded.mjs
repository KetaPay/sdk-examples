import { fundedProject, step } from './_flow.mjs'

export const title = 'a delivered PDF is recorded on the milestone; a web page instead of a file is refused'

export default async function (ctx) {
  const { assert, ketapay, get } = ctx
  const { escrow, project } = await fundedProject(ctx)
  const [design] = (await get(`/projects/${project}`)).body.milestones

  const page = await step(ctx, project, 'freelancer', 'deliver', { milestone_id: design.id, note: 'x', link: 'https://example.com/' })
  assert.equal(page.status, 400)
  assert.equal(page.body.code, 'file_type_not_allowed')

  const pdf = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
  const delivered = await step(ctx, project, 'freelancer', 'deliver', { milestone_id: design.id, note: 'Designs', link: pdf })
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body))
  const kept = (await ketapay.escrows.retrieve(escrow.id)).milestones[0].delivery.attachments
  assert.deepEqual(kept.map((a) => a.url), [pdf])
}
