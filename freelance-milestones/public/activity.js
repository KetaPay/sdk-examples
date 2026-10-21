// The "what's happening" panel: what KetaPay holds for this order, its fees, every step so far and
// each webhook your server received. It reads GET <url>, which every example's server provides.
const naira = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const words = (s) => s.replaceAll('_', ' ').replaceAll('.', ' ')
const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  Object.assign(node, attrs)
  node.append(...children)
  return node
}

export async function showActivity(panel, url) {
  const res = await fetch(url)
  if (!res.ok) return
  const { escrow, webhooks } = await res.json()
  const parts = [el('h2', {}, "What's happening")]

  if (!escrow) {
    parts.push(el('p', { className: 'muted' }, 'Nothing on KetaPay yet: the escrow starts when the buyer pays.'))
  } else {
    parts.push(
      el('p', {}, 'Escrow ', el('span', { className: 'status' }, words(escrow.status))),
      el(
        'div',
        { className: 'kv' },
        ...[
          ['Price', escrow.fees.amount],
          ['Buyer paid', escrow.fees.buyer_total],
          ['KetaPay fee (seller)', escrow.fees.seller_fee],
          ['Platform commission', escrow.fees.commission],
          ['Seller receives', escrow.fees.seller_payout],
        ].flatMap(([k, v]) => [el('span', {}, k), el('span', {}, naira(v))]),
      ),
      el('h2', { style: 'margin-top:16px' }, 'Milestones'),
      el(
        'ul',
        { className: 'steps' },
        ...escrow.milestones.map((m) =>
          el('li', { className: m.status === 'released' ? 'done' : '' }, `${m.title}: ${naira(m.amount)}, ${words(m.status)}`),
        ),
      ),
      el('h2', { style: 'margin-top:16px' }, 'Timeline'),
      el(
        'ul',
        { className: 'steps' },
        ...escrow.timeline.map((t) => el('li', { className: 'done' }, `${when(t.occurred_at)}  ${words(t.type)}`)),
      ),
    )
  }
  parts.push(
    el('h2', { style: 'margin-top:16px' }, 'Webhooks received'),
    webhooks.length
      ? el('ul', { className: 'steps' }, ...webhooks.map((w) => el('li', { className: 'done' }, `${when(w.received_at)}  ${w.type}`)))
      : el('p', { className: 'muted' }, 'None yet. See the README to receive them locally.'),
  )
  panel.replaceChildren(...parts)
}
