/**
 * Serves the app built into web/out on the port in CROMBOLO_APP_URL (3001), as a
 * static host would: a file when there is one, and `index.html` for any other
 * address, so the app in the browser decides what each address shows.
 */
import { existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

const app = new URL(process.env.CROMBOLO_APP_URL ?? 'http://localhost:3001')
const out = join(import.meta.dir, 'web', 'out')
const shell = join(out, 'index.html')

if (!existsSync(shell)) {
  console.error('There is no app to serve yet: run `bun run build` in web/ first.')
  process.exit(1)
}

const isFile = (path: string) => existsSync(path) && statSync(path).isFile()

const server = Bun.serve({
  port: Number(app.port || 3001),
  fetch(request) {
    const path = normalize(decodeURIComponent(new URL(request.url).pathname))
    const file = join(out, path)
    if (!path.includes('..') && isFile(file)) return new Response(Bun.file(file))
    return new Response(Bun.file(shell), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    })
  },
})

console.log(`The app is at http://localhost:${server.port}/`)
