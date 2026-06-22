import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
  },
  define: {
    // True only when running the dev server (`vite` / `vite serve`); the literal
    // `false` is inlined for every `vite build`. Keyed on the COMMAND, not on
    // NODE_ENV — so a stray NODE_ENV=development can't smuggle dev-only code
    // (the mock-auth bypass) into a production bundle. See src/lib/devAuth.js.
    __DEV_SERVER__: JSON.stringify(command === 'serve'),
  },
}))
