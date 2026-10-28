import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import os from 'os'
import path from 'path'

// /@fs/ serves a structure JSON that lives outside this project. Allow the
// user profile and every fixed-drive root so a Windows path such as
// D:/builds/structure.json is readable. Vite rejects the bare root on Windows.
const fsAllow = [os.homedir()]
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const root = `${letter}:\\`
  try {
    if (fs.statSync(root).isDirectory()) fsAllow.push(root)
  } catch {
    // Drive is not present.
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      // Editors replace a file through a hidden sibling such as
      // .vite.config.js.<pid>.<uuid>.tmpdir. Watching that locked file
      // crashes the dev server with EBUSY.
      ignored: [
        '**/.*.tmp',
        '**/.*.tmp/**',
        '**/.*.tmpdir',
        '**/.*.tmpdir/**',
        '**/.*.*.*.tmpdir',
        '**/.*.*.*.tmpdir/**',
      ],
    },
    fs: {
      allow: fsAllow,
    },
  },
})
