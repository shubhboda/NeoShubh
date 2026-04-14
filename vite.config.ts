import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const fileEnv = loadEnv(mode, '.', '');
  // Vercel / CI: secrets are on process.env only; loadEnv() only reads .env files.
  const geminiKey = fileEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // JSON.stringify so the define is never raw `undefined` (breaks the client bundle).
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
