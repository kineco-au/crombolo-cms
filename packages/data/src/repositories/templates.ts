/**
 * Templates. The database row carries the alias and the tree placement; the view
 * file lives on disk, and the file system is the source of truth for its content.
 */
import {
  type ComponentModel,
  normaliseUuid,
  ObjectTypes,
  type Page,
  SystemNodes,
} from '@crombolo/core'
import type { Db } from '../database.ts'
import { NodeRepository } from './nodes.ts'

export interface ComponentFileStore {
  read(alias: string): Promise<string | undefined>
  write(alias: string, content: string): Promise<void>
  remove(alias: string): Promise<void>
}

export class ComponentRepository {
  #db: Db
  #nodes: NodeRepository
  #files: ComponentFileStore | undefined

  constructor(db: Db, files?: ComponentFileStore) {
    this.#db = db
    this.#nodes = new NodeRepository(db)
    this.#files = files
  }

  get nodes(): NodeRepository {
    return this.#nodes
  }

  async byKey(key: string): Promise<ComponentModel | undefined> {
    const rows = await this.#db.q
      .selectFrom('template as t')
      .innerJoin('node as n', 'n.id', 't.node_id')
      .select(['n.unique_id', 'n.text', 't.alias'])
      .where('n.unique_id', '=', normaliseUuid(key))
      .execute()
    const row = rows[0]
    if (!row) return undefined
    const alias = String(row.alias)
    return {
      key: normaliseUuid(String(row.unique_id)),
      name: String(row.text ?? ''),
      alias,
      content: (await this.#files?.read(alias)) ?? null,
    }
  }

  async byAlias(alias: string): Promise<ComponentModel | undefined> {
    const rows = await this.#db.q
      .selectFrom('template as t')
      .innerJoin('node as n', 'n.id', 't.node_id')
      .select('n.unique_id')
      .where('t.alias', '=', alias)
      .execute()
    return rows[0] ? this.byKey(String(rows[0].unique_id)) : undefined
  }

  async all(): Promise<ComponentModel[]> {
    return (await this.list(0, 10_000)).items
  }

  async list(skip: number, take: number): Promise<Page<ComponentModel>> {
    const page = await this.#nodes.children(SystemNodes.Root, ObjectTypes.Template, skip, take)
    const items: ComponentModel[] = []
    for (const node of page.items) {
      const template = await this.byKey(node.key)
      if (template) items.push(template)
    }
    return { total: page.total, items }
  }

  async save(model: ComponentModel, userId?: number): Promise<ComponentModel> {
    const saved = await this.#db.transaction(async (tx) => {
      const repo = new ComponentRepository(tx, this.#files)
      const existing = await repo.nodes.byKey(model.key)
      if (existing) {
        await repo.nodes.rename(existing.id, model.name)
        await tx.q
          .updateTable('template')
          .set({ alias: model.alias })
          .where('node_id', '=', existing.id)
          .execute()
      } else {
        const node = await repo.nodes.create({
          key: model.key,
          parentId: SystemNodes.Root,
          objectType: ObjectTypes.Template,
          text: model.name,
          userId,
        })
        await tx.q.insertInto('template').values({ node_id: node.id, alias: model.alias }).execute()
      }
      return model
    })
    if (model.content !== null && model.content !== undefined) {
      await this.#files?.write(model.alias, model.content)
    }
    const result = await this.byKey(saved.key)
    if (!result) throw new Error('Template could not be read back after saving.')
    return result
  }

  async delete(key: string): Promise<boolean> {
    const template = await this.byKey(key)
    const node = await this.#nodes.byKey(key)
    if (!template || !node) return false
    await this.#db.transaction(async (tx) => {
      await tx.q
        .deleteFrom('content_type_template')
        .where('template_node_id', '=', node.id)
        .execute()
      await tx.q.deleteFrom('template').where('node_id', '=', node.id).execute()
      await tx.q.deleteFrom('node').where('id', '=', node.id).execute()
    })
    await this.#files?.remove(template.alias)
    return true
  }
}
