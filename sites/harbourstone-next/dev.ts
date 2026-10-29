/** Starts the CMS on port 8080 and the Next.js app in web/ on 3000, and stops both together. */
const children = [
  Bun.spawn(['bun', 'run', 'dev:cms'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', 'dev'], { cwd: 'web', stdout: 'inherit', stderr: 'inherit' }),
]
const stop = () => {
  for (const child of children) child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race(children.map((child) => child.exited))
stop()
