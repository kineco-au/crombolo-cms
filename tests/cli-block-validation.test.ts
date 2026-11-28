/**
 * Story 456 from the command line: a block a save would refuse is refused with its
 * path and Umbraco's words, and `content check` lists stored pages whose next save
 * would be refused. Driven through the CLI against a SQLite site of its own; the
 * rules themselves are tested on both dialects in block-editors.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComponentRepository,
  ContentTypeRepository,
  connect,
  currentSchemaState,
  type Db,
  DocumentRepository,
} from '@crombolo/data'
import { ERROR_KINDS, OUTCOMES } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const CARD = 'c4a9d1f0-0456-4000-8000-0000000000c1'
let site: string
const keys: Record<string, string> = {}

const env = () => ({
  ...process.env,
  CROMBOLO_DB: 'sqlite',
  CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
  CROMBOLO_MEDIA_DIR: join(site, 'media'),
  CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
  CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
  CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
  CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
})

function cli(args: string[]) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: site, env: env(), stdin: 'ignore' })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}

async function withDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
  try {
    return await work(db)
  } finally {
    await db.close()
  }
}

const cards = (...titles: string[]) => {
  const data = titles.map((title) => ({
    key: crypto.randomUUID(),
    contentTypeKey: CARD,
    values: [
      {
        alias: 'title',
        editorAlias: 'Umbraco.TextBox',
        culture: null,
        segment: null,
        value: title,
      },
    ],
  }))
  return {
    layout: { 'Umbraco.BlockList': data.map((d) => ({ contentKey: d.key })) },
    contentData: data,
    settingsData: [],
  }
}

beforeAll(async () => {
  site = mkdtempSync(join(process.cwd(), 'output', 'cli-block-validation-'))
  for (const dir of ['schema/content-types', 'schema/data-types', 'components'])
    mkdirSync(join(site, dir), { recursive: true })
  const write = (path: string, body: string) => writeFileSync(join(site, path), body)
  write('schema/schema.toml', '[schema]\nversion = "1.0.0"\n')
  write(
    'schema/content-types/card.toml',
    `[content-type]\nkey = "${CARD}"\nalias = "card"\nname = "Card"\nis-element = true\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\nmandatory = true\n`,
  )
  write(
    'schema/data-types/cards.toml',
    `[data-type]\nalias = "cards"\nname = "Cards"\neditor = "Umbraco.BlockList"\neditor-ui = "Umb.PropertyEditorUi.BlockList"\n\n[data-type.config.validationLimit]\nmax = 1\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${CARD}"\n`,
  )
  write(
    'schema/content-types/page.toml',
    '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "cards"\nname = "Cards"\ntype = "cards"\n',
  )
  write('components/page.tsx', 'export default () => <main />\n')
  const synced = cli(['types', 'sync'])
  expect(synced.code, synced.err).toBe(0)
  await withDb(async (db) => {
    const state = await currentSchemaState(db)
    const docs = new DocumentRepository(db, {
      nodeState: { version: state.version, revision: state.revision },
    })
    const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
    const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
    const page = async (name: string, value: unknown) => {
      const doc = await docs.create({
        key: crypto.randomUUID(),
        contentTypeKey: typeKey,
        componentKey,
        parentKey: null,
        values:
          value === undefined ? [] : [{ alias: 'cards', culture: null, segment: null, value }],
        variants: [{ culture: null, segment: null, name }],
      })
      keys[name] = doc.key
    }
    await page('Empty', undefined)
    await page('One', cards('Only'))
    // Written past the rules, as content saved before them was.
    await page('Two', cards('First', 'Second'))
  })
}, 30_000)
afterAll(() => rmSync(site, { recursive: true, force: true }))

describe('blocks from the command line (story 456)', () => {
  test('a block a save would refuse is refused, with its path and Umbraco’s words', () => {
    const tooMany = cli([
      'content',
      'block',
      'add',
      '/One',
      'cards',
      '--type',
      'card',
      '--set',
      'title=More',
    ])
    expect(tooMany.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(tooMany.err).toContain('Maximum 1 entries, 1 too many.')

    const empty = cli(['content', 'block', 'add', '/Empty', 'cards', '--type', 'card'])
    expect(empty.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(empty.err).toContain(
      "cards at $.values[?(@.alias == 'cards' && @.culture == null && @.segment == null)].value.contentData[0].values[?(@.alias == 'title' && @.culture == null && @.segment == null)].value: Value cannot be empty",
    )
  })

  test('`content check` lists the stored pages a save would refuse, and where', () => {
    const checked = cli(['content', 'check'])
    expect(checked.code).toBe(OUTCOMES.problems_found.code)
    expect(checked.out).toContain(`Page "Two" (${keys.Two})`)
    expect(checked.out).toContain(
      "$.values[?(@.alias == 'cards' && @.culture == null && @.segment == null)].value: Maximum 1 entries, 1 too many.",
    )
    expect(checked.out).not.toContain('"One"')
    const json = JSON.parse(cli(['content', 'check', '-o', 'json']).out) as {
      items: Array<{ key: string; problems: Array<{ property: string; messages: string[] }> }>
    }
    expect(json.items.map((i) => i.key)).toEqual([keys.Two as string])
    expect(json.items[0]?.problems).toEqual([
      expect.objectContaining({ property: 'cards', messages: ['Maximum 1 entries, 1 too many.'] }),
    ])
  })
})
