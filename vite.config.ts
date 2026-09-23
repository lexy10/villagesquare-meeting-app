import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA build: `vite build` emits a plain static site to `dist/`, deployable
// exactly like the original three-file app. `base: './'` keeps every asset URL
// relative so it can be hosted under any path/domain (matching the old behavior).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // LiveKit is most of the bundle. Its own chunk stays cached across deploys
    // that only change app code.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: { manualChunks: { livekit: ['livekit-client'] } },
    },
  },
});
