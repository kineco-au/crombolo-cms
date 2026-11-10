/**
 * A written bundle as the npm package every bundle is: `bundle.json` at the
 * root beside `package.json`, and everything it carries beside them, under its
 * one hash (story 193). `docs/bundles.md`.
 *
 * The payload is `writeBundle`'s output unchanged. The package is what gives
 * it a name, a version and a core it was written for.
 */
import type { BundleType } from './model.ts'
import { PEOPLE_DIR } from './people.ts'
import { SITE_DATA_DIR } from './site-data.ts'
import {
  type BundleFile,
  blankedManifest,
  bundleIntegrity,
  MANIFEST_FILE,
  PACKAGE_FILE,
  packageIdentity,
} from './write.ts'

/** The npm keyword a bundle publishes so the marketplace can find it. */
export const BUNDLE_KEYWORD = 'crombolo-extension'

export interface BundlePackageInfo {
  /** The npm package name. */
  name: string
  version: string
  /** `crombolo.id`. */
  id: string
  /** `crombolo.name`, what a person calls it. */
  label: string
  description?: string
  /** A package that is never published: an environment's export. */
  private?: boolean
  /** The range on `@crombolo/crombolo` it is written for. */
  peerRange: string
  /** A site package or an extension (story 306); a site package is always private. */
  bundleType: BundleType
  /**
   * An extension's code (story 312): its files under `src/`, outside the
   * payload, the factory `crombolo.server` names, and the permissions it asks
   * for, each with its reason.
   */
  code?: {
    files: readonly BundleFile[]
    entry: string
    server: string
    permissions: Readonly<Record<string, string>>
  }
}

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Lowercase words joined by hyphens, from whatever someone named a thing. */
const slug = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * The core versions a bundle crombolo writes can be installed on: this release
 * or any later one. A newer node reads every older bundle format, so a later
 * release is never a reason to refuse one; an older node is turned away here,
 * by name, before it meets a format it cannot read. Not `^`: before 1.0 a caret
 * pins the minor, and an environment one minor ahead would refuse its own
 * preview's export.
 */
export const bundlePeerRange = (coreVersion: string): string => `>=${coreVersion}`

/** A name npm would accept. */
export function isPackageName(name: string): boolean {
  return NPM_NAME.test(name) && name.length <= 214
}

/** A bundle id, 2–39 characters, derived from a name: what an unset definition defaults to. */
export function bundleIdFor(text: string): string {
  let id = slug(text).replace(/^[^a-z]+/, '')
  if (id.length < 2) id = `bundle-${id}`.replace(/-$/, '')
  return id.slice(0, 39).replace(/-+$/, '')
}

/** An unscoped package name derived from a name. */
export function packageNameFor(text: string): string {
  return bundleIdFor(text)
}

/** What `files` lists for a payload: the manifest and each top-level entry it carries. */
export function packageFilesFor(paths: Iterable<string>): string[] {
  const top = new Set<string>([MANIFEST_FILE])
  for (const path of paths) top.add(path.split('/')[0] as string)
  return [...top].sort()
}

/** The `package.json` a bundle package is written with, for a payload at these paths. */
export function bundlePackageJson(
  info: BundlePackageInfo,
  paths: Iterable<string>,
): Record<string, unknown> {
  return {
    name: info.name,
    version: info.version,
    ...(info.description ? { description: info.description } : {}),
    ...(info.private ? { private: true } : { keywords: [BUNDLE_KEYWORD] }),
    ...(info.code ? { exports: { '.': `./${info.code.entry}` } } : {}),
    files: packageFilesFor([...paths, ...(info.code?.files.map((file) => file.path) ?? [])]),
    peerDependencies: { '@crombolo/crombolo': info.peerRange },
    crombolo: {
      id: info.id,
      name: info.label,
      bundleType: info.bundleType,
      content: true,
      ...(info.code
        ? { server: info.code.server, schemaVersion: 4, permissions: { ...info.code.permissions } }
        : {}),
    },
  }
}

/** A payload's files, with the `package.json` that makes them a package. */
export function writeBundlePackage(
  payload: readonly BundleFile[],
  info: BundlePackageInfo,
): BundleFile[] {
  if (!isPackageName(info.name)) throw new Error(`"${info.name}" is not a package name npm accepts`)
  if (info.code && info.bundleType !== 'extension')
    throw new Error("Only an extension carries code of its own: a site package's is its payload.")
  if (info.code?.files.some((file) => !file.path.startsWith('src/')))
    throw new Error("An extension's code is under src/.")
  if (info.bundleType === 'site' && !info.private)
    throw new Error('A site package is never published: it can only be a private package.')
  // Personal data never goes where `npm publish` can take it, sealed or not;
  // and sealed content would be no use to anyone who installed it.
  if (!info.private && payload.some((file) => file.path.startsWith(`${PEOPLE_DIR}/`)))
    throw new Error('A bundle that carries members or users can only be a private package.')
  if (!info.private && payload.some((file) => file.path.startsWith(`${SITE_DATA_DIR}/`)))
    throw new Error("A bundle that carries the site's own data can only be a private package.")
  if (!info.private && payload.some((file) => file.path.startsWith('values/')))
    throw new Error('A bundle whose content is encrypted can only be a private package.')
  const pkg = bundlePackageJson(
    info,
    payload.map((file) => file.path),
  )
  return [
    { path: PACKAGE_FILE, text: `${JSON.stringify(pkg, null, 2)}\n` },
    ...rehashed(payload, pkg),
    ...(info.code?.files ?? []),
  ]
}

/**
 * The payload with its manifest's hash taken again over the package's identity
 * too, now that there is one (story 306). Files a caller streams in after the
 * hash, the public files, carry a `source` and are left out of it as before.
 */
function rehashed(payload: readonly BundleFile[], pkg: Record<string, unknown>): BundleFile[] {
  const manifest = payload.find((file) => file.path === MANIFEST_FILE)
  if (!manifest?.text) throw new Error('A bundle package needs its bundle.json.')
  const parsed = JSON.parse(manifest.text) as { integrity?: string; bundleType?: string }
  const crombolo = pkg.crombolo as { bundleType: string }
  if (parsed.bundleType && parsed.bundleType !== crombolo.bundleType)
    throw new Error(
      `bundle.json says it is a ${parsed.bundleType} bundle, and package.json a ${crombolo.bundleType} one.`,
    )
  // Written where `writeManifest` puts it, straight after the id.
  const typed = parsed.bundleType
    ? manifest.text
    : manifest.text.replace(
        /\n {2}"id": ("[^"\n]*"),\n/,
        (line) => `${line}  "bundleType": ${JSON.stringify(crombolo.bundleType)},\n`,
      )
  const blank = blankedManifest(typed, parsed.integrity ?? '')
  const integrity = bundleIntegrity(
    payload.filter((file) => file.text !== undefined || file.bytes !== undefined),
    { manifest: blank, packageIdentity: packageIdentity(pkg) },
  )
  const text = blank.replace('"integrity": ""', `"integrity": ${JSON.stringify(integrity)}`)
  return payload.map((file) => (file.path === MANIFEST_FILE ? { ...file, text } : file))
}
