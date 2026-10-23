import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { handleGenerateRequest } from './api/generate.mjs'

export default defineConfig(({ mode }) => {
  const serverEnvironment = { ...process.env, ...loadEnv(mode, process.cwd(), ['GEMINI_', 'API_RATE_LIMIT_', 'API_DAILY_', 'TRUSTED_CLIENT_IP_HEADER']) }
  return {
    plugins: [react(), {
      name: 'examlyra-generation-api',
      configureServer(server) {
        server.middlewares.use('/api/generate', (request, response) => {
          void handleGenerateRequest(request, response, serverEnvironment)
        })
      },
    },
    ],
  }
})
