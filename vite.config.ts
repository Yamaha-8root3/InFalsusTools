import { defineConfig } from 'vite'
import { resolve } from 'path'

const root = resolve(import.meta.dirname, 'src')

export default defineConfig({
    root,
    build: {
        rollupOptions: {
            input: {
                index: resolve(import.meta.dirname, 'index.html'),
                rating: resolve(import.meta.dirname, 'rating/index.html')
            },
        },
    },
})