import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const deepseekApiUrl = (env.VITE_DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/$/, '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: deepseekApiUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
