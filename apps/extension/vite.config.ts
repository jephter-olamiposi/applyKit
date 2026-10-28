import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';

/**
 * Copies the PDF.js worker into dist/assets. PDF.js loads it by URL at runtime (for the
 * resume preview and for reading an uploaded PDF resume), so the bundler never sees it.
 * Doing this in the build, not only in the packaging script, means an unpacked `dist`
 * loaded straight into Chrome works the same as the store zip.
 */
function copyPdfWorker(): Plugin {
  return {
    name: 'applykit-copy-pdf-worker',
    apply: 'build',
    closeBundle() {
      const source = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const target = resolve(__dirname, 'dist/assets/pdf.worker.mjs');
      if (!existsSync(source)) throw new Error(`PDF.js worker not found at ${source}`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), copyPdfWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        manualChunks(id) {
          // Keep the shared domain package in its own chunk so a 2 MB vendor blob is
          // not named after whichever small module happened to be imported first.
          if (id.includes('/packages/domain/')) return 'domain';
          return undefined;
        },
      },
    },
  },
});
