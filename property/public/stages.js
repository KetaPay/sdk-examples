// The buyer's and the owner's pages share this: the sale's stages, the current one, and the panel
import { showActivity } from './activity.js'

const naira = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG')}`
export const saleId = encodeURIComponent(new URLSearchParams(location.search).get('sale'))

export async function loadSale(onCurrent) {
  const res = await fetch(`/sales/${saleId}`)
  if (!res.ok) return void (document.getElementById('status').textContent = 'not found')
  const sale = await res.json()
  document.getElementById('title').textContent = sale.title
  document.getElementById('status').textContent = sale.status.replace('_', ' ')
  document.getElementById('stages').replaceChildren(
    ...sale.milestones.map((m) => Object.assign(document.createElement('li'), {
      className: m.status === 'released' ? 'done' : '',
      textContent: `${m.title} (${naira(m.amount)}): ${m.status}`,
    })),
  )
  // Only the first stage not yet paid can move
  const current = sale.milestones.find((m) => m.status === 'funded' || m.status === 'delivered') ?? null
  for (const el of document.querySelectorAll('.current')) el.textContent = current?.title ?? ''
  onCurrent(current)
  showActivity(document.getElementById('activity'), `/sales/${saleId}/activity`)
}
