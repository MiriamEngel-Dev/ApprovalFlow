import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5173 per ARCHITECTURE.md §12. No dev proxy — nginx already sends permissive CORS
// (`Access-Control-Allow-Origin: *`) and this app only ever uses bearer tokens, never cookies, so
// there's nothing a same-origin proxy would protect against; src/api.ts talks to the gateway
// directly via VITE_API_BASE.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
