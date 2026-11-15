/**
 * Starts the CMS on port 8080 and the app in web/ on 3001, and stops both together.
 * Once the CMS answers with the home page, `members.ts` makes the Members page
 * members-only.
 */
const cms = `http://localhost:${process.env.PORT ?? 8080}`
const children = [
  Bun.spawn(['bun', 'run', 'dev:cms'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', 'dev'], { cwd: 'web', stdout: 'inherit', stderr: 'inherit' }),
]
const stop = () => {
  for (const child of children) child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

async function membersOnceUp() {
  for (let tries = 0; tries < 240; tries++) {
    const answer = await fetch(`${cms}/crombolo/delivery/api/v2/route?path=/`).catch(() => null)
    if (answer?.ok) {
      Bun.spawn(['bun', 'members.ts'], { stdout: 'inherit', stderr: 'inherit' })
      return
    }
    await Bun.sleep(500)
  }
}
membersOnceUp()

await Promise.race(children.map((child) => child.exited))
stop()
process.exit(0)
