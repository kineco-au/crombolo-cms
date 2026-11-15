/**
 * Makes the Members page members-only: a Members group, and the page kept for it,
 * with the Login page to sign in on. Who may see a page belongs to the site, not
 * to its content files, so this runs once the site's content is in; running it
 * again changes nothing.
 */
const MEMBERS_PAGE = '066d33a9-72c0-49e7-92d2-e14722d71d65'
const LOGIN_PAGE = 'f9dd345b-bce2-4511-afde-f7c4bc01dbfe'
const GROUP = 'Members'

const crombolo = (...args: string[]) =>
  Bun.spawnSync(['bun', 'run', 'crombolo', ...args], {
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe',
  })

const groups = crombolo('members', 'groups', 'list', '-o', 'json')
if (!groups.stdout.toString().includes(`"${GROUP}"`)) crombolo('members', 'groups', 'new', GROUP)

const access = crombolo(
  'content',
  'access',
  'set',
  MEMBERS_PAGE,
  '--group',
  GROUP,
  '--login-page',
  LOGIN_PAGE,
  '--no-access-page',
  LOGIN_PAGE,
)
if (access.exitCode !== 0) {
  console.error(`The Members page could not be made members-only:\n${access.stderr}`)
  process.exit(1)
}
console.log(
  `The Members page is for the ${GROUP} group. Add a member to it in the back office to sign in as.`,
)
