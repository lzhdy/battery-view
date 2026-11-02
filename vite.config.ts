import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// DLP 全内联模式：公司 DLP 对 .js（含 .jsd 变体）做透明加密，非白名单进程读到密文
// 导致 WebView 白屏。DLP_INLINE=1 时把所有 JS 合并为单入口 chunk（inlineDynamicImports），
// 并由 build-desktop.mjs 将之内联进 index.html（HTML 不被 DLP 加密），前端不再发起
// 任何 .js 文件读取；未设置时保持常规多文件构建（manualChunks）。
const dlpInline = process.env.DLP_INLINE === '1';

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
      output: dlpInline
        ? { inlineDynamicImports: true }
        : {
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
