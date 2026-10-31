import { defineConfig } from 'vite'
import { resolve } from 'path'

const root = resolve(import.meta.dirname, 'src')

export default defineConfig({
  root,
  base: './', // 相対パス。リポジトリ名やカスタムドメインに依存しない
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        rating: resolve(root, 'rating/index.html'),
      },
    },
  },
})