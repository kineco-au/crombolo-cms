/**
 * Story 357: every data type preset through the CLI. Each is made with `types new
 * data-type`, read back with `types show`, round-tripped through its file, and made
 * again from its editor's full name with `--set`, to the same file. Then a page
 * with a property of each new one saves a value through the Management API, reads
 * it back as sent, and renders it, as `every-editor.test.ts` does for the seeded
 * data types.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import {
  DATA_TYPE_PRESETS,
  fileNameFor,
  parseDataType,
  presetDataType,
  type SchemaDataType,
  writeDataType,
} from '@crombolo/schema'
import { ROOT } from '../scripts/packages.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const ARTICLE =
  '[content-type]\nalias = "article"\nname = "Article"\nallow-at-root = true\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n'

/** Each preset and the flags it is made with. */
const FLAGS: Record<string, string[]> = {
  textstring: ['--max-chars', '80'],
  textarea: ['--rows', '4'],
  'rich-text': [],
  markdown: ['--preview'],
  code: ['--language', 'css'],
  email: [],
  number: ['--min', '1', '--max', '9'],
  decimal: ['--min', '0.5', '--step', '0.25'],
  slider: ['--min', '1', '--max', '5', '--step', '0.5', '--range'],
  toggle: ['--default-on'],
  date: ['--with-time'],
  'date-with-zone': [],
  'date-only': [],
  'time-only': [],
  'date-time': [],
  dropdown: ['--option', 'One', '--option', 'Two'],
  'checkbox-list': ['--option', 'Red', '--option', 'Blue'],
  'radio-list': ['--option', 'Yes', '--option', 'No'],
  tags: ['--group', 'topics'],
  'multiple-text': ['--min', '1', '--max', '3'],
  'color-picker': ['--color', '#1b264f=Navy', '--color', '#ffffff=White'],
  'eye-dropper': ['--alpha'],
  'content-picker': ['--of', 'pages', '--allow', 'article'],
  'document-picker': ['--allow', 'article'],
  'media-picker': ['--multiple', '--max', '5'],
  'member-picker': [],
  'member-group-picker': [],
  'user-picker': [],
  'entity-data-picker': [],
  'multi-url-picker': ['--max', '2'],
  'element-picker': [],
  upload: ['--extension', 'pdf'],
  'image-cropper': ['--crop', 'thumb:200x100'],
  label: ['--value-type', 'decimal'],
  'block-list': [],
  'single-block': [],
  'block-grid': ['--columns', '6'],
  'list-view': [],
}

const aliasOf = (preset: string) =>
  `my${preset.replace(/(^|-)(.)/g, (_, __, c: string) => c.toUpperCase())}`

/** What the back office sends for each new editor, and what a template then shows. */
const target = crypto.randomUUID()
const SENT: Record<string, [unknown, string]> = {
  markdown: ['# Notes\n\nSome *text*.', '&lt;h1&gt;Notes&lt;/h1&gt;'],
  code: ['a { color: red }', 'a { color: red }'],
  email: ['someone@example.com', 'someone@example.com'],
  decimal: [2.5, '2.5'],
  slider: [{ from: 2.5, to: 4 }, '{&quot;from&quot;:2.5,&quot;to&quot;:4}'],
  'date-with-zone': [
    { date: '2026-01-02T03:04:05+01:00', timeZone: 'Europe/Paris' },
    'Europe/Paris',
  ],
  'date-only': [{ date: '2026-01-02', timeZone: null }, '2026-01-02'],
  'time-only': [{ date: '03:04:00', timeZone: null }, '03:04:00'],
  'date-time': [{ date: '2026-01-02T03:04:00', timeZone: null }, '2026-01-02T03:04:00'],
  'checkbox-list': [['Red'], '[&quot;Red&quot;]'],
  'radio-list': ['Yes', 'Yes'],
  tags: [['news', 'bun'], '[&quot;news&quot;,&quot;bun&quot;]'],
  'multiple-text': [['one', 'two'], '[&quot;one&quot;,&quot;two&quot;]'],
  'color-picker': [{ label: 'Navy', value: '#1b264f' }, '#1b264f'],
  'eye-dropper': ['#ff000080', '#ff000080'],
  'document-picker': [`umb://document/${target.replaceAll('-', '')}`, 'null'],
  'member-picker': [`umb://member/${target.replaceAll('-', '')}`, 'umb://member/'],
  'member-group-picker': [target, target],
  'user-picker': [target, target],
  'entity-data-picker': [
    { ids: ['one', 'two'] },
    '{&quot;ids&quot;:[&quot;one&quot;,&quot;two&quot;]}',
  ],
  'multi-url-picker': [
    [
      {
        name: 'Example',
        type: 'external',
        url: 'https://example.com',
        target: null,
        unique: null,
        queryString: null,
      },
    ],
    'https://example.com',
  ],
  label: ['A label', 'A label'],
}
const UPLOADS = ['upload', 'image-cropper']
const NEW = [...Object.keys(SENT), ...UPLOADS]

describe('every data type preset, from the command line', () => {
  /** Sites made in parallel, each preset in one: by its name, and by its full name. */
  const GROUPS = 4
  const groups: Array<{ name: string; full: string }> = []
  const groupOf = (preset: string) =>
    groups[Object.keys(FLAGS).indexOf(preset) % GROUPS] as { name: string; full: string }
  const byName = (preset: string) => file(groupOf(preset).name, aliasOf(preset))
  const byFullName = (preset: string) => file(groupOf(preset).full, aliasOf(preset))
  const shown = new Map<string, Record<string, unknown>>()
  const env = (site: string) => ({
    ...process.env,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
    CROMBOLO_MEDIA_DIR: join(site, 'media'),
    CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
    CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
    CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
    CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
    CROMBOLO_LOG_TO_CONSOLE: 'false',
  })
  const cli = async (site: string, ...args: string[]) => {
    const proc = Bun.spawn(['bun', BIN, ...args], {
      cwd: site,
      env: env(site),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, out: out + err }
  }
  const file = (site: string, alias: string) =>
    readFileSync(join(site, 'schema', 'data-types', fileNameFor(alias)), 'utf8')
  const site = (name: string) => {
    const dir = mkdtempSync(join(process.cwd(), 'output', `data-type-presets-${name}-`))
    mkdirSync(join(dir, 'schema', 'content-types'), { recursive: true })
    mkdirSync(join(dir, 'components'), { recursive: true })
    writeFileSync(join(dir, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(join(dir, 'schema', 'content-types', 'article.toml'), ARTICLE)
    return dir
  }

  /** The `--set` pairs that make from the full name what the flags made. */
  const setsFor = (preset: string, made: SchemaDataType) => {
    const plain = presetDataType(made.alias, preset)
    const defaults = plain.ok ? plain.dataType.config : {}
    return Object.entries(made.config)
      .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(defaults[key]))
      .flatMap(([key, value]) => ['--set', `${key}=${JSON.stringify(value)}`])
  }

  beforeAll(async () => {
    for (let i = 0; i < GROUPS; i++) groups.push({ name: site('name'), full: site('full') })
    const make = async (dir: string, preset: string, editor: string[]) => {
      const run = await cli(
        dir,
        'types',
        'new',
        'data-type',
        aliasOf(preset),
        '--editor',
        ...editor,
      )
      if (run.code !== 0) throw new Error(`${preset}: ${run.out}`)
    }
    // A site's runs go in turn, as they share its database; the sites alongside each other.
    const made = groups.map(async (_, group) => {
      const mine = Object.keys(FLAGS).filter((_, index) => index % GROUPS === group)
      let fromFullNames = Promise.resolve()
      for (const preset of mine) {
        const { name, full } = groupOf(preset)
        await make(name, preset, [preset, ...(FLAGS[preset] ?? [])])
        const p = DATA_TYPE_PRESETS[preset]
        const parsed = parseDataType('x.toml', byName(preset)).value
        if (!p || !parsed) throw new Error(`${preset}: no file`)
        const index = Object.keys(FLAGS).indexOf(preset)
        const editor = [index % 2 === 0 ? p.editor : p.editorUi, ...setsFor(preset, parsed)]
        fromFullNames = fromFullNames.then(() => make(full, preset, editor))
      }
      for (const preset of mine) {
        const run = await cli(groupOf(preset).name, 'types', 'show', aliasOf(preset), '-o', 'json')
        if (run.code !== 0) throw new Error(`${preset}: ${run.out}`)
        shown.set(preset, JSON.parse(run.out))
      }
      await fromFullNames
    })
    await Promise.all(made)
  }, 240_000)
  afterAll(() => {
    for (const dir of groups.flatMap((g) => [g.name, g.full]))
      rmSync(dir, { recursive: true, force: true })
  })

  test('there is a case for every preset', () => {
    expect(Object.keys(FLAGS).sort()).toEqual(Object.keys(DATA_TYPE_PRESETS).sort())
  })

  test('each is shown as written, round-trips through its file, and is the same from its full name', () => {
    expect(shown.size).toBe(Object.keys(FLAGS).length)
    for (const [preset, detail] of shown) {
      const p = DATA_TYPE_PRESETS[preset]
      const text = byName(preset)
      const parsed = parseDataType('x.toml', text).value as SchemaDataType
      expect([preset, detail.editor, detail.editorUi, detail.preset]).toEqual([
        preset,
        p?.editor,
        p?.editorUi,
        preset,
      ])
      expect(
        Object.fromEntries(
          (detail.settings as Array<{ setting: string; value: unknown }>).map((s) => [
            s.setting,
            s.value,
          ]),
        ),
        preset,
      ).toEqual(parsed.config)
      expect(writeDataType(parsed), preset).toBe(text)
      expect(byFullName(preset), preset).toBe(text)
    }
  })

  test('the flags reach the file', () => {
    expect(byName('slider')).toContain('step = 0.5')
    expect(byName('decimal')).toContain('step = 0.25')
    expect(byName('document-picker')).toContain('allowedContentTypes = ["article"]')
    expect(byName('color-picker')).toContain('useLabel = true')
  })

  test('a fraction where a whole number goes, and an unknown editor, are refused', async () => {
    const fraction = await cli(
      groupOf('number').name,
      'types',
      'new',
      'data-type',
      'half',
      '--editor',
      'number',
      '--step',
      '0.5',
    )
    expect(fraction.code).not.toBe(0)
    expect(fraction.out).toContain('--step takes a whole number')
    const unknown = await cli(
      groupOf('number').name,
      'types',
      'new',
      'data-type',
      'odd',
      '--editor',
      'Umbraco.Colour',
    )
    expect(unknown.code).not.toBe(0)
    expect(unknown.out).toContain('Umbraco.ColorPicker')
  }, 30_000)

  test("each new editor's value is saved, read back as sent, and rendered", async () => {
    const type = `[content-type]\nalias = "everyPreset"\nname = "Every preset"\nallow-at-root = true\ncomponents = ["everyPreset"]\ndefault-component = "everyPreset"\n${NEW.map((preset) => `\n[[property]]\nalias = "${aliasOf(preset)}"\nname = "${preset}"\ntype = "${aliasOf(preset)}"\n`).join('')}`
    const page = site('page')
    groups.push({ name: page, full: page })
    for (const preset of NEW)
      cpSync(
        join(groupOf(preset).name, 'schema', 'data-types', fileNameFor(aliasOf(preset))),
        join(page, 'schema', 'data-types', fileNameFor(aliasOf(preset))),
      )
    writeFileSync(join(page, 'schema', 'content-types', 'every-preset.toml'), type)
    writeFileSync(
      join(page, 'components', 'everyPreset.tsx'),
      `export default async function EveryPreset({ model }) {
  const show = (v) => (v === null || v === undefined ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  const values = await Promise.all(model.properties.map((p) => model.value(p.alias)))
  return <dl>{model.properties.map((p, i) => <><dt>{p.alias}</dt><dd>{show(values[i])}</dd></>)}</dl>
}
`,
    )
    const h: Harness = await signedInServer({
      config: {
        schemaDir: join(page, 'schema'),
        componentsDir: join(page, 'components'),
        mediaDir: join(page, 'media'),
      },
    })
    try {
      const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('everyPreset'))
        ?.key as string
      const componentKey = (await new ComponentRepository(h.server.db).byAlias('everyPreset'))
        ?.key as string
      expect(typeKey).toBeDefined()
      const upload = async (name: string, body: BlobPart) => {
        const id = crypto.randomUUID()
        const form = new FormData()
        form.set('Id', id)
        form.set('File', new File([body], name))
        await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })
        return id
      }
      const sent = Object.fromEntries(
        Object.entries(SENT).map(([preset, [value]]) => [aliasOf(preset), value]),
      )
      const uploads = {
        [aliasOf('upload')]: {
          src: '',
          temporaryFileId: await upload('brochure.pdf', '%PDF'),
        },
        [aliasOf('image-cropper')]: {
          src: '',
          temporaryFileId: await upload(
            'photo.png',
            await Bun.file(join(import.meta.dir, 'fixtures', 'pixel.png')).bytes(),
          ),
          crops: [],
          focalPoint: { left: 0.5, top: 0.5 },
        },
      }
      const created = await h.post(`${V1}/document`, {
        documentType: { id: typeKey },
        template: { id: componentKey },
        parent: null,
        values: Object.entries({ ...sent, ...uploads }).map(([alias, value]) => ({
          alias,
          culture: null,
          segment: null,
          value,
        })),
        variants: [{ culture: null, segment: null, name: 'Every preset' }],
      })
      expect(created.status, await created.clone().text()).toBe(201)
      const key = created.headers.get('umb-generated-resource') as string
      const read = await h.json<{ values: Array<{ alias: string; value: unknown }> }>(
        `${V1}/document/${key}`,
      )
      const back = Object.fromEntries(read.values.map((v) => [v.alias, v.value]))
      for (const [alias, value] of Object.entries(sent))
        expect([alias, back[alias]]).toEqual([alias, value])
      for (const alias of Object.keys(uploads))
        expect([alias, (back[alias] as { src: string }).src]).toEqual([
          alias,
          expect.stringMatching(/^\/media\/[0-9a-f]{8}\//),
        ])

      await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
      const html = await (await h.call('/')).text()
      const shown = (alias: string) =>
        new RegExp(`<dt>${alias}</dt><dd>([^<]*)</dd>`).exec(html)?.[1]
      for (const [preset, [, expected]] of Object.entries(SENT))
        expect([preset, shown(aliasOf(preset))]).toEqual([
          preset,
          expect.stringContaining(expected),
        ])
      expect(shown(aliasOf('upload'))).toMatch(/^\/media\/[0-9a-f]{8}\/brochure\.pdf$/)
      expect(shown(aliasOf('image-cropper'))).toContain('/media/')
    } finally {
      await h.db.close().catch(() => {})
    }
  }, 60_000)
})
