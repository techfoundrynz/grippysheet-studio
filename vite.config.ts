import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ["babel-plugin-react-compiler", { target: "19" }],
        ],
      },
    }),
  ],
  // Only needed if hosted without custom domain
  // base: '/PubRemote/',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
