// A step a customer approves with a one-time code: the first click asks the server to have KetaPay
// send the code, the second sends the code back with whatever the step needs. In test mode the
// code is always 123456. `codeUrl` and `confirmUrl` are your server's routes; `extra()` adds fields.
export function codeStep({ button, input, codeUrl, confirmUrl, extra = () => ({}), done }) {
  let sessionId = null
  button.textContent = 'Send code'
  button.onclick = async () => {
    button.disabled = true
    const res = await fetch(sessionId ? confirmUrl : codeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionId ? { session_id: sessionId, code: input.value, ...extra() } : {}),
    })
    button.disabled = false
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return alert(body.error ?? 'Something went wrong')
    if (!sessionId) {
      sessionId = body.session_id
      button.textContent = 'Confirm'
      input.focus()
      return
    }
    sessionId = null
    input.value = ''
    button.textContent = 'Send code'
    done?.(body)
  }
}
