import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// - base './' works on GitHub Pages under any repo name
// - viteSingleFile puts everything into ONE docs/index.html, so the built
//   page also opens by double-clicking it
// - outDir 'docs' lets GitHub Pages serve it straight from the main branch
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { outDir: 'docs', emptyOutDir: true },
});
