/**
 * A workspace's files (story 376): texts kept once each by the SHA-256 of their
 * text (`file_blob`), and each workspace's list of path and hash
 * (`workspace_file`). The list is taken when the workspace opens; the hash then
 * is each file's merge base, and the workspace changes only its own list.
 */
import { createHash } from 'node:crypto'
import type { Db } from '../database.ts'

/** The hash a file is kept by: the SHA-256 of its text, in hex. */
export const fileHash = (text: string): string => createHash('sha256').update(text).digest('hex')

/** One file the workspace changed: what it was at open, and is now (null: not there). */
export interface WorkspaceFileChange {
  path: string
  base: string | null
  now: string | null
  class: string | null
}

export class WorkspaceFileRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async #put(text: string): Promise<string> {
    const hash = fileHash(text)
    const found = await this.#db.q
      .selectFrom('file_blob')
      .select('hash')
      .where('hash', '=', hash)
      .execute()
    if (found.length === 0)
      await this.#db.q
        .insertInto('file_blob')
        .values({ hash, text, size: Buffer.byteLength(text) })
        .execute()
    return hash
  }

  async #texts(hashes: readonly string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(hashes)]
    const out = new Map<string, string>()
    for (let n = 0; n < wanted.length; n += 500)
      for (const row of await this.#db.q
        .selectFrom('file_blob')
        .select(['hash', 'text'])
        .where('hash', 'in', wanted.slice(n, n + 500))
        .execute())
        out.set(String(row.hash), String(row.text))
    return out
  }

  /** The workspace's list as Shared's files are at open: each file's base and its own. */
  async snapshot(workspaceId: number, files: ReadonlyMap<string, string>): Promise<void> {
    for (const [path, text] of files) {
      const hash = await this.#put(text)
      await this.#db.q
        .insertInto('workspace_file')
        .values({ workspace_id: workspaceId, path, base_hash: hash, hash, class: null })
        .execute()
    }
  }

  /** The workspace's files now, by path; `prefix` keeps one folder's. */
  async files(workspaceId: number, prefix = ''): Promise<Map<string, string>> {
    const rows = await this.#db.q
      .selectFrom('workspace_file')
      .select(['path', 'hash'])
      .where('workspace_id', '=', workspaceId)
      .where('hash', 'is not', null)
      .execute()
    const kept = rows.filter((row) => String(row.path).startsWith(prefix))
    const texts = await this.#texts(kept.map((row) => String(row.hash)))
    return new Map(kept.map((row) => [String(row.path), texts.get(String(row.hash)) ?? '']))
  }

  /** Each file whose text is not what it was at open. */
  async changes(workspaceId: number, prefix = ''): Promise<WorkspaceFileChange[]> {
    const rows = (
      await this.#db.q
        .selectFrom('workspace_file')
        .select(['path', 'base_hash', 'hash', 'class'])
        .where('workspace_id', '=', workspaceId)
        .orderBy('path')
        .execute()
    ).filter(
      (row) =>
        (row.base_hash ?? null) !== (row.hash ?? null) && String(row.path).startsWith(prefix),
    )
    const texts = await this.#texts(
      rows.flatMap((row) => [row.base_hash, row.hash].filter((h): h is string => Boolean(h))),
    )
    return rows.map((row) => ({
      path: String(row.path),
      base: row.base_hash ? (texts.get(String(row.base_hash)) ?? null) : null,
      now: row.hash ? (texts.get(String(row.hash)) ?? null) : null,
      class: (row.class as string | null) ?? null,
    }))
  }

  /** Writes a file in the workspace, or removes it (null), with the class of the change. */
  async write(
    workspaceId: number,
    path: string,
    text: string | null,
    changeClass: string | null = null,
  ): Promise<void> {
    const hash = text === null ? null : await this.#put(text)
    const found = await this.#db.q
      .selectFrom('workspace_file')
      .select('path')
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', path)
      .execute()
    if (found.length > 0)
      await this.#db.q
        .updateTable('workspace_file')
        .set({ hash, class: changeClass })
        .where('workspace_id', '=', workspaceId)
        .where('path', '=', path)
        .execute()
    else if (hash !== null)
      await this.#db.q
        .insertInto('workspace_file')
        .values({ workspace_id: workspaceId, path, base_hash: null, hash, class: changeClass })
        .execute()
  }

  /** A file brought up to Shared's (story 380's "update from Shared"): a new base, and its text. */
  async rebase(
    workspaceId: number,
    path: string,
    base: string | null,
    text: string | null,
  ): Promise<void> {
    const baseHash = base === null ? null : await this.#put(base)
    const hash = text === null ? null : await this.#put(text)
    await this.#db.q
      .deleteFrom('workspace_file')
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', path)
      .execute()
    if (baseHash !== null || hash !== null)
      await this.#db.q
        .insertInto('workspace_file')
        .values({
          workspace_id: workspaceId,
          path,
          base_hash: baseHash,
          hash,
          class: baseHash === hash ? null : 'none',
        })
        .execute()
  }

  /** Whether an open workspace has changed the file at `path` (story 376). */
  async changedInOpenWorkspace(path: string): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('workspace_file as f')
      .innerJoin('workspace as w', 'w.id', 'f.workspace_id')
      .select(['f.base_hash', 'f.hash'])
      .where('f.path', '=', path)
      .where('w.state', '=', 'open')
      .execute()
    return rows.some((row) => (row.base_hash ?? null) !== (row.hash ?? null))
  }

  /** Removes the workspace's list, then every text no list or change still keeps. */
  async discard(workspaceId: number): Promise<void> {
    await this.#db.q.deleteFrom('workspace_file').where('workspace_id', '=', workspaceId).execute()
    await this.collect()
  }

  /** Removes every kept text no workspace's list names. */
  async collect(): Promise<void> {
    await this.#db.q
      .deleteFrom('file_blob')
      .where((eb) =>
        eb.and([
          eb(
            'hash',
            'not in',
            eb.selectFrom('workspace_file').select('hash').where('hash', 'is not', null),
          ),
          eb(
            'hash',
            'not in',
            eb.selectFrom('workspace_file').select('base_hash').where('base_hash', 'is not', null),
          ),
          // A change's texts are its history (story 381).
          eb(
            'hash',
            'not in',
            eb.selectFrom('change_item').select('before_hash').where('before_hash', 'is not', null),
          ),
          eb(
            'hash',
            'not in',
            eb.selectFrom('change_item').select('after_hash').where('after_hash', 'is not', null),
          ),
        ]),
      )
      .execute()
  }
}
