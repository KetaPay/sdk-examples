// Ade Gadgets in React: the same shop and server as ../public, with KetaPay's checkout opened over the
// page by <KetaPayButton> from @ketapay/react instead of a redirect.
import { useEffect, useRef, useState } from 'react'
import { KetaPayButton } from '@ketapay/react'

const naira = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG')}`

export function App() {
  const [products, setProducts] = useState([])

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then(setProducts)
  }, [])

  return (
    <>
      <header>
        <div className="bar">
          <strong>Ade Gadgets</strong>
          <a href="/admin.html">Shop admin</a>
        </div>
      </header>
      <main className="wrap">
        <section className="card">
          <h1>Pay with escrow</h1>
          <p className="muted">
            Your money is held by KetaPay, not by us, until you confirm your order arrived as described. If it doesn't,
            KetaPay steps in and you get it back.
          </p>
        </section>
        <section className="grid">
          {products.map((product) => (
            <Product key={product.id} product={product} />
          ))}
        </section>
      </main>
    </>
  )
}

function Product({ product }) {
  const [email, setEmail] = useState('')
  const returnUrl = useRef(null)

  // Called when the button is clicked: the server creates the session (prices never come from the
  // browser) and answers with its url, which the button opens over the page.
  async function createCheckout() {
    const res = await fetch('/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: product.id, email }),
    })
    if (!res.ok) throw new Error(`Checkout failed (${res.status})`)
    const session = await res.json()
    returnUrl.current = session.return_url
    return session.url
  }

  return (
    <div className="card">
      <h2>{product.name}</h2>
      <p className="price">{naira(product.price)}</p>
      <label htmlFor={`email-${product.id}`}>Your email</label>
      <input
        id={`email-${product.id}`}
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <KetaPayButton
        url={createCheckout}
        disabled={!email.includes('@')}
        // For the page only: the order is paid when the escrow.funded webhook says so
        onSuccess={() => (location.href = returnUrl.current)}
        onError={(err) => alert(err.message)}
      >
        Pay with escrow
      </KetaPayButton>
    </div>
  )
}
