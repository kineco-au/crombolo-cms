/**
 * Settings → Developers → Schema (story 342): the site's schema folder
 * downloaded as TOML, and schema files uploaded from elsewhere, held until an
 * administrator approves them on the Changes dashboard.
 *
 * An upload changes nothing. It is checked against the site, laid over a copy
 * of `schema/`, and kept in `key_value` with its findings in the change report,
 * so any node can show and apply it. Applying writes the files into `schema/`
 * and runs the sync a deploy runs, putting the files back if the sync refuses.
 * Only TOML in the folder's own layout is taken: `migrations/` is code, and an
 * upload never brings code.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import {
  type Db,
  type Finding,
  Locks,
  type NodeSchemaState,
  now,
  readReport,
  writeReport,
} from '@crombolo/data'
import {
  loadSchemaDirectory,
  nextSchemaVersion,
  parseSchemaSettings,
  type SyncReport,
  TYPE_KIND_FILES,
  validateSchemaSet,
  writeSchemaVersion,
} from '@crombolo/schema'
import { recordAudit } from './adapters/audit.ts'
import type { CromboloConfig } from './config.ts'
import { formTypesFor } from './form-types.ts'
import { checkSchemaDirectory, importSchema } from './schema.ts'
import { publishSchema, type SchemaStore } from './schema-store.ts'
import { parseWebhookFile } from './webhook-files.ts'
import { readZip, writeZip, ZipError } from './zip.ts'

const KEY = 'crombolo:schema-import'
const SCOPE = 'schema'

/** Bounds on an upload, well past any real site's schema. */
export const UPLOAD_LIMITS = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxEntries: 2000,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
}

/** Folders whose files sit directly inside them, by the table each file starts with. */
const FLAT: Record<string, string> = {
  [TYPE_KIND_FILES.document.dir]: TYPE_KIND_FILES.document.header,
  [TYPE_KIND_FILES.media.dir]: TYPE_KIND_FILES.media.header,
  [TYPE_KIND_FILES.member.dir]: TYPE_KIND_FILES.member.header,
  'data-types': 'data-type',
  'user-groups': 'user-group',
  webhooks: 'webhook',
}
/** Forms and workflows may sit in folders of their own (story 289). */
const DEEP: Record<string, string> = { forms: 'form', workflows: 'workflow' }
const TOP = ['schema.toml', 'languages.toml']

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Where a file belongs in `schema/`, or undefined when the layout has no place for it. */
export function schemaPathOf(path: string): string | undefined {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean)
  if (parts[0] === 'schema') parts.shift()
  if (parts.length === 0 || !parts.every((part) => SEGMENT.test(part))) return undefined
  const name = parts.at(-1) as string
  if (!name.endsWith('.toml')) return undefined
  if (parts.length === 1) return TOP.includes(name) ? name : undefined
  const [folder = ''] = parts
  if (folder in FLAT && parts.length === 2) return parts.join('/')
  if (folder in DEEP) return parts.join('/')
  return undefined
}

/**
 * Where a lone `.toml` goes: the folder its first table names, as the file
 * already there with the same alias, or under its own name when it is new.
 */
function placeLoose(
  fileName: string,
  text: string,
  current: ReadonlyMap<string, string>,
): string | undefined {
  const name = fileName.replaceAll('\\', '/').split('/').at(-1) ?? ''
  if (TOP.includes(name)) return name
  const table = /^\s*\[([a-z-]+)\]/m.exec(text)?.[1]
  const folder = Object.entries({ ...FLAT, ...DEEP }).find(([, header]) => header === table)?.[0]
  if (!folder) return undefined
  const alias = aliasOf(text)
  const same = alias
    ? [...current].find(
        ([path, existing]) => path.startsWith(`${folder}/`) && aliasOf(existing) === alias,
      )
    : undefined
  if (same) return same[0]
  return SEGMENT.test(name) && name.endsWith('.toml') ? `${folder}/${name}` : undefined
}

const aliasOf = (text: string) => /^\s*alias\s*=\s*"([^"]+)"/m.exec(text)?.[1]

/** Every TOML file under `dir`, by its `/`-separated path in it. */
function schemaFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (at: string) => {
    if (!existsSync(at)) return
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const rel = relative(dir, path).split(sep).join('/')
        if (schemaPathOf(rel) === rel) out.set(rel, readFileSync(path, 'utf8'))
      }
    }
  }
  walk(dir)
  return out
}

export interface SchemaActor {
  id: string | null
  name: string
  ipAddress?: string | null
}

interface Pending {
  fileName: string
  files: Record<string, string>
  added: string[]
  changed: string[]
  uploadedBy: string
  uploadedAt: string
}

/** A waiting import, as the Changes dashboard shows it. */
export interface PendingSchemaImportView {
  fileName: string
  added: string[]
  changed: string[]
  uploadedBy: string
  uploadedAt: string
  /** A finding stops it until the files change. */
  blocked: boolean
}

export type SchemaOutcome<T = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; message: string; problems?: string[] }

const refused = (status: number, message: string, problems?: string[]) =>
  ({ ok: false, status, message, ...(problems ? { problems } : {}) }) as const

export function createSchemaTransfer(
  db: Db,
  config: CromboloConfig,
  options: {
    boot: { nodeId: string; nodeState: NodeSchemaState }
    /** What the server does after any schema sync: caches, redirects. */
    afterApply?: (report: SyncReport | undefined) => Promise<void>
  },
) {
  const audit = (actor: SchemaActor, action: string, detail: string) =>
    recordAudit(db, {
      category: 'schema',
      action,
      entityType: 'Schema',
      entityName: 'Schema',
      detail,
      source: 'request',
      userKey: actor.id,
      userName: actor.name,
      ipAddress: actor.ipAddress ?? null,
      forwardedFor: null,
    })

  async function read(): Promise<Pending | undefined> {
    const row = await db.q
      .selectFrom('key_value')
      .select('value')
      .where('key', '=', KEY)
      .executeTakeFirst()
    try {
      return row?.value ? (JSON.parse(row.value) as Pending) : undefined
    } catch {
      return undefined
    }
  }

  async function write(pending: Pending | undefined): Promise<void> {
    await db.q.deleteFrom('key_value').where('key', '=', KEY).execute()
    if (pending)
      await db.q
        .insertInto('key_value')
        .values({ key: KEY, value: JSON.stringify(pending), update_date: now(db) })
        .execute()
  }

  /** The site's schema version and its `schema.toml` as it stands. */
  function currentSettings() {
    const file = join(config.schemaDir, 'schema.toml')
    const text = existsSync(file) ? readFileSync(file, 'utf8') : undefined
    const parsed = text ? parseSchemaSettings('schema.toml', text).value : undefined
    return { text, version: parsed?.version ?? '1.0.0', urls: parsed?.urls }
  }

  /**
   * An uploaded `schema.toml` brings its URL settings, never its version: another
   * site's number says nothing about this one. Undefined when it changes nothing.
   */
  function settingsFrom(text: string): string | undefined {
    const current = currentSettings()
    const parsed = parseSchemaSettings('schema.toml', text)
    if (!parsed.value) return text
    const written = writeSchemaVersion(current.version, parsed.value.urls)
    return written === writeSchemaVersion(current.version, current.urls) ? undefined : written
  }

  /**
   * The upload's files laid over a copy of `schema/`, checked as a deploy would
   * check them. A change needs a new version, so the version is raised as far as
   * the change needs, as the back office raises it for a type it saves, and
   * `schemaToml` is the file to write with it.
   */
  async function check(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'crombolo-import-'))
    try {
      if (existsSync(config.schemaDir)) cpSync(config.schemaDir, dir, { recursive: true })
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), text)
      }
      const formTypes = formTypesFor(config)
      const loaded = loadSchemaDirectory(dir, { formTypes })
      const problems = [...loaded.problems, ...validateSchemaSet(loaded.set, { types: formTypes })]
        .map((p) => `${p.file}${p.path ? ` (${p.path})` : ''}: ${p.message}`)
        .map((line) => line.replaceAll(dir, 'schema'))
      for (const [path, text] of Object.entries(files))
        if (path.startsWith('webhooks/'))
          problems.push(...parseWebhookFile(path, text).problems.map((p) => `${path}: ${p}`))
      if (problems.length > 0) return { problems, findings: [] as Finding[], schemaToml: undefined }
      const run = () =>
        checkSchemaDirectory(
          db,
          { ...config, schemaDir: dir },
          { nodeId: options.boot.nodeId, revision: config.schemaRevision },
          { migrationsDir: config.schemaDir },
        )
      // The sync refuses a change that keeps its version, and then says nothing of
      // how big it is, so the first pass is under a provisional raise.
      const current = currentSettings()
      const settings = (version: string) => {
        const text = writeSchemaVersion(version, loaded.set.urls)
        writeFileSync(join(dir, 'schema.toml'), text)
        return text
      }
      settings(nextSchemaVersion(current.version, 'additive'))
      const first = await run()
      const next = nextSchemaVersion(current.version, first.classification)
      const schemaToml = settings(next)
      const findings =
        next === nextSchemaVersion(current.version, 'additive')
          ? first.findings
          : (await run()).findings
      return {
        problems: [] as string[],
        findings,
        schemaToml: schemaToml === current.text ? undefined : schemaToml,
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const blocking = (findings: readonly Finding[]) => findings.some((f) => f.kind === 'blocking')

  return {
    /** Every TOML file in `schema/`, as a zip that unpacks to a `schema` folder. */
    exportZip(): Uint8Array<ArrayBuffer> {
      const encoder = new TextEncoder()
      return writeZip(
        [...schemaFiles(config.schemaDir)]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([path, text]) => ({ path: `schema/${path}`, bytes: encoder.encode(text) })),
      )
    },

    async pending(): Promise<PendingSchemaImportView | undefined> {
      const pending = await read()
      if (!pending) return undefined
      const open = await readReport(db, { source: 'import', scope: SCOPE })
      return {
        fileName: pending.fileName,
        added: pending.added,
        changed: pending.changed,
        uploadedBy: pending.uploadedBy,
        uploadedAt: pending.uploadedAt,
        blocked: open.some((f) => f.status === 'open' && f.kind === 'blocking'),
      }
    },

    /** Checks an upload and keeps it for approval; nothing in `schema/` changes. */
    async upload(
      actor: SchemaActor,
      fileName: string,
      bytes: Uint8Array,
    ): Promise<SchemaOutcome<{ added: string[]; changed: string[] }>> {
      if (!config.schemaWritable)
        return refused(
          409,
          "This site's schema changes only with a deploy, so it can't be imported here.",
        )
      if (bytes.length > UPLOAD_LIMITS.maxUploadBytes)
        return refused(413, 'That file is too large to be a schema.')
      const files: Record<string, string> = {}
      const outside: string[] = []
      const decoder = new TextDecoder('utf-8', { fatal: true })
      try {
        if (/\.toml$/i.test(fileName)) {
          const text = decoder.decode(bytes)
          const path = placeLoose(fileName, text, schemaFiles(config.schemaDir))
          if (!path) outside.push(fileName)
          else files[path] = text
        } else {
          for (const entry of readZip(bytes, UPLOAD_LIMITS)) {
            const path = schemaPathOf(entry.path)
            if (!path) outside.push(entry.path)
            else files[path] = decoder.decode(entry.bytes)
          }
        }
      } catch (error) {
        if (error instanceof ZipError) return refused(400, error.message)
        return refused(400, 'A file in it is not readable text.')
      }
      if (outside.length > 0)
        return refused(
          400,
          'Only schema files can be imported: TOML, in the folders a schema folder has.',
          outside.slice(0, 20).map((path) => `${path}: not a schema file`),
        )

      if ('schema.toml' in files) {
        const settings = settingsFrom(files['schema.toml'] as string)
        if (settings === undefined) delete files['schema.toml']
        else files['schema.toml'] = settings
      }
      const current = schemaFiles(config.schemaDir)
      const added = Object.keys(files).filter((path) => !current.has(path))
      const changed = Object.keys(files).filter(
        (path) => current.has(path) && current.get(path) !== files[path],
      )
      if (added.length + changed.length === 0)
        return refused(
          400,
          'Every file in it is already the same here, so there is nothing to import.',
        )
      const kept = Object.fromEntries([...added, ...changed].map((path) => [path, files[path]]))
      const { problems, findings } = await check(kept as Record<string, string>)
      if (problems.length > 0)
        return refused(400, "These files can't be used as they are.", problems.slice(0, 50))

      await write({
        fileName,
        files: kept as Record<string, string>,
        added: added.sort(),
        changed: changed.sort(),
        uploadedBy: actor.name,
        uploadedAt: new Date().toISOString(),
      })
      await writeReport(db, findings, { source: 'import', scope: SCOPE })
      await audit(
        actor,
        'Upload',
        `${fileName}: ${describe(added, changed)}, waiting for approval${blocking(findings) ? ' (blocked)' : ''}`,
      )
      return { ok: true, added: added.sort(), changed: changed.sort() }
    },

    /** Writes the waiting files into `schema/` and syncs them, once nothing blocks it. */
    async apply(actor: SchemaActor): Promise<SchemaOutcome<{ action?: string }>> {
      const pending = await read()
      if (!pending) return refused(404, 'There is no schema import waiting.')
      if (!config.schemaWritable)
        return refused(
          409,
          "This site's schema changes only with a deploy, so it can't be imported here.",
        )
      // Checked again: the site may have changed since the upload.
      const { problems, findings, schemaToml } = await check(pending.files)
      if (problems.length > 0)
        return refused(409, 'The site has changed, and these files no longer fit it.', problems)
      await writeReport(db, findings, { source: 'import', scope: SCOPE })
      if (blocking(findings))
        return refused(
          409,
          'Something on the Changes dashboard stops this import. Discard it, or fix the files and upload them again.',
        )

      const before = new Map<string, string | undefined>()
      await db.locks.withLock(Locks.Schema, async () => {
        const writes = { ...pending.files, ...(schemaToml ? { 'schema.toml': schemaToml } : {}) }
        for (const [path, text] of Object.entries(writes)) {
          const target = join(config.schemaDir, path)
          before.set(path, existsSync(target) ? readFileSync(target, 'utf8') : undefined)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, text)
        }
      })
      const result = await importSchema(db, config, options.boot, { materialise: false })
      if (result.report?.action === 'refused') {
        await db.locks.withLock(Locks.Schema, async () => {
          for (const [path, text] of before) {
            const target = join(config.schemaDir, path)
            if (text === undefined) rmSync(target, { force: true })
            else writeFileSync(target, text)
          }
        })
        return refused(
          409,
          `The import was refused, and the schema is as it was: ${result.report.reason ?? 'see the server log'}.`,
        )
      }
      if (config.schemaStore)
        await publishSchema(config.schemaStore as SchemaStore, config.schemaDir)
      await options.afterApply?.(result.report)
      await write(undefined)
      await writeReport(db, [], { source: 'import', scope: SCOPE })
      await audit(
        actor,
        'Apply',
        `${pending.fileName}: ${describe(pending.added, pending.changed)} (${[...pending.added, ...pending.changed].join(', ')})`,
      )
      return { ok: true, action: result.report?.action }
    },

    async discard(actor: SchemaActor): Promise<SchemaOutcome> {
      const pending = await read()
      if (!pending) return refused(404, 'There is no schema import waiting.')
      await write(undefined)
      await writeReport(db, [], { source: 'import', scope: SCOPE })
      await audit(
        actor,
        'Discard',
        `${pending.fileName}: ${describe(pending.added, pending.changed)}`,
      )
      return { ok: true }
    },
  }
}

const describe = (added: readonly string[], changed: readonly string[]) =>
  [
    added.length > 0 ? `${added.length} new file${added.length === 1 ? '' : 's'}` : '',
    changed.length > 0 ? `${changed.length} changed file${changed.length === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' and ')
