/**
 * The bundle format: canonical on the way out, strict on the way in.
 *
 * A bundle is reviewed in a diff and committed, so the same content must
 * serialise the same way every time; and it is copied between machines, so a
 * truncated one has to be refused rather than imported as though it were whole.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_SECTIONS,
  type BundleFile,
  type BundleNode,
  bundleIntegrity,
  type ContentSet,
  loadBundle,
  MANIFEST_FILE,
  MEDIA_MANIFEST,
  mediaUri,
  OLD_LAYOUT,
  referenceCandidates,
  writeBundle,
} from '@crombolo/transfer'

const KEY_A = '9a1f3c2e-5d4f-4d3e-9d6d-2b7f8a1c9e10'
const KEY_B = '3f2a8b1c-1111-4222-8333-444455556666'

function node(overrides: Partial<BundleNode> = {}): BundleNode {
  return {
    key: KEY_A,
    kind: 'document',
    contentType: { key: '0b1c8e3a-4444-4a5b-9c1d-000000000001', alias: 'campaignPage' },
    parent: null,
    sortOrder: 0,
    template: 'campaignPage',
    variants: [{ culture: null, segment: null, name: 'Landing', published: true }],
    values: [
      {
        property: 'title',
        culture: null,
        segment: null,
        editor: 'Umbraco.TextBox',
        value: 'Autumn',
      },
    ],
    ...overrides,
  }
}

function set(nodes: BundleNode[]): ContentSet {
  return {
    manifest: {
      formatVersion: BUNDLE_FORMAT_VERSION,
      id: 'bundle-1',
      createdAt: '2026-10-01T09:12:04.000Z',
      createdBy: 'test',
      integrity: '',
      snapshot: 'published',
      provenance: {
        siteName: 'Test',
        schemaVersion: '1.0.0',
        schemaRevision: '0',
        schemaHash: null,
      },
      selector: { roots: [KEY_A], descendants: true, asGiven: ['/Landing'] },
      counts: { document: nodes.length },
      dependencies: {
        carried: nodes.map((n) => n.key),
        expected: [],
        schema: {
          contentTypes: [{ key: '0b1c8e3a-4444-4a5b-9c1d-000000000001', alias: 'campaignPage' }],
          components: ['campaignPage'],
          languages: [],
        },
      },
      blobs: [],
    },
    nodes,
  }
}

function onDisk(
  content: ContentSet,
  blobs?: Map<string, Uint8Array>,
  sections?: BundleFile[],
): string {
  const dir = mkdtempSync(join('output', 'bundle-'))
  for (const file of writeBundle(content, blobs, sections)) {
    const target = join(dir, file.path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, file.bytes ?? (file.text as string))
  }
  return dir
}

describe('the bundle format', () => {
  test('preserves All members read and No members write in media and folder defaults', () => {
    const mediaAccess = {
      readPolicy: 'members' as const,
      writePolicy: 'none' as const,
      rule: {
        publicRead: false,
        groups: [],
        members: [{ key: KEY_B, read: true, write: false }],
        newRead: 'members' as const,
        newWrite: 'none' as const,
      },
    }
    const dir = onDisk(set([node({ kind: 'media', mediaAccess })]))
    try {
      const loaded = loadBundle(dir)
      expect(loaded.problems).toEqual([])
      expect(loaded.set?.nodes[0]?.mediaAccess).toEqual(mediaAccess)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('writes one file per node, named after its key, plus a manifest', () => {
    const files = writeBundle(set([node(), node({ key: KEY_B })]))
    expect(files.map((f) => f.path)).toEqual([
      MANIFEST_FILE,
      `nodes/${KEY_B}.json`,
      `nodes/${KEY_A}.json`,
    ])
  })

  test('is canonical: the same content always serialises identically', () => {
    // Same node, fields and collections given in a different order.
    const one = node()
    const other = node({
      variants: [{ segment: null, culture: null, published: true, name: 'Landing' }],
      values: [
        {
          segment: null,
          culture: null,
          editor: 'Umbraco.TextBox',
          property: 'title',
          value: 'Autumn',
        },
      ],
    })
    expect(writeBundle(set([one]))).toEqual(writeBundle(set([other])))
  })

  test('passes an editor payload through untouched rather than reordering inside it', () => {
    // A block editor's value is JSON in a string. Rewriting it to sort keys
    // would change somebody else's data for no benefit.
    const payload = '{"zeta":1,"alpha":2}'
    const files = writeBundle(
      set([
        node({
          values: [
            {
              property: 'blocks',
              culture: null,
              segment: null,
              editor: 'Umbraco.BlockList',
              value: payload,
            },
          ],
        }),
      ]),
    )
    expect(files.find((f) => f.path.startsWith('nodes/'))?.text).toContain(JSON.stringify(payload))
  })

  test('round trips through disk', () => {
    const original = set([node(), node({ key: KEY_B, parent: KEY_A, sortOrder: 1 })])
    const dir = onDisk(original)
    try {
      const { set: read, problems } = loadBundle(dir)
      expect(problems).toEqual([])
      expect(read?.nodes).toEqual([...original.nodes].sort((a, b) => a.key.localeCompare(b.key)))
      expect(read?.manifest.selector).toEqual(original.manifest.selector)
      expect(read?.manifest.integrity).toBe(
        bundleIntegrity(writeBundle(original).filter((f) => f.path !== MANIFEST_FILE)),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses a bundle whose node files do not match its integrity', () => {
    const dir = onDisk(set([node(), node({ key: KEY_B })]))
    try {
      // What a half-finished copy looks like.
      rmSync(join(dir, 'nodes', `${KEY_B}.json`))
      const { problems } = loadBundle(dir)
      expect(problems.map((p) => p.message).join(' ')).toContain('integrity does not match')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses a format newer than it understands, and says to upgrade', () => {
    const dir = onDisk(set([node()]))
    try {
      writeFileSync(
        join(dir, MANIFEST_FILE),
        JSON.stringify({ formatVersion: BUNDLE_FORMAT_VERSION + 1 }),
      )
      const { set: read, problems } = loadBundle(dir)
      expect(read).toBeUndefined()
      expect(problems[0]?.message).toContain('upgrade crombolo')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses a bundle in a layout before the current format, and says to rebuild it', () => {
    const dir = onDisk(set([node()]))
    try {
      for (const formatVersion of [1, 2, 3, 4]) {
        writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ formatVersion }))
        const { set: read, problems } = loadBundle(dir)
        expect(read).toBeUndefined()
        expect(problems[0]?.message).toBe(OLD_LAYOUT)
        expect(OLD_LAYOUT).toContain('rebuild it')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('names the file when a node is malformed', () => {
    const dir = onDisk(set([node()]))
    try {
      writeFileSync(join(dir, 'nodes', `${KEY_A}.json`), '{"kind":"document"}')
      const { problems } = loadBundle(dir)
      expect(problems.some((p) => p.file === `nodes/${KEY_A}.json` && p.message === 'no key')).toBe(
        true,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('reports a missing bundle rather than throwing', () => {
    const { set: read, problems } = loadBundle(join('output', 'no-such-bundle'))
    expect(read).toBeUndefined()
    expect(problems[0]?.message).toContain('no bundle at')
  })
})

describe('outbound reference extraction', () => {
  test('finds both spellings, in strings, arrays, objects and JSON in a string', () => {
    expect(referenceCandidates(`umb://document/${KEY_A.replaceAll('-', '')}`)).toEqual([KEY_A])
    expect(referenceCandidates(KEY_A.toUpperCase())).toEqual([KEY_A])
    // An element picker stores a bare Guid[].
    expect(referenceCandidates([KEY_A, KEY_B]).sort()).toEqual([KEY_B, KEY_A].sort())
    expect(referenceCandidates(JSON.stringify([{ mediaKey: KEY_A }]))).toEqual([KEY_A])
    expect(referenceCandidates({ nested: { deeper: [`umb://media/${KEY_B}`] } })).toEqual([KEY_B])
  })

  test('does not mistake a longer hex string for an undashed key', () => {
    // A sha256 is 64 hex characters and contains no key. Matching a bare 32-hex
    // run inside it would invent two references that resolve to nothing.
    const sha = 'a'.repeat(64)
    expect(referenceCandidates(sha)).toEqual([])
    expect(referenceCandidates(`sha256-${sha}`)).toEqual([])
  })

  test('ignores what cannot hold a key', () => {
    expect(referenceCandidates(null)).toEqual([])
    expect(referenceCandidates(42)).toEqual([])
    expect(referenceCandidates('no keys here')).toEqual([])
    expect(referenceCandidates('{not json after all')).toEqual([])
  })
})

describe('the media a bundle carries', () => {
  const BLOB = '3f2a1c9d/hero.jpg'
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
  const withBlob = (): ContentSet => {
    const content = set([node()])
    return {
      ...content,
      manifest: {
        ...content.manifest,
        blobs: [{ key: BLOB, node: KEY_A, etag: null, size: null, included: false }],
      },
    }
  }

  /** `media.json`'s entries, from a written bundle. */
  const listedIn = (files: readonly { path: string; text?: string }[]) =>
    (
      JSON.parse(files.find((file) => file.path === MEDIA_MANIFEST)?.text as string) as {
        files: Array<{ key: string; size: number | null; uri?: string }>
      }
    ).files

  test('writes the bytes under media/, and lists them in media.json with a bundle URI', () => {
    const files = writeBundle(withBlob(), new Map([[BLOB, bytes]]))
    expect(files.find((file) => file.path === `media/${BLOB}`)?.bytes).toEqual(bytes)
    const manifest = JSON.parse(files.find((f) => f.path === MANIFEST_FILE)?.text as string) as {
      mediaManifest?: string
      blobs?: unknown
    }
    // bundle.json holds the hash, so the list lives in a file the hash covers.
    expect(manifest.mediaManifest).toBe(MEDIA_MANIFEST)
    expect(manifest.blobs).toBeUndefined()
    // `included` is decided by whether the bytes were there to write: a carried
    // file has a URI, and its size.
    const [entry] = listedIn(files)
    expect(entry?.uri).toBe(mediaUri(withBlob().manifest.id, BLOB))
    expect(entry?.uri?.startsWith('bundle://')).toBe(true)
    expect(entry?.size).toBe(bytes.length)
  })

  test('lists a file it could not carry without a URI, rather than claiming it', () => {
    const files = writeBundle(withBlob())
    expect(files.some((file) => file.path.startsWith('media/'))).toBe(false)
    expect(listedIn(files)[0]?.uri).toBeUndefined()
  })

  test('encodes a key that is a path or not ASCII, so the URI is a URI', () => {
    expect(mediaUri('kit', '2026/10/κλειδί one.png')).toBe(
      'bundle://kit/media/2026/10/%CE%BA%CE%BB%CE%B5%CE%B9%CE%B4%CE%AF%20one.png',
    )
  })

  test('reads them back, and hands the reader where each one is', () => {
    const dir = onDisk(withBlob(), new Map([[BLOB, bytes]]))
    const loaded = loadBundle(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.blobs.get(BLOB)).toBe(join(dir, 'media', BLOB))
    expect(loaded.set?.manifest.blobs[0]?.included).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('refuses a bundle whose media was edited, or never arrived', () => {
    const dir = onDisk(withBlob(), new Map([[BLOB, bytes]]))
    writeFileSync(join(dir, 'media', BLOB), new Uint8Array([0, 0, 0, 0]))
    // The hash covers the bytes, so including them is a claim the reader checks.
    expect(
      loadBundle(dir)
        .problems.map((p) => p.message)
        .join('\n'),
    ).toContain('integrity')

    rmSync(join(dir, 'media', BLOB))
    const gone = loadBundle(dir)
    expect(gone.problems.map((p) => p.message).join('\n')).toContain('carried')
    rmSync(dir, { recursive: true, force: true })
  })

  test('refuses an edited media.json: the list is inside the hash', () => {
    const dir = onDisk(withBlob(), new Map([[BLOB, bytes]]))
    const text = readFileSync(join(dir, MEDIA_MANIFEST), 'utf8')
    writeFileSync(join(dir, MEDIA_MANIFEST), text.replace(/"size": \d+/, '"size": 1'))
    expect(
      loadBundle(dir)
        .problems.map((p) => p.message)
        .join('\n'),
    ).toContain('integrity')
    rmSync(dir, { recursive: true, force: true })
  })

  test('refuses a file under media/ that media.json does not list', () => {
    const dir = onDisk(withBlob(), new Map([[BLOB, bytes]]))
    writeFileSync(join(dir, 'media', 'stowaway.png'), new Uint8Array([1]))
    const problems = loadBundle(dir).problems
    expect(problems).toContainEqual({
      file: 'media/stowaway.png',
      message: 'this file is not listed in media.json',
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test('reads only files inside the bundle: a URI elsewhere is refused by name', () => {
    const dir = onDisk(withBlob(), new Map([[BLOB, bytes]]))
    const text = readFileSync(join(dir, MEDIA_MANIFEST), 'utf8')
    writeFileSync(
      join(dir, MEDIA_MANIFEST),
      text.replace(/"uri": "[^"]+"/, '"uri": "https://elsewhere.example/a.png"'),
    )
    const messages = loadBundle(dir).problems.map((p) => p.message)
    expect(messages.join('\n')).toContain("not this bundle's own copy")
    rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * A bundle carrying its own structure, which is what a created package is
 * (`docs/bundles.md`). The sections travel under logical names — the
 * destination decides which of its directories each one lands in — and they are
 * declared in the manifest so a reader knows to look for them and the integrity
 * hash covers them.
 */
describe('the sections a bundle can carry', () => {
  const SCHEMA = 'schema/content-types/campaign-page.toml'
  const VIEW = 'components/campaignPage.tsx'
  const sections = (): BundleFile[] => [
    { path: SCHEMA, text: '[content-type]\nalias = "campaignPage"\n' },
    { path: VIEW, text: 'export default () => <h1>Campaign</h1>\n' },
  ]

  test('a content-only bundle is the current format, as every bundle is', () => {
    const files = writeBundle(set([node()]))
    const manifest = JSON.parse(
      files.find((f) => f.path === MANIFEST_FILE)?.text as string,
    ) as Record<string, unknown>
    expect(manifest.formatVersion).toBe(BUNDLE_FORMAT_VERSION)
    expect(manifest.carries).toBeUndefined()
  })

  test('carrying a section declares what is there', () => {
    const files = writeBundle(set([node()]), undefined, sections())
    const manifest = JSON.parse(files.find((f) => f.path === MANIFEST_FILE)?.text as string) as {
      formatVersion: number
      carries: Record<string, string[]>
    }
    expect(manifest.formatVersion).toBe(BUNDLE_FORMAT_VERSION)
    expect(manifest.carries).toEqual({ schema: [SCHEMA], components: [VIEW] })
    expect(files.map((f) => f.path)).toContain(SCHEMA)
  })

  test('reads the sections back, as paths on disk', () => {
    const loaded = loadBundle(onDisk(set([node()]), undefined, sections()))
    expect(loaded.problems).toEqual([])
    expect([...loaded.files.keys()].sort()).toEqual([VIEW, SCHEMA])
    expect(loaded.set?.manifest.carries).toEqual({ schema: [SCHEMA], components: [VIEW] })
  })

  test('the integrity hash covers them, so an edited view is refused', () => {
    const dir = onDisk(set([node()]), undefined, sections())
    writeFileSync(join(dir, VIEW), 'export default () => <h1>Tampered</h1>\n')
    const loaded = loadBundle(dir)
    expect(loaded.problems.map((p) => p.message).join(' ')).toContain('integrity does not match')
  })

  test('a declared file that is not there is reported, as a missing blob is', () => {
    const dir = onDisk(set([node()]), undefined, sections())
    rmSync(join(dir, SCHEMA))
    const loaded = loadBundle(dir)
    expect(loaded.problems).toContainEqual({
      file: SCHEMA,
      message: 'the manifest says this file is carried, and it is not',
    })
  })

  test('a file in no known section is refused rather than written undeclared', () => {
    expect(() =>
      writeBundle(set([node()]), undefined, [{ path: 'elsewhere/x.txt', text: 'x' }]),
    ).toThrow(/not in a bundle section/)
  })

  /** A manifest is a file that travelled, so what it names is read, never trusted. */
  test('a declared path that climbs out of the bundle is dropped', () => {
    const dir = onDisk(set([node()]), undefined, sections())
    const manifestFile = join(dir, MANIFEST_FILE)
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
    manifest.carries = { schema: ['schema/../../etc/passwd'] }
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2))
    const loaded = loadBundle(dir)
    expect([...loaded.files.keys()]).toEqual([])
  })

  test('a format newer than this version understands is refused by name', () => {
    const dir = onDisk(set([node()]), undefined, sections())
    const manifestFile = join(dir, MANIFEST_FILE)
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
    manifest.formatVersion = BUNDLE_FORMAT_VERSION + 1
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2))
    const loaded = loadBundle(dir)
    expect(loaded.set).toBeUndefined()
    expect(loaded.problems.map((p) => p.message).join(' ')).toContain('upgrade crombolo')
  })

  test('every section a bundle may carry has a directory of its own', () => {
    const paths = Object.values(BUNDLE_SECTIONS)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('schema')
    expect(paths).toContain('components')
  })
})
