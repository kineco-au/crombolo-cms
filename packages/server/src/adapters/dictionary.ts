/** The dictionary port over the repository, with `.udt` import and export. */
import type { DictionaryPort } from '@crombolo/api-management'
import { appendCacheInstruction, type Db, DictionaryRepository } from '@crombolo/data'
import { importDictionaryUdt } from '../dictionary-transfer.ts'
import type { MediaFileStore } from '../media-files.ts'
import { readUdt, type UdtItem, writeUdt } from '../udt.ts'

export function createDictionaryPort(
  db: Db,
  files: MediaFileStore,
  options: { onChange?: () => void; nodeId?: string } = {},
): DictionaryPort {
  const repo = new DictionaryRepository(db)
  /** Every node is told in the change's own transaction (story 174). */
  const instruct = (on: Db) =>
    appendCacheInstruction(on, {
      kind: 'content',
      payload: { dictionary: true },
      by: options.nodeId,
    })
  const write = async <T>(change: (tx: DictionaryRepository) => Promise<T>): Promise<T> => {
    const result = await db.transaction(async (tx) => {
      const done = await change(new DictionaryRepository(tx))
      if (done === 'Success') await instruct(tx)
      return done
    })
    if (result === 'Success') options.onChange?.()
    return result
  }

  async function toUdt(key: string, includeChildren: boolean): Promise<UdtItem | undefined> {
    const item = await repo.get(key)
    if (!item) return undefined
    const children: UdtItem[] = []
    if (includeChildren)
      for (const child of await repo.children(item.key)) {
        const nested = await toUdt(child.key, true)
        if (nested) children.push(nested)
      }
    return { key: item.key, name: item.name, translations: item.translations, children }
  }

  return {
    all: (filter) => repo.all(filter),
    get: (key) => repo.get(key),
    items: (keys) => repo.many(keys),
    children: (parentKey) => repo.children(parentKey),
    ancestry: (key) => repo.ancestry(key),
    create: (item) => write((tx) => tx.create(item)),
    update: (key, change) => write((tx) => tx.update(key, change)),
    move: (key, parentKey) => write((tx) => tx.move(key, parentKey)),
    delete: (key) => write((tx) => tx.delete(key)),

    async export(key, includeChildren) {
      const item = await toUdt(key, includeChildren)
      if (!item) return undefined
      return { fileName: `${item.name}.udt`, content: writeUdt(item) }
    },

    async import(temporaryFileId, parentKey) {
      const upload = await files.readTemporary(temporaryFileId)
      if (!upload)
        return { ok: false, status: 'NotFound', reason: 'The uploaded file has expired.' }
      if (!upload.fileName.toLowerCase().endsWith('.udt'))
        return { ok: false, status: 'Invalid', reason: 'Only .udt files can be imported.' }
      const text = new TextDecoder().decode(upload.bytes)
      // The reader is consulted first only so a malformed file and an absent
      // parent keep the distinct statuses the contract names for them.
      const items = readUdt(text)
      if (!items)
        return { ok: false, status: 'Invalid', reason: 'The file is not a dictionary export.' }
      if (parentKey && !(await repo.get(parentKey)))
        return { ok: false, status: 'ParentNotFound', reason: 'The parent item does not exist.' }

      // The same implementation `crombolo dictionary import` uses.
      const outcome = await importDictionaryUdt(db, text, parentKey ?? null)
      await files.deleteTemporary(temporaryFileId)
      if (!outcome.ok)
        return {
          ok: false,
          status: 'Invalid',
          reason: 'No item in the file could be imported: its name is already in use.',
        }
      await instruct(db)
      options.onChange?.()
      return { ok: true, key: items[0]?.key as string }
    },
  }
}
