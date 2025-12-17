import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const allEnv = loadEnv(mode, process.cwd(), '')

  const deepseekApiKey = allEnv.VITE_DEEPSEEK_API_KEY ?? allEnv.DEEPSEEK_API_KEY ?? ''
  const deepseekApiUrl = (allEnv.VITE_DEEPSEEK_API_URL || allEnv.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/$/, '')

  return {
    plugins: [react()],
    define: {
      // Expose non-VITE-prefixed variables (e.g., DEEPSEEK_API_KEY on Railway) to the client bundle
      'import.meta.env.VITE_DEEPSEEK_API_KEY': JSON.stringify(deepseekApiKey),
      'import.meta.env.VITE_DEEPSEEK_API_URL': JSON.stringify(deepseekApiUrl),
    },
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
