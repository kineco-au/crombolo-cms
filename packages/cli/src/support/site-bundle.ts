/**
 * A site bundle as `changes stage` sends it (story 399): a `.tgz` as it is, an exported
 * bundle's folder packed, or a site's checkout made into a whole-site bundle of its
 * files, its definitions, components, stylesheets and scripts, with no pages. A checkout
 * needs no database: what it carries is what its folders hold.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  type DictionaryEntry,
  dictionaryKey,
  readDictionaryToml,
  type UdtItem,
  writeNpmTarball,
  writeUdtAll,
} from '@crombolo/server'
import {
  BUNDLE_FORMAT_VERSION,
  type BundleFile,
  bundleIdFor,
  type ContentSet,
  packageNameFor,
  writeBundle,
  writeBundlePackage,
} from '@crombolo/transfer'

/** A checkout's folders, by the section each is carried as. */
const SECTIONS: ReadonlyArray<{ section: string; folders: readonly string[] }> = [
  { section: 'schema', folders: ['schema'] },
  { section: 'components', folders: ['components'] },
  { section: 'styles', folders: ['styles', 'stylesheets'] },
  { section: 'scripts', folders: ['scripts'] },
]

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else out.push(path)
  }
  return out.sort()
}

/** A checkout's files as a whole-site bundle's sections. */
export function checkoutSections(dir: string): BundleFile[] {
  const out: BundleFile[] = []
  for (const { section, folders } of SECTIONS)
    for (const folder of folders) {
      const root = join(dir, folder)
      if (!existsSync(root)) continue
      for (const file of filesUnder(root))
        out.push({
          path: `${section}/${relative(root, file).split(sep).join('/')}`,
          text: readFileSync(file, 'utf8'),
        })
      break
    }
  // Story 402: the dictionary a person keeps by hand, carried as a whole site's is.
  const toml = join(dir, 'dictionary.toml')
  if (existsSync(toml))
    out.push({ path: 'dictionary.udt', text: dictionaryUdtOf(readFileSync(toml, 'utf8')) })
  return out
}

/**
 * A checkout's `dictionary.toml` as a bundle carries a dictionary: each item keyed as
 * every site keys an item of that name, which the site matches to its own by name.
 */
export function dictionaryUdtOf(text: string): string {
  const { entries, problems } = readDictionaryToml(text)
  if (problems.length > 0)
    throw new Error(
      `dictionary.toml cannot be read: ${problems.map((p) => `${p.path.join('.')}: ${p.message}`).join('; ')}`,
    )
  const udt = (entry: DictionaryEntry): UdtItem => ({
    key: dictionaryKey(entry.name),
    name: entry.name,
    translations: entry.translations,
    children: entry.children.map(udt),
  })
  return writeUdtAll(entries.map(udt))
}

/** A checkout as a whole-site bundle of its files, packed. */
export function packCheckout(dir: string, name: string): Uint8Array {
  const sections = checkoutSections(dir)
  if (!sections.some((f) => f.path.startsWith('schema/')))
    throw new Error(`${dir} holds no schema folder: it is not a site's checkout.`)
  const set: ContentSet = {
    manifest: {
      formatVersion: BUNDLE_FORMAT_VERSION,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createdBy: 'crombolo changes stage',
      integrity: '',
      snapshot: 'published',
      provenance: { siteName: name, schemaVersion: '', schemaRevision: '', schemaHash: null },
      selector: { roots: [], descendants: false, asGiven: [] },
      counts: {},
      dependencies: {
        carried: [],
        expected: [],
        schema: { contentTypes: [], components: [], languages: [] },
      },
      blobs: [],
      scope: 'site',
    },
    nodes: [],
  }
  const packageName = packageNameFor(`${name}-site`)
  const files = writeBundlePackage(writeBundle(set, new Map(), sections, { bundleType: 'site' }), {
    name: packageName,
    version: '1.0.0',
    id: bundleIdFor(packageName),
    label: `${name} (checkout)`,
    private: true,
    peerRange: '>=0.0.0',
    bundleType: 'site',
  })
  return pack(files)
}

const pack = (files: readonly BundleFile[]) => {
  const encoder = new TextEncoder()
  return writeNpmTarball(
    files.map((file) => ({
      path: file.path,
      bytes: file.bytes ?? encoder.encode(file.text ?? ''),
    })),
  )
}

/** What `changes stage` sends for `path`: a file as it is, a folder packed or built. */
export function siteBundleBytes(path: string, name: string): Uint8Array {
  if (!statSync(path).isDirectory()) return new Uint8Array(readFileSync(path))
  if (existsSync(join(path, 'bundle.json')) && existsSync(join(path, 'package.json')))
    return pack(
      filesUnder(path).map((file) => ({
        path: relative(path, file).split(sep).join('/'),
        bytes: new Uint8Array(readFileSync(file)),
      })),
    )
  return packCheckout(path, name)
}
