/**
 * A change as a bundle (story 383): one change's identity, the changes it
 * depends on, each file and each page it touched with its state before and
 * after, and the media files it added or replaced. It is a private package like
 * any site's export, its manifest typed `change`, and its one integrity hash is
 * taken over the payload and the package's identity, as every bundle's is.
 * docs/changes.md.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { writeBundlePackage } from './package.ts'
import {
  type BundleFile,
  blankedManifest,
  bundleIntegrity,
  MANIFEST_FILE,
  PACKAGE_FILE,
  packageIdentity,
} from './write.ts'

export const CHANGE_FILE = 'change.json'
const CHANGE_FORMAT = 1
const MEDIA_DIR = 'media'

/** A value as a page holds it: one property, language and segment. */
export interface ChangeValue {
  alias: string
  culture: string | null
  segment: string | null
  /** The environment it is for, over the shared value (story 387). */
  environment?: string | null
  value: unknown
}

/** One page, media item or Library item as it stood. */
export interface ChangePageState {
  name: string
  values: ChangeValue[]
  /** Names per language, for a page that varies by language. */
  names?: Record<string, string>
  published: boolean
  /** Story 395: when it goes live and comes down, per language, as the change set it. */
  schedule?: PageSchedule
}

/** A page's schedule: per language, when it is published and unpublished, or none. */
export type PageSchedule = Array<{
  culture: string | null
  publishTime: string | null
  unpublishTime: string | null
}>

export interface ChangeBundlePage {
  key: string
  kind: 'document' | 'media' | 'element' | 'blueprint'
  action: 'create' | 'update' | 'delete'
  parentKey: string | null
  /** Where it was before, when the change moved it. */
  beforeParentKey?: string | null
  /** Story 411: taken out of the recycle bin by the change. */
  restored?: true
  /**
   * Story 425: its parent's children in order where the change made or moved it, itself
   * among them, so it takes the same place where the change is taken.
   */
  siblings?: string[]
  contentTypeKey: string
  contentTypeAlias: string
  componentKey: string | null
  before: ChangePageState | null
  after: ChangePageState | null
  /** The change that last touched it at the source before this one. */
  lastChange: string | null
}

export interface ChangeBundleFile {
  path: string
  kind: string
  class: string
  before: string | null
  after: string | null
  lastChange: string | null
}

export interface ChangeBundle {
  key: string
  name: string | null
  /** Where it was made: a merge, a direct edit, a workspace not yet merged, edits since a point. */
  kind: string
  madeBy: string | null
  createdAt: string
  /** The site it came from, as that site names itself. */
  source: string
  /** Changes it needs: those that made what it touches or refers to. */
  depends: string[]
  files: ChangeBundleFile[]
  pages: ChangeBundlePage[]
  /** Media files it carries, by their address. */
  media: string[]
  /**
   * Story 411: the parents whose children it reordered, with their keys in the new
   * order and the order it found.
   */
  orders?: ChangeOrder[]
}

/** A parent's children reordered by a change (story 411); `parentKey` null: the top level. */
export interface ChangeOrder {
  parentKey: string | null
  keys: string[]
  before: string[]
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const mediaPath = (url: string) => `${MEDIA_DIR}/${url.replace(/^\/media\//, '')}`

/** The change's files, as a private package ready to write or pack. */
export function writeChangeBundle(
  change: ChangeBundle,
  media: ReadonlyMap<string, Uint8Array>,
): BundleFile[] {
  const carried: BundleFile[] = change.media.flatMap((url) => {
    const bytes = media.get(url)
    return bytes ? [{ path: mediaPath(url), bytes }] : []
  })
  const manifest = {
    formatVersion: CHANGE_FORMAT,
    id: change.key,
    bundleType: 'change',
    label: change.name ?? 'A change',
    createdAt: change.createdAt,
    createdBy: change.madeBy,
    integrity: '',
  }
  const payload: BundleFile[] = [
    { path: MANIFEST_FILE, text: json(manifest) },
    {
      path: CHANGE_FILE,
      text: json({ ...change, media: carried.map((f) => f.path.slice(MEDIA_DIR.length + 1)) }),
    },
    ...carried,
  ]
  return writeBundlePackage(payload, {
    name: `change-${change.key}`,
    version: '1.0.0',
    id: change.key,
    label: change.name ?? 'A change',
    private: true,
    peerRange: '*',
    bundleType: 'change',
  })
}

export class ChangeBundleError extends Error {}

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory()
      ? walk(full, root)
      : [relative(root, full).split(sep).join('/')]
  })
}

/** A change bundle read from its directory, refused unless it is whole. */
export function readChangeBundle(dir: string): {
  change: ChangeBundle
  media: Map<string, Uint8Array>
} {
  const manifestFile = join(dir, MANIFEST_FILE)
  const changeFile = join(dir, CHANGE_FILE)
  if (!existsSync(manifestFile) || !existsSync(changeFile))
    throw new ChangeBundleError('It is not a change: it has no bundle.json and change.json.')
  const manifestText = readFileSync(manifestFile, 'utf8')
  const manifest = JSON.parse(manifestText) as { bundleType?: string; integrity?: string }
  if (manifest.bundleType !== 'change')
    throw new ChangeBundleError(`It is a ${manifest.bundleType ?? 'untyped'} bundle, not a change.`)
  const pkgFile = join(dir, PACKAGE_FILE)
  const pkg = existsSync(pkgFile)
    ? (JSON.parse(readFileSync(pkgFile, 'utf8')) as Record<string, unknown>)
    : undefined
  const read: BundleFile[] = walk(dir)
    .filter((path) => path !== MANIFEST_FILE && path !== PACKAGE_FILE)
    .map((path) =>
      path.startsWith(`${MEDIA_DIR}/`)
        ? { path, bytes: new Uint8Array(readFileSync(join(dir, path))) }
        : { path, text: readFileSync(join(dir, path), 'utf8') },
    )
  const integrity = bundleIntegrity(read, {
    manifest: blankedManifest(manifestText, manifest.integrity ?? ''),
    ...(pkg ? { packageIdentity: packageIdentity(pkg) } : {}),
  })
  if (!manifest.integrity || manifest.integrity !== integrity)
    throw new ChangeBundleError('Its files do not match its hash: it is incomplete or was edited.')
  const change = JSON.parse(readFileSync(changeFile, 'utf8')) as ChangeBundle
  const media = new Map<string, Uint8Array>()
  for (const file of read)
    if (file.bytes) media.set(`/media/${file.path.slice(MEDIA_DIR.length + 1)}`, file.bytes)
  change.media = [...media.keys()]
  return { change, media }
}
