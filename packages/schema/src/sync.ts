/**
 * Files → database. Version-gated, locked, and never destructive: removal is
 * retirement, and a type with content refuses to disappear. The algorithm and
 * the multi-node rules are in docs/schema-as-code.md, "Synchronisation".
 */
import type { FormTypes } from '@crombolo/core'
import {
  type ContentTypeAggregate,
  derivedKey,
  ObjectTypes,
  type PropertyTypeModel,
} from '@crombolo/core'
import {
  appendCacheInstruction,
  appendSchemaState,
  BUILT_IN_MEDIA_TYPES,
  ComponentRepository,
  ContentTypeRepository,
  compareStates,
  currentSchemaState,
  DataTypeRepository,
  type Db,
  DbDate,
  DEFAULT_URL_OPTIONS,
  ensureSystemMediaTypes,
  FolderRepository,
  LanguageRepository,
  Locks,
  latestPreparedState,
  makeStateCurrent,
  type NodeSchemaState,
  type SchemaStateRow,
  SYSTEM_CONTENT_TYPES,
  SYSTEM_MEDIA_TYPES,
  SYSTEM_MEMBER_TYPE,
  sameUrlOptions,
  syncWorkflows,
  type UrlOptions,
  updateSchemaStateHash,
  type WorkflowSyncReport,
  writeUrlOptions,
} from '@crombolo/data'
import { compileBlocks } from './blocks.ts'
import { BUILTIN_DATA_TYPES, storageTypeFor } from './builtin.ts'
import { type ReferenceKind, resolveConfig } from './config-references.ts'
import { dataTypeKeyFor, propertyKeyFor, shippedPropertyKeys, typeKeyFor } from './keys.ts'
import { hashSchemaSet, type LoadedSchema } from './load.ts'
import {
  allProperties,
  type SchemaContentType,
  type SchemaProblem,
  type SchemaProperty,
  typeFileKey,
} from './model.ts'
import { validateSchemaSet } from './validate.ts'
import { workflowVersion } from './workflows.ts'

export interface SyncNode extends NodeSchemaState {
  nodeId: string
}

export interface SyncOptions {
  mode: 'development' | 'production'
  /** Template aliases that exist as view files. */
  componentAliases?: ReadonlySet<string>
  /** Retire a type even though documents of it exist. */
  forceRetireTypes?: boolean
  /** Compute the report and roll back: `types check`. */
  dryRun?: boolean
  /**
   * `prepared` creates everything under a state no live node has reached, so it
   * is pending everywhere until `upgrade` makes the state current. Default current.
   */
  status?: 'prepared' | 'current'
  /** The form field and workflow types the site's wired bundles add. */
  formTypes?: FormTypes
}

export type SyncAction = 'applied' | 'would-apply' | 'skipped-older' | 'skipped-same' | 'refused'

export interface SyncReportBase {
  /** Existing properties whose data type change was deferred to the cut-over (prepared syncs only). */
  deferred: string[]
}

/** A key the sync minted or recovered for an element whose file has none. */
export interface AssignedKey {
  file: string
  typeAlias: string
  /** Undefined for the type itself. */
  propertyAlias?: string
  key: string
  /** True when the key belongs to a retired property that was revived by alias. */
  revived: boolean
}

export interface SyncReport {
  action: SyncAction
  reason?: string
  problems: SchemaProblem[]
  state?: { id: number; version: string; revision: string }
  created: { types: number; properties: number; dataTypes: number; languages: number }
  updated: { types: number; dataTypes: number; languages: number }
  retired: string[]
  retiredTypes: string[]
  revived: string[]
  assignedKeys: AssignedKey[]
  deferred: string[]
  /** Set when the sync changed how URLs are built, so the old ones can be redirected. */
  urls?: { before: UrlOptions; after: UrlOptions }
  /** Set when a workflow changed, with what that did to requests in flight. */
  workflows?: WorkflowSyncReport
}

export const emptySyncReport = (
  action: SyncAction,
  extra: Partial<SyncReport> = {},
): SyncReport => ({
  action,
  problems: [],
  created: { types: 0, properties: 0, dataTypes: 0, languages: 0 },
  updated: { types: 0, dataTypes: 0, languages: 0 },
  retired: [],
  retiredTypes: [],
  revived: [],
  assignedKeys: [],
  deferred: [],
  ...extra,
})

/** Composition dependencies first. Cycles were rejected by validation. */
function inCompositionOrder(types: readonly SchemaContentType[]): SchemaContentType[] {
  const byAlias = new Map(types.map((t) => [t.alias, t]))
  const done = new Set<string>()
  const out: SchemaContentType[] = []
  const visit = (t: SchemaContentType) => {
    if (done.has(t.alias)) return
    done.add(t.alias)
    for (const c of t.compositions) {
      const dep = byAlias.get(c)
      if (dep) visit(dep)
    }
    out.push(t)
  }
  for (const t of types) visit(t)
  return out
}

export async function syncSchema(
  db: Db,
  loaded: LoadedSchema,
  node: SyncNode,
  options: SyncOptions,
): Promise<SyncReport> {
  const problems = [
    ...loaded.problems,
    ...validateSchemaSet(loaded.set, {
      componentAliases: options.componentAliases,
      types: options.formTypes,
    }),
  ]
  if (problems.length > 0)
    return emptySyncReport('refused', { reason: 'the schema has problems', problems })

  const set = loaded.set
  const hash = hashSchemaSet(set)
  const fileState: NodeSchemaState = { version: set.version, revision: node.revision }

  return db.locks
    .withLock(Locks.Schema, async () =>
      db.transaction(async (tx) => {
        const current = await currentSchemaState(tx, true)
        const prepared = await latestPreparedState(tx)
        const preparedHere =
          prepared && prepared.id > current.id && compareStates(prepared, fileState) === 0
            ? prepared
            : undefined
        const status = options.status ?? 'current'
        // An early fix already created this state: a second fix is a no-op, and a
        // current sync of the same files is the cut-over.
        if (preparedHere && status === 'prepared' && preparedHere.hash === hash)
          return emptySyncReport('skipped-same', {
            state: {
              id: preparedHere.id,
              version: preparedHere.version,
              revision: preparedHere.revision,
            },
          })
        const cutOver = preparedHere !== undefined && status === 'current'
        const cmp = compareStates(fileState, current)
        const neverSynced = current.hash === null
        if (cmp < 0)
          return emptySyncReport('skipped-older', {
            reason: `files are at ${fileState.version}+${fileState.revision}, database at ${current.version}+${current.revision}; running in compatibility mode`,
          })
        if (cmp === 0 && !neverSynced && !cutOver) {
          if (hash === current.hash) return emptySyncReport('skipped-same')
          if (options.mode === 'production')
            return emptySyncReport('refused', {
              reason: `schema changed without a version bump (still ${set.version}); bump schema/schema.toml or deploy with a newer revision`,
            })
        }

        const report = emptySyncReport('applied')
        const state = cutOver
          ? (preparedHere as SchemaStateRow)
          : await appendSchemaState(tx, {
              version: set.version,
              revision: node.revision,
              hash,
              status,
              by: node.nodeId,
            })
        report.state = { id: state.id, version: state.version, revision: state.revision }

        const dataTypes = new DataTypeRepository(tx)
        const typeFolders = new FolderRepository(
          tx,
          ObjectTypes.DocumentTypeContainer,
          ObjectTypes.DocumentType,
        )
        const dataTypeFolders = new FolderRepository(
          tx,
          ObjectTypes.DataTypeContainer,
          ObjectTypes.DataType,
        )
        const folderKey = (repo: FolderRepository, folder: string | undefined) =>
          folder
            ? repo.ensurePath(
                folder
                  .split('/')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            : Promise.resolve(null)
        const types = new ContentTypeRepository(tx)
        const templates = new ComponentRepository(tx)
        const languages = new LanguageRepository(tx)

        // Content types, then media types: one table, two kinds, the same rules.
        const kinds = [
          {
            name: 'document' as const,
            types: set.contentTypes,
            repo: types,
            folders: typeFolders,
            noun: 'content type',
            items: 'document(s)',
          },
          {
            name: 'media' as const,
            types: set.mediaTypes ?? [],
            repo: new ContentTypeRepository(tx, { kind: 'media' }),
            folders: new FolderRepository(
              tx,
              ObjectTypes.MediaTypeContainer,
              ObjectTypes.MediaType,
            ),
            noun: 'media type',
            items: 'media item(s)',
          },
          {
            name: 'member' as const,
            types: set.memberTypes ?? [],
            repo: new ContentTypeRepository(tx, { kind: 'member' }),
            folders: new FolderRepository(
              tx,
              ObjectTypes.MemberTypeContainer,
              ObjectTypes.MemberType,
            ),
            noun: 'member type',
            items: 'member(s)',
          },
        ]
        // ---- type keys, settled before anything is saved (story 161): a data
        // type's config may name a type this same change adds.
        const settledTypeKeys = new Map<string, Map<string, string>>()
        for (const kind of kinds) {
          const fileTypeKeys = new Set(
            kind.types.flatMap((t) => (t.key ? [t.key.toLowerCase()] : [])),
          )
          const byAlias = new Map<string, string>()
          for (const t of kind.types)
            byAlias.set(t.alias, (await resolveTypeKey(kind.repo, kind.name, t, fileTypeKeys)).key)
          settledTypeKeys.set(kind.name, byAlias)
        }

        // A type named in a data type's config, by alias: one this change
        // settles, or one Crombolo ships.
        const typeByAlias = (alias: string, kind: ReferenceKind): string | undefined => {
          const k = kind === 'element' ? 'document' : kind
          const settled = settledTypeKeys.get(k)?.get(alias)
          if (settled) return settled
          const shipped =
            k === 'document'
              ? SYSTEM_CONTENT_TYPES.find((t) => t.alias === alias)
              : k === 'media'
                ? (SYSTEM_MEDIA_TYPES.find((t) => t.alias === alias) ??
                  BUILT_IN_MEDIA_TYPES.find((t) => t.alias === alias))
                : SYSTEM_MEMBER_TYPE.alias === alias
                  ? SYSTEM_MEMBER_TYPE
                  : undefined
          return shipped?.key
        }

        // ---- data types: built-ins are seeded; files add or override by alias
        for (const d of set.dataTypes) {
          const existing = await dataTypes.byAlias(d.alias)
          const builtin = BUILTIN_DATA_TYPES.find((b) => b.alias === d.alias)
          // A key this site has never had, for an alias it has, is that data
          // type: the row keeps its key and the file is given it (story 105).
          const rekeyed =
            d.key !== undefined &&
            existing !== undefined &&
            existing.key.toLowerCase() !== d.key.toLowerCase() &&
            !(await dataTypes.byKey(d.key))
          const expected = dataTypeKeyFor(d.alias)
          const key = (rekeyed ? existing?.key : d.key) ?? existing?.key ?? expected
          // Written back only when the file needs it: a key no file without one would get.
          if ((!d.key && key.toLowerCase() !== expected.toLowerCase()) || rekeyed)
            report.assignedKeys.push({
              file: loaded.files.get(`data-type:${d.alias}`) ?? '',
              typeAlias: d.alias,
              key,
              revived: false,
            })
          // Blocks as tables and types by alias, compiled to the keys the editor reads.
          let config = d.config
          if (d.blocks)
            config = {
              ...config,
              ...compileBlocks(key, d.blocks, (alias) => typeByAlias(alias, 'element')).config,
            }
          config = resolveConfig(d.editor, config, typeByAlias).config
          await dataTypes.save({
            key,
            alias: d.alias,
            name: d.name,
            editorAlias: d.editor,
            editorUiAlias: d.editorUi ?? builtin?.editorUi ?? null,
            dbType: existing?.dbType ?? storageTypeFor(d.editor),
            values: Object.entries(config).map(([alias, value]) => ({ alias, value })),
            parentKey: existing?.parentKey ?? (await folderKey(dataTypeFolders, d.folder)),
          })
          if (existing) report.updated.dataTypes += 1
          else report.created.dataTypes += 1
        }
        const dataTypeKeyByAlias = new Map<string, string>()
        for (const alias of new Set([
          ...BUILTIN_DATA_TYPES.map((b) => b.alias),
          ...set.dataTypes.map((d) => d.alias),
        ])) {
          const found = await dataTypes.byAlias(alias)
          if (found) dataTypeKeyByAlias.set(alias, found.key)
        }

        // ---- languages
        if (set.languages.length > 0) {
          const result = await languages.upsertAll(
            set.languages.map((l) => ({
              isoCode: l.iso,
              cultureName: l.name,
              isDefault: l.default,
              isMandatory: l.mandatory,
              fallbackIsoCode: l.fallback ?? null,
            })),
          )
          report.created.languages += result.created
          report.updated.languages += result.updated
        }

        // ---- how URLs are built: the files are the source, absent is the default.
        // Only a current sync moves it; a prepared one serves no URLs yet.
        if (status === 'current') {
          const urls = { hideTopLevel: set.urls?.hideTopLevel ?? DEFAULT_URL_OPTIONS.hideTopLevel }
          const before = await writeUrlOptions(tx, urls)
          if (!sameUrlOptions(before, urls)) report.urls = { before, after: urls }
          // Approval workflows likewise: only a current sync changes the rules
          // that pages are published under.
          const workflows = await syncWorkflows(
            tx,
            (set.workflows ?? []).map((workflow) => ({
              workflow,
              version: workflowVersion(workflow),
            })),
          )
          if (workflows.changed.length > 0) report.workflows = workflows
        }

        // ---- templates referenced by types must have a row
        const componentKeyByAlias = new Map<string, string>()
        for (const alias of new Set(set.contentTypes.flatMap((t) => t.components))) {
          const existing = await templates.byAlias(alias)
          const key = existing?.key ?? crypto.randomUUID()
          if (!existing) await templates.save({ key, name: alias, alias, content: null })
          componentKeyByAlias.set(alias, key)
        }

        // Umbraco's fixed keys for the built-in media types' groups, so a site's
        // video.toml keeps the key Umbraco gave its "Video" group.
        const fixedGroupKeys = new Map([
          ...BUILT_IN_MEDIA_TYPES.flatMap((t) =>
            t.group ? [[`${t.alias}|${t.group.name}`, t.group.key] as const] : [],
          ),
          ...SYSTEM_CONTENT_TYPES.map((t) => [`${t.alias}|${t.tab.name}`, t.tab.key] as const),
        ])
        for (const kind of kinds) {
          // ---- types: resolve keys, then save in composition order, twice
          // (allowed children may reference types created later in the order)
          const typeKeyByAlias = new Map<string, string>(
            kind.name === 'media'
              ? SYSTEM_MEDIA_TYPES.map((t) => [t.alias, t.key])
              : kind.name === 'member'
                ? [[SYSTEM_MEMBER_TYPE.alias, SYSTEM_MEMBER_TYPE.key]]
                : SYSTEM_CONTENT_TYPES.map((t) => [t.alias, t.key]),
          )
          const aggregates: Array<{
            file: string
            type: SchemaContentType
            aggregate: ContentTypeAggregate
          }> = []
          const fileTypeKeys = new Set(
            kind.types.flatMap((t) => (t.key ? [t.key.toLowerCase()] : [])),
          )
          for (const t of inCompositionOrder(kind.types)) {
            const file = loaded.files.get(typeFileKey(kind.name, t.alias)) ?? ''
            const resolved = await resolveTypeKey(kind.repo, kind.name, t, fileTypeKeys)
            const existing = resolved.existing
            const rekeyed = resolved.rekeyed
            const expected = typeKeyFor(kind.name, t.alias)
            const key = resolved.key
            if ((!t.key && key.toLowerCase() !== expected.toLowerCase()) || rekeyed)
              report.assignedKeys.push({ file, typeAlias: t.alias, key, revived: false })
            typeKeyByAlias.set(t.alias, key)
            const typeKey = key
            const retired = existing ? await kind.repo.retiredProperties(existing.key) : []
            const liveByAlias = new Map((existing?.properties ?? []).map((p) => [p.alias, p]))
            const shippedProperties = shippedPropertyKeys(kind.name, t.alias)

            const containers: ContentTypeAggregate['containers'] = []
            const properties: PropertyTypeModel[] = []
            let sortOrder = 0
            const resolveProperty = (
              p: SchemaProperty,
              containerKey: string | null,
            ): PropertyTypeModel => {
              let key = p.key
              let revived = false
              if (!key) {
                const live = liveByAlias.get(p.alias)
                const back = retired.find((r) => r.alias === p.alias)
                const expectedKey = propertyKeyFor(typeKey, p.alias, shippedProperties)
                key = live?.key ?? back?.key ?? expectedKey
                revived = !live && back !== undefined
                if (key.toLowerCase() !== expectedKey.toLowerCase())
                  report.assignedKeys.push({
                    file,
                    typeAlias: t.alias,
                    propertyAlias: p.alias,
                    key,
                    revived,
                  })
                if (revived) report.revived.push(`${t.alias}.${p.alias}`)
              } else if (retired.some((r) => r.key === key)) {
                report.revived.push(`${t.alias}.${p.alias}`)
              }
              // Under a prepared state an existing property keeps its editor: the old
              // nodes still edit it, and the converted values wait for the cut-over.
              let dataTypeKey = dataTypeKeyByAlias.get(p.type) ?? ''
              const liveProperty = liveByAlias.get(p.alias)
              if (
                status === 'prepared' &&
                liveProperty &&
                liveProperty.dataTypeKey !== dataTypeKey
              ) {
                report.deferred.push(`${t.alias}.${p.alias}`)
                dataTypeKey = liveProperty.dataTypeKey
              }
              // Likewise a property becoming mandatory: old nodes must keep publishing.
              let mandatory = p.mandatory
              if (status === 'prepared' && liveProperty && !liveProperty.mandatory && p.mandatory) {
                report.deferred.push(`${t.alias}.${p.alias} (mandatory)`)
                mandatory = false
              }
              return {
                key,
                alias: p.alias,
                name: p.name,
                description: p.description ?? null,
                dataTypeKey,
                containerKey,
                sortOrder: sortOrder++,
                variesByCulture: p.variesByCulture,
                variesBySegment: p.variesBySegment,
                mandatory,
                mandatoryMessage: p.mandatoryMessage ?? null,
                regEx: p.regex ?? null,
                sinceVersion: p.since ?? null,
                regExMessage: p.regexMessage ?? null,
                labelOnTop: p.labelOnTop,
                memberCanView: p.memberCanView === true,
                memberCanEdit: p.memberCanEdit === true,
                isSensitive: p.sensitive === true,
                searchable: p.searchable !== false,
                siteSearch: p.siteSearch ?? 'normal',
              }
            }
            // Groups have no key in the file; they match an existing group of the same name.
            const existingContainers = existing?.containers ?? []
            const containerKeyFor = (
              name: string,
              parentKey: string | null,
              type: 'Tab' | 'Group' = parentKey ? 'Group' : 'Tab',
            ): string =>
              existingContainers.find(
                (c) => c.name === name && (c.parentKey ?? null) === parentKey && c.type === type,
              )?.key ??
              fixedGroupKeys.get(`${t.alias}|${name}`) ??
              derivedKey(typeKey, type, parentKey ?? '', name)
            for (const p of t.properties) properties.push(resolveProperty(p, null))
            let rootGroupOrder = 0
            for (const g of t.groups ?? []) {
              const groupKey = containerKeyFor(g.name, null, 'Group')
              containers.push({
                key: groupKey,
                name: g.name,
                alias: g.alias ?? null,
                type: 'Group',
                sortOrder: rootGroupOrder++,
                parentKey: null,
              })
              for (const p of g.properties) properties.push(resolveProperty(p, groupKey))
            }
            let tabOrder = 0
            for (const tab of t.tabs) {
              const tabKey = containerKeyFor(tab.name, null)
              containers.push({
                key: tabKey,
                name: tab.name,
                alias: tab.alias ?? null,
                type: 'Tab',
                sortOrder: tabOrder++,
                parentKey: null,
              })
              for (const p of tab.properties) properties.push(resolveProperty(p, tabKey))
              let groupOrder = 0
              for (const g of tab.groups) {
                const groupKey = containerKeyFor(g.name, tabKey)
                containers.push({
                  key: groupKey,
                  name: g.name,
                  alias: g.alias ?? null,
                  type: 'Group',
                  sortOrder: groupOrder++,
                  parentKey: tabKey,
                })
                for (const p of g.properties) properties.push(resolveProperty(p, groupKey))
              }
            }
            aggregates.push({
              file,
              type: t,
              aggregate: {
                key,
                alias: t.alias,
                name: t.name,
                description: t.description ?? null,
                icon: t.icon,
                allowedAsRoot: t.allowAtRoot,
                variesByCulture: t.variesByCulture,
                variesBySegment: t.variesBySegment,
                isElement: t.isElement,
                allowedInLibrary: t.allowInLibrary,
                collectionKey: t.collection ? (dataTypeKeyByAlias.get(t.collection) ?? null) : null,
                sinceVersion: t.since ?? null,
                siteSearch: t.siteSearch !== false,
                cleanup: {
                  preventCleanup: t.cleanup.prevent,
                  keepAllVersionsNewerThanDays: t.cleanup.keepAllNewerThanDays ?? null,
                  keepLatestVersionPerDayForDays: t.cleanup.keepLatestPerDayForDays ?? null,
                },
                properties,
                containers,
                compositions: t.compositions.map((alias) => ({
                  contentTypeKey: typeKeyByAlias.get(alias) ?? '',
                  compositionType: 'Composition' as const,
                })),
                allowedContentTypes: [],
                allowedComponentKeys: t.components.map(
                  (alias) => componentKeyByAlias.get(alias) ?? '',
                ),
                defaultComponentKey: t.defaultComponent
                  ? (componentKeyByAlias.get(t.defaultComponent) ?? null)
                  : null,
                parentKey:
                  t.folder !== undefined
                    ? await folderKey(kind.folders, t.folder)
                    : (existing?.parentKey ?? null),
              },
            })
            const before = existing
              ? new Set(existing.properties.map((p) => p.alias))
              : new Set<string>()
            if (existing) report.updated.types += 1
            else report.created.types += 1
            report.created.properties += properties.filter((p) => !before.has(p.alias)).length
            for (const alias of before) {
              if (allProperties(t).some((p) => p.alias === alias)) continue
              if (status === 'prepared') {
                // Old nodes keep editing it until the cut-over retires it.
                const live = existing?.properties.find((p) => p.alias === alias)
                if (live) properties.push({ ...live, sortOrder: sortOrder++ })
                report.deferred.push(`${t.alias}.${alias} (retire)`)
              } else report.retired.push(`${t.alias}.${alias}`)
            }
          }
          for (const { aggregate } of aggregates)
            await kind.repo.save(aggregate, { sinceStateId: state.id })
          for (const { type, aggregate } of aggregates) {
            if (type.allowChildren.length === 0) continue
            await kind.repo.save(
              {
                ...aggregate,
                allowedContentTypes: type.allowChildren.map((alias, sortOrder) => ({
                  contentTypeKey: typeKeyByAlias.get(alias) ?? '',
                  sortOrder,
                })),
              },
              { sinceStateId: state.id },
            )
          }

          // ---- types in the database but not in files: retire, unless they have content
          const inFiles = new Set(typeKeyByAlias.values())
          const dbTypes = await tx.q
            .selectFrom('content_type as ct')
            .innerJoin('node as n', 'n.id', 'ct.node_id')
            .select(['n.unique_id', 'ct.alias'])
            .where('ct.retired_at', 'is', null)
            .where('n.node_object_type', '=', kind.repo.objectType)
            .execute()
          for (const row of dbTypes) {
            const key = String(row.unique_id).toLowerCase()
            if (inFiles.has(key)) continue
            // Shipped with the framework: present whether or not a file defines it.
            if (SYSTEM_MEDIA_TYPES.some((t) => t.key === key)) continue
            if (key === SYSTEM_MEMBER_TYPE.key) continue
            if (SYSTEM_CONTENT_TYPES.some((t) => t.key === key)) continue
            if (status === 'prepared') {
              report.deferred.push(`${row.alias} (retire type)`)
              continue
            }
            const count = await kind.repo.contentCount(key)
            if (count > 0 && !options.forceRetireTypes) {
              throw new SchemaSyncRefused(
                `${kind.noun} "${row.alias}" was removed from schema/ but ${count} ${kind.items} of it exist; restore the file, or retire it deliberately with --force-retire-types`,
              )
            }
            await tx.q
              .updateTable('content_type')
              .set({ retired_at: DbDate.toDb(new Date()) })
              .where('node_id', '=', (eb) =>
                eb.selectFrom('node').select('id').where('unique_id', '=', key),
              )
              .execute()
            report.retiredTypes.push(String(row.alias))
          }
        }

        // Folder holds whichever built-in media types the site now has (story 180),
        // in this transaction so no node sees the new state before Folder does.
        // A file that defines Folder says itself what it allows.
        if (!(set.mediaTypes ?? []).some((t) => t.alias.toLowerCase() === 'folder'))
          await ensureSystemMediaTypes(tx, { linkFolderChildren: true })
        if (cutOver) {
          await makeStateCurrent(tx, state.id)
          await updateSchemaStateHash(tx, state.id, hash)
        }
        await appendCacheInstruction(tx, {
          kind: 'schema',
          payload: { stateId: state.id },
          by: node.nodeId,
        })
        if (options.dryRun) throw new DryRun(report)
        return report
      }),
    )
    .catch((error: unknown) => {
      if (error instanceof SchemaSyncRefused)
        return emptySyncReport('refused', { reason: error.message })
      if (error instanceof DryRun) return { ...error.report, action: 'would-apply' as const }
      throw error
    })
}

export class SchemaSyncRefused extends Error {}

/**
 * A type's key (story 161): the file's, else the row that has its alias, else
 * the shipped or derived one. A key this site has never had, for an alias it
 * has and no other file claims, is that type: the row keeps its key, and the
 * file is given it (story 105).
 */
async function resolveTypeKey(
  repo: ContentTypeRepository,
  kind: 'document' | 'media' | 'member',
  t: SchemaContentType,
  fileTypeKeys: ReadonlySet<string>,
): Promise<{ existing: ContentTypeAggregate | undefined; key: string; rekeyed: boolean }> {
  let existing = t.key
    ? await repo.byKey(t.key)
    : await repo.byAlias(t.alias, { includeRetired: true })
  let rekeyed = false
  if (!existing && t.key) {
    const sameAlias = await repo.byAlias(t.alias, { includeRetired: true })
    if (sameAlias && !fileTypeKeys.has(sameAlias.key.toLowerCase())) {
      existing = sameAlias
      rekeyed = true
    }
  }
  const key = (rekeyed ? existing?.key : t.key) ?? existing?.key ?? typeKeyFor(kind, t.alias)
  return { existing, key, rekeyed }
}

class DryRun extends Error {
  constructor(readonly report: SyncReport) {
    super('dry run')
  }
}
