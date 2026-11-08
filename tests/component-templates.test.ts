/**
 * A page's template picker lists every component on disk; one nothing names yet
 * is made a template on request, by someone with Structure, and its file is left
 * as it was.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const TEMPLATES = `${BACKOFFICE}/crombolo/api/templates`
const HERO = 'export default function Hero() { return <section /> }\n'

test('every component is listed, and one is made a template without touching its file', async () => {
  const dir = mkdtempSync(join(process.cwd(), 'output', 'component-templates-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'blocks'), { recursive: true })
  mkdirSync(join(dir, 'pages'), { recursive: true })
  writeFileSync(join(dir, 'blocks', 'hero.tsx'), HERO)
  writeFileSync(join(dir, 'pages', 'home.tsx'), 'export default function Home() { return null }\n')
  const h = await signedInServer({ config: { componentsDir: dir } })
  open.push(h)

  const list = async () =>
    (await h.json<{ items: { alias: string; id: string | null }[] }>(TEMPLATES)).items
  expect((await list()).find((c) => c.alias === 'blocks/hero')).toEqual({
    alias: 'blocks/hero',
    id: null,
  })

  const writer = await signInAsGroup(h)
  expect((await writer.post(TEMPLATES, { alias: 'blocks/hero' })).status).toBe(403)
  expect((await h.post(TEMPLATES, { alias: 'blocks/nothing' })).status).toBe(404)

  const made = await h.post(TEMPLATES, { alias: 'blocks/hero' })
  expect(made.status).toBe(201)
  const { id } = (await made.json()) as { id: string }
  expect((await list()).find((c) => c.alias === 'blocks/hero')?.id).toBe(id)
  // Asked again, it is the same template.
  expect(
    ((await (await h.post(TEMPLATES, { alias: 'blocks/hero' })).json()) as { id: string }).id,
  ).toBe(id)
  expect(readFileSync(join(dir, 'blocks', 'hero.tsx'), 'utf8')).toBe(HERO)
})
