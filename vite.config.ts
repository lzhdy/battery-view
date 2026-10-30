import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@client': path.resolve(__dirname, 'client'),
    },
  },
  build: {
    outDir: 'dist/client',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: 'client/index.html',
      output: {
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;
          const p = id.match(/node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/);
          if (p) {
            const pkg = p[1];
            const rest = id.slice(id.indexOf(pkg) + pkg.length).replace(/^[\\/]+/, '');
            const seg = rest.split(/[\\/]/).slice(0, 2).join('/') || 'root';
            return 'v_' + pkg.replace(/[^a-zA-Z0-9]/g, '_') + '_' + seg.replace(/[^a-zA-Z0-9]/g, '_');
          }
          return 'v_misc';
        },
      },
    },
  },
});
