/**
 * Document blueprints ("Document Blueprints" in Settings, "Create Document
 * Blueprint" on a page): stored as documents of their own object type in their
 * own folder tree, never published.
 */
import type { BlueprintPort, Principal } from '@crombolo/api-management/domain'
import { ObjectTypes, type TreeItem } from '@crombolo/core'
import {
  ChangeRepository,
  type Db,
  DocumentRepository,
  FolderRepository,
  LanguageRepository,
  type NodeSchemaState,
  type ValueIntake,
  WorkspaceRepository,
  WriteRejectedError,
} from '@crombolo/data'
import { createFolderPort, createSettingsTree } from './content.ts'

export function createBlueprintPort(
  db: Db,
  options: {
    nodeState?: NodeSchemaState
    valueIntake?: ValueIntake
    /** A workspace's blueprints (story 392). */
    workspace?: number
  } = {},
): BlueprintPort {
  const repo = new DocumentRepository(db, {
    nodeState: options.nodeState,
    kind: 'blueprint',
    valueIntake: options.valueIntake,
    workspace: options.workspace,
  })
  const documents = new DocumentRepository(db, {
    nodeState: options.nodeState,
    workspace: options.workspace,
  })
  const workspace = options.workspace
  const inWorkspace =
    workspace === undefined
      ? undefined
      : async () => ({
          id: workspace,
          hidden: (await new WorkspaceRepository(db).pending(workspace))
            .filter((p) => p.kind === 'delete' && p.key !== null)
            .map((p) => p.key as string),
        })
  const container = ObjectTypes.DocumentBlueprintContainer
  const folders = new FolderRepository(db, container, ObjectTypes.DocumentBlueprint)

  const decorate = async (item: TreeItem) => {
    const blueprint = await repo.byKey(item.key)
    item.icon = blueprint?.contentTypeIcon ?? 'icon-blueprint'
    item.contentTypeKey = blueprint?.contentTypeKey ?? null
    // In a workspace, the name it has there (story 392); the node's is Shared's.
    if (workspace !== undefined && blueprint?.variants[0]?.name)
      item.name = blueprint.variants[0].name
  }
  const tree = createSettingsTree(
    repo.nodes,
    container,
    ObjectTypes.DocumentBlueprint,
    decorate,
    inWorkspace,
  )

  const userIdOf = async (principal: Principal): Promise<number | undefined> => {
    const rows = await db.q
      .selectFrom('user_account')
      .select('id')
      .where('key', '=', principal.id)
      .execute()
    return rows[0] ? Number(rows[0].id) : undefined
  }
  const defaultCulture = async (): Promise<string | undefined> =>
    (await new LanguageRepository(db).all()).find((l) => l.isDefault)?.isoCode
  /** A save in Shared, recorded in its maker's change as a page's is (story 392). */
  const recorded = async (principal: Principal, key: string | undefined) => {
    if (workspace !== undefined || !key) return
    await new ChangeRepository(db).pageSavedBy(principal.id, { key, kind: 'blueprint' })
  }
  const failure = (error: unknown) => {
    if (error instanceof WriteRejectedError)
      return { ok: false as const, reason: error.message, status: 409 }
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : String(error),
      status: 400,
    }
  }

  return {
    byKey: (key) => repo.byKey(key),

    async create(input, principal) {
      try {
        const created = await repo.create({
          ...input,
          componentKey: null,
          userId: await userIdOf(principal),
        })
        await recorded(principal, created.key)
        return { ok: true as const }
      } catch (error) {
        return failure(error)
      }
    },

    async update(key, input, principal) {
      try {
        const updated = await repo.update({
          ...input,
          key,
          componentKey: null,
          userId: await userIdOf(principal),
        })
        if (!updated)
          return { ok: false as const, reason: 'The blueprint could not be found.', status: 404 }
        await recorded(principal, key)
        return { ok: true as const }
      } catch (error) {
        return failure(error)
      }
    },

    async fromDocument(documentKey, init, principal) {
      const document = await documents.byKey(documentKey)
      if (!document)
        return { ok: false as const, reason: 'The document could not be found.', status: 404 }
      try {
        // As Umbraco names one: a page in several languages gets the name in its
        // default one, which comes first so the tree shows it; the others keep theirs.
        const defaultIso = (await defaultCulture())?.toLowerCase()
        const named =
          document.variants.find((v) => v.culture === null) ??
          document.variants.find((v) => v.culture?.toLowerCase() === defaultIso) ??
          document.variants[0]
        const variants = [
          ...(named ? [named] : []),
          ...document.variants.filter((v) => v !== named),
        ].map((v) => ({
          culture: v.culture,
          segment: v.segment,
          name: v === named ? init.name : v.name,
        }))
        const created = await repo.create({
          key: init.key,
          contentTypeKey: document.contentTypeKey,
          componentKey: null,
          parentKey: init.parentKey,
          values: document.values,
          variants,
          userId: await userIdOf(principal),
        })
        await recorded(principal, created.key)
        return { ok: true as const, key: created.key }
      } catch (error) {
        return failure(error)
      }
    },

    async remove(key, principal) {
      const removed = await repo.delete(key)
      if (removed && principal) await recorded(principal, key)
      return removed
    },

    async move(key, targetKey) {
      const result = await repo.move(key, targetKey)
      if (result === 'moved') return { ok: true as const }
      return result === 'notFound'
        ? { ok: false as const, reason: 'The blueprint or folder could not be found.', status: 404 }
        : { ok: false as const, reason: 'A blueprint cannot move there.', status: 400 }
    },

    versions: (key) => repo.versions(key),
    async systemUserKey() {
      const rows = await db.q
        .selectFrom('user_account')
        .select('key')
        .orderBy('id')
        .limit(1)
        .execute()
      return rows[0] ? String(rows[0].key).toLowerCase() : null
    },

    async forContentType(contentTypeKey, paging) {
      const rows = await db.q
        .selectFrom('node as n')
        .innerJoin('content as c', 'c.node_id', 'n.id')
        .innerJoin('node as t', 't.id', 'c.content_type_id')
        .select(['n.unique_id', 'n.text'])
        .where('n.node_object_type', '=', ObjectTypes.DocumentBlueprint)
        .where('t.unique_id', '=', contentTypeKey.toLowerCase())
        .orderBy('n.text')
        .orderBy('n.id')
        .execute()
      const all = rows.map((row) => ({
        key: String(row.unique_id).toLowerCase(),
        name: String(row.text ?? ''),
      }))
      return { total: all.length, items: all.slice(paging.skip, paging.skip + paging.take) }
    },

    treeRoot: tree.treeRoot,
    treeChildren: tree.treeChildren,
    treeAncestors: tree.ancestors,
    treeSiblings: tree.siblings,

    async items(keys) {
      const found = []
      for (const key of keys) {
        const blueprint = await repo.byKey(key)
        if (!blueprint) continue
        found.push({
          key: blueprint.key,
          name:
            blueprint.variants.find((v) => v.culture === null)?.name ??
            blueprint.variants[0]?.name ??
            '',
          contentTypeKey: blueprint.contentTypeKey,
          icon: blueprint.contentTypeIcon,
        })
      }
      return found
    },

    folders: createFolderPort(folders, tree, async () => {}),
  }
}
