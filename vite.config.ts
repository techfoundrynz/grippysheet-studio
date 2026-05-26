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
  build: {
    // Long-cache splitting: Three.js + its ecosystem rarely change between
    // app deploys, so isolating them into a separate chunk means returning
    // users skip the ~155 KB-gzip download. Same logic for the heavy
    // CAD/file-io vendor libs. No first-load win — the chunks still ship
    // together — but cumulative bandwidth + revisit TTI improves.
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            'three',
            '@react-three/fiber',
            '@react-three/drei',
            'three-bvh-csg',
            'three-stdlib',
            'three-3mf-exporter',
          ],
          vendor: [
            'jszip',
            'clipper-lib',
            'dxf-parser',
            'opentype.js',
            'zod',
            'react-freeze',
            'react-colorful',
          ],
        },
      },
    },
  },
});
