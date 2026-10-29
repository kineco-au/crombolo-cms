/**
 * Findings, persisted. A run upserts by `(code, subject, property, culture)`
 * within its own `(source, scope)` and resolves whatever it no longer reports,
 * so the dashboard shows items disappearing as they are fixed.
 *
 * `source` is required rather than defaulted: the sweep resolves what a run
 * omits, so a caller that forgot to say which findings it owns would silently
 * resolve somebody else's. `scope` narrows it again — one bundle's findings do
 * not resolve another's.
 */
import type { Db } from './database.ts'
import { DbDate } from './dialect.ts'

export type FindingKind = 'auto' | 'person' | 'blocking'

/** Who a run of findings belongs to. Scopes the resolve sweep. */
export type FindingSource = 'upgrade' | 'transfer'

export interface Finding {
  kind: FindingKind
  /** Stable machine name: 'mandatory-missing', 'value-conversion', … */
  code: string
  subjectType:
    | 'document'
    | 'document-type'
    | 'media-type'
    | 'member-type'
    | 'member'
    | 'member-group'
    | 'user'
    | 'user-group'
    | 'property'
    | 'migration'
    | 'file'
    | 'data-type'
    | 'media'
    | 'element'
    | 'bundle'
    | 'dictionary-item'
  subjectKey: string
  subjectName: string
  propertyAlias: string | null
  culture: string | null
  message: string
  /** A backoffice URL, when the subject has one. */
  link: string | null
}

export interface ReportedFinding extends Finding {
  id: number
  runId: string
  source: FindingSource
  /** What within the source these findings are about: a bundle id, or null for an upgrade. */
  scope: string | null
  status: 'open' | 'resolved'
  firstSeen: Date
  lastSeen: Date
  resolvedAt: Date | null
}

export interface WriteReportOptions {
  source: FindingSource
  scope?: string | null
  runId?: string
}

export interface ReadReportOptions {
  includeResolved?: boolean
  source?: FindingSource
  scope?: string | null
}

const identity = (f: Finding) =>
  `${f.code}|${f.subjectKey}|${f.propertyAlias ?? ''}|${f.culture ?? ''}`

/** Records a run: new findings inserted, seen ones refreshed, absent ones resolved. Returns the run id. */
export async function writeReport(
  db: Db,
  findings: readonly Finding[],
  options: WriteReportOptions,
): Promise<string> {
  const { source } = options
  const scope = options.scope ?? null
  const runId = options.runId ?? crypto.randomUUID()
  const now = DbDate.toDb(new Date())
  const open = await readReport(db, { source, scope })
  const openByIdentity = new Map(open.map((f) => [identity(f), f]))
  const seen = new Set<string>()
  for (const finding of findings) {
    const key = identity(finding)
    seen.add(key)
    const existing = openByIdentity.get(key)
    if (existing) {
      await db.q
        .updateTable('change_report')
        .set({
          run_id: runId,
          kind: finding.kind,
          subject_name: finding.subjectName,
          message: finding.message,
          link: finding.link,
          last_seen: now,
        })
        .where('id', '=', existing.id)
        .execute()
    } else {
      await db.q
        .insertInto('change_report')
        .values({
          run_id: runId,
          source,
          scope,
          kind: finding.kind,
          code: finding.code,
          subject_type: finding.subjectType,
          subject_key: finding.subjectKey,
          subject_name: finding.subjectName,
          property_alias: finding.propertyAlias,
          culture: finding.culture,
          message: finding.message,
          link: finding.link,
          status: 'open',
          first_seen: now,
          last_seen: now,
        })
        .execute()
    }
  }
  for (const [key, existing] of openByIdentity) {
    if (seen.has(key)) continue
    await db.q
      .updateTable('change_report')
      .set({ status: 'resolved', resolved_at: now })
      .where('id', '=', existing.id)
      .execute()
  }
  return runId
}

export async function readReport(
  db: Db,
  options: ReadReportOptions = {},
): Promise<ReportedFinding[]> {
  const { source } = options
  // `scope` is meaningful when null, so only an explicit key filters.
  const scoped = 'scope' in options
  const scope = options.scope ?? null
  const rows = await db.q
    .selectFrom('change_report')
    .select([
      'id',
      'run_id',
      'source',
      'scope',
      'kind',
      'code',
      'subject_type',
      'subject_key',
      'subject_name',
      'property_alias',
      'culture',
      'message',
      'link',
      'status',
      'first_seen',
      'last_seen',
      'resolved_at',
    ])
    .$if(!options.includeResolved, (q) => q.where('status', '=', 'open'))
    .$if(source !== undefined, (q) => q.where('source', '=', source as FindingSource))
    .$if(scoped, (q) =>
      scope === null ? q.where('scope', 'is', null) : q.where('scope', '=', scope),
    )
    .orderBy('id')
    .execute()
  return rows.map((row) => ({
    id: Number(row.id),
    runId: String(row.run_id),
    source: String(row.source) as FindingSource,
    scope: (row.scope as string | null) ?? null,
    kind: String(row.kind) as FindingKind,
    code: String(row.code),
    subjectType: String(row.subject_type) as Finding['subjectType'],
    subjectKey: String(row.subject_key),
    subjectName: String(row.subject_name ?? ''),
    propertyAlias: (row.property_alias as string | null) ?? null,
    culture: (row.culture as string | null) ?? null,
    message: String(row.message),
    link: (row.link as string | null) ?? null,
    status: String(row.status) as 'open' | 'resolved',
    firstSeen: DbDate.fromDb(row.first_seen) ?? new Date(0),
    lastSeen: DbDate.fromDb(row.last_seen) ?? new Date(0),
    resolvedAt: DbDate.fromDb(row.resolved_at) ?? null,
  }))
}
