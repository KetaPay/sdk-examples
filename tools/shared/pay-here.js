// "Pay on this page": opens KetaPay's checkout over the page with @ketapay/checkout instead of sending
// the buyer to it. The page loads the library with <script src="https://js.ketapay.com/v1/checkout.js">.
//
// The form is the same one the redirect button posts. Sent as JSON, the server creates the checkout session
// exactly as before (with its secret key) and answers { url, return_url } instead of redirecting.
export async function payHere(form) {
  if (!form.reportValidity()) return
  const res = await fetch(form.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  })
  if (!res.ok) return alert(`Checkout failed (${res.status})`)
  const { url, return_url } = await res.json()

  // onSuccess only moves the page along: the server marks the order paid when the escrow.funded webhook arrives
  window.KetaPay.open({
    url,
    onSuccess: () => (location.href = return_url),
    onError: () => alert('The checkout could not load. Please try again.'),
  })
}
