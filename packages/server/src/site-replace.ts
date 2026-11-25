/**
 * Replacing a site with a whole-site file (story 105): what has to be true
 * before it starts, and what the site has that the file does not.
 *
 * `--replace` recycles content and media the file does not carry, so a revert
 * brings them back, and keeps the site's people. `--replace-all` deletes them,
 * and the members and users the file does not carry too.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { discoverBundles } from '@crombolo/backoffice-host/registry'
import {
  currentSchemaState,
  type Db,
  DocumentRepository,
  MemberRepository,
  ObjectTypes,
  TransferRunRepository,
  UserRepository,
} from '@crombolo/data'
import { loadSchemaDirectory, syncSchema } from '@crombolo/schema'
import type { BundleManifest, BundlePeople, ContentSet } from '@crombolo/transfer'
import { type CarriedSections, stagedConfig, stageSections } from './bundle-sections.ts'
import type { CromboloConfig } from './config.ts'
import { formTypesFor } from './form-types.ts'
import { syncOptionsFor } from './schema.ts'

export type ReplaceMode = 'replace' | 'replace-all'

/**
 * The server bundles a file needs and this site lacks, or has older, each
 * named with the version wanted.
 */
export function requiresProblems(manifest: BundleManifest, siteDir: string): string[] {
  const required = Object.entries(manifest.requires ?? {})
  if (required.length === 0) return []
  const installed = new Map(
    discoverBundles(siteDir).bundles.map((found) => [found.packageName, found.version]),
  )
  const problems: string[] = []
  for (const [name, version] of required) {
    const here = installed.get(name)
    if (!here) problems.push(`the file needs ${name}@${version}, which this site does not have`)
    else if (Bun.semver.order(here, version) < 0)
      problems.push(`the file needs ${name}@${version}, and this site has ${here}`)
  }
  return problems
}

/** Whether the file's people include someone who can administer the back office. */
export function carriesAdministrator(people: BundlePeople | undefined): boolean {
  return (people?.users ?? []).some((user) => !user.disabled && user.groupAliases.includes('admin'))
}

const PRUNED_KINDS = [
  { objectType: ObjectTypes.Document, kind: 'document' },
  { objectType: ObjectTypes.Media, kind: 'media' },
  { objectType: ObjectTypes.Element, kind: 'element' },
  { objectType: ObjectTypes.DocumentBlueprint, kind: 'blueprint' },
] as const

export interface PrunedNode {
  key: string
  kind: (typeof PRUNED_KINDS)[number]['kind']
  head: number | undefined
  published: number | undefined
}

/**
 * Takes out what the site has and the file does not: the topmost of each such
 * branch, recycled or deleted, inside the caller's transaction. Answers what
 * was recycled, for the run to record so its revert can bring it back.
 */
export async function pruneSite(
  tx: Db,
  set: ContentSet,
  mode: ReplaceMode,
  nodeId: string,
): Promise<PrunedNode[]> {
  const inFile = new Set(set.nodes.map((node) => node.key.toLowerCase()))
  const state = await currentSchemaState(tx)
  const nodeState = { version: state.version, revision: state.revision }
  const pruned: PrunedNode[] = []
  for (const { objectType, kind } of PRUNED_KINDS) {
    const rows = await tx.q
      .selectFrom('node')
      .select(['id', 'unique_id', 'parent_id'])
      .where('node_object_type', '=', objectType)
      .where('trashed', '=', tx.dialect.boolValue(false) as boolean)
      .execute()
    const leaving = rows.filter((row) => !inFile.has(String(row.unique_id).toLowerCase()))
    const leavingIds = new Set(leaving.map((row) => Number(row.id)))
    // The top of each branch: recycling or deleting it takes its children too.
    const tops = leaving.filter((row) => !leavingIds.has(Number(row.parent_id)))
    const repo = new DocumentRepository(tx, { kind, nodeState, nodeId, inTreeLock: true })
    for (const row of tops) {
      const key = String(row.unique_id)
      if (mode === 'replace-all') {
        await repo.delete(key)
        continue
      }
      const markers = await repo.eventMarkers(key)
      await repo.moveToRecycleBin(key)
      pruned.push({ key, kind, head: markers?.head, published: markers?.published })
    }
  }
  return pruned
}

/** Members and users the file does not carry, deleted: `--replace-all` only. */
export async function prunePeople(tx: Db, people: BundlePeople | undefined): Promise<void> {
  const members = new Set((people?.members ?? []).map((m) => m.key.toLowerCase()))
  const users = new Set((people?.users ?? []).map((u) => u.key.toLowerCase()))
  const state = await currentSchemaState(tx)
  const memberRepo = new MemberRepository(tx, {
    nodeState: { version: state.version, revision: state.revision },
  })
  const memberRows = await tx.q
    .selectFrom('node')
    .select('unique_id')
    .where('node_object_type', '=', ObjectTypes.Member)
    .execute()
  for (const row of memberRows)
    if (!members.has(String(row.unique_id).toLowerCase()))
      await memberRepo.delete(String(row.unique_id))
  const userRepo = new UserRepository(tx)
  for (const row of await tx.q.selectFrom('user_account').select('key').execute())
    if (!users.has(String(row.key).toLowerCase())) await userRepo.delete(String(row.key))
}

/** Records what a replace recycled on its run, so `content revert` brings it back. */
export async function recordPruned(tx: Db, runId: string, pruned: PrunedNode[]): Promise<void> {
  const runs = new TransferRunRepository(tx)
  for (const node of pruned)
    await runs.record({
      runId,
      nodeKey: node.key,
      kind: node.kind,
      action: 'recycle',
      beforeEventId: node.head ?? null,
      beforePublishedEventId: node.published ?? null,
      eventId: null,
    })
}

/** Why a replace from a file with no schema is refused (story 424). */
export const NO_SCHEMA =
  'this file carries no schema, and this site has one: replacing the site with it would retire every type it has; export it from a site that has its schema files'

/** Story 424: what a replace would do to the site's schema, which it takes whatever its version. */
export interface ReplaceSchema {
  /** The site's schema version, and the file's, which the site would be at. */
  from: string
  to: string
  /** Types the site has that the file does not: retired, though pages of them existed. */
  retiredTypes: string[]
  /** Why the file's schema would not be applied. */
  refused?: string
}

/** Read-only: the file's schema staged apart and synced as a replace would, then undone. */
export async function replaceSchema(
  db: Db,
  config: CromboloConfig,
  carried: CarriedSections,
): Promise<ReplaceSchema> {
  const from = (await currentSchemaState(db)).version
  // One with no schema is held to the version rules, or it would retire every type.
  const carriesSchema = (carried.carries.schema ?? []).length > 0
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-replace-check-'))
  try {
    const staged = stagedConfig(config, stageSections(config, carried, { replace: true }, dir))
    const loaded = loadSchemaDirectory(staged.schemaDir, { formTypes: formTypesFor(staged) })
    const report = await syncSchema(
      db,
      loaded,
      { nodeId: config.nodeId, version: loaded.set.version, revision: config.schemaRevision },
      {
        ...syncOptionsFor(staged),
        forceRetireTypes: true,
        takeFiles: carriesSchema,
        dryRun: true,
      },
    )
    const refused = report.action === 'refused' || report.action === 'skipped-older'
    return {
      from,
      to: carriesSchema ? loaded.set.version : from,
      retiredTypes: report.retiredTypes,
      ...(refused
        ? { refused: carriesSchema ? (report.reason ?? 'the schema has problems') : NO_SCHEMA }
        : {}),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface ReplaceSummary {
  /** What the site has that the file does not, by kind: recycled, or deleted. */
  leaving: Record<string, number>
  /** Files in the site's folders that the file does not carry. */
  filesRemoved: string[]
  /** Members and users `--replace-all` would delete. */
  people: { members: number; users: number }
  /** Story 424: the schema version the site would go from and to, and the types retired. */
  schema?: ReplaceSchema
}

/** Read-only: what replacing this site with the file would take out. */
export async function replaceSummary(
  db: Db,
  set: ContentSet,
  carriedPaths: ReadonlySet<string>,
  folders: ReadonlyArray<{ section: string; dir: string }>,
  mode: ReplaceMode,
): Promise<ReplaceSummary> {
  const inFile = new Set(set.nodes.map((node) => node.key.toLowerCase()))
  const leaving: Record<string, number> = {}
  for (const { objectType, kind } of PRUNED_KINDS) {
    const rows = await db.q
      .selectFrom('node')
      .select('unique_id')
      .where('node_object_type', '=', objectType)
      .where('trashed', '=', db.dialect.boolValue(false) as boolean)
      .execute()
    const count = rows.filter((row) => !inFile.has(String(row.unique_id).toLowerCase())).length
    if (count > 0) leaving[kind] = count
  }
  const filesRemoved: string[] = []
  for (const { section, dir } of folders) {
    if (!existsSync(dir)) continue
    for (const path of new Bun.Glob('**/*').scanSync({ cwd: dir, onlyFiles: true, dot: true })) {
      const bundlePath = `${section}/${path.split(sep).join('/')}`
      if (!carriedPaths.has(bundlePath)) filesRemoved.push(join(dir, path))
    }
  }
  let people = { members: 0, users: 0 }
  if (mode === 'replace-all') {
    const members = new Set((set.people?.members ?? []).map((m) => m.key.toLowerCase()))
    const users = new Set((set.people?.users ?? []).map((u) => u.key.toLowerCase()))
    const memberRows = await db.q
      .selectFrom('node')
      .select('unique_id')
      .where('node_object_type', '=', ObjectTypes.Member)
      .execute()
    const userRows = await db.q.selectFrom('user_account').select('key').execute()
    people = {
      members: memberRows.filter((r) => !members.has(String(r.unique_id).toLowerCase())).length,
      users: userRows.filter((r) => !users.has(String(r.key).toLowerCase())).length,
    }
  }
  return { leaving, filesRemoved, people }
}
