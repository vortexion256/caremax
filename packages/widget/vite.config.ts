import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const root = path.resolve(__dirname, '../../');
  const env = loadEnv(mode, root, '');
  const VITE = (k: string) => env[`VITE_${k}`] ?? env[`NEXT_PUBLIC_${k}`] ?? '';
  return {
    plugins: [react()],
    envDir: root,
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL ?? env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'),
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(VITE('FIREBASE_API_KEY')),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(VITE('FIREBASE_AUTH_DOMAIN')),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(VITE('FIREBASE_PROJECT_ID')),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(VITE('FIREBASE_STORAGE_BUCKET')),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(VITE('FIREBASE_MESSAGING_SENDER_ID')),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(VITE('FIREBASE_APP_ID')),
    },
    build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        embed: 'embed.html',
        widget: 'index.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  };
});
