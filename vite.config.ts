/// <reference types="vitest" />
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
  define: {
    '__BUILD_TIMESTAMP__': `${Date.now()}`,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/utils/**',
        'src/context/**',
        'src/components/DebouncedInput.tsx',
        'src/components/Spinner.tsx'
      ],
    },
  },
});

