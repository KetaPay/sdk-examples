import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React shop runs on :5173 and talks to the Node or PHP server on :4242 through this proxy, so the
// browser sees one origin. The order page, admin and styles are the server's own (../public).
const server = 'http://localhost:4242'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '^/(api|checkout|orders)(/|$)': server,
      '^/(order\\.html|admin\\.html|style\\.css|activity\\.js|code-step\\.js)$': server,
    },
  },
})
