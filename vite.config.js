import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const deepseekApiKey = env.VITE_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || ''
  const deepseekApiUrl = (env.VITE_DEEPSEEK_API_URL || env.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/$/, '')

  return {
    plugins: [react()],
    define: {
      __DEEPSEEK_API_KEY__: JSON.stringify(deepseekApiKey),
      __DEEPSEEK_API_URL__: JSON.stringify(deepseekApiUrl),
    },
    server: {
      proxy: {
        '/api': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
