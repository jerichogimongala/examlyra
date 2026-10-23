import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { handleGenerateRequest } from './api/generate.mjs'

const root = resolve('dist')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  if (pathname === '/api/generate') {
    await handleGenerateRequest(request, response)
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  try {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
    const file = resolve(root, relative)
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path')
    const contents = await readFile(file)
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : contents)
  } catch {
    if (!extname(pathname)) {
      try {
        const contents = await readFile(resolve(root, 'index.html'))
        response.writeHead(200, { 'Content-Type': mime['.html'] })
        response.end(contents)
        return
      } catch { /* Return 404 below when the build has not been created. */ }
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found. Run npm run build first.')
  }
})

const port = Number(process.env.PORT || 3000)
server.listen(port, '0.0.0.0', () => process.stdout.write(`Examlyra listening on http://localhost:${port}\n`))
