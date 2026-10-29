/** The log viewer's saved searches, in the order they were saved. */
import type { Db } from '../database.ts'

export class LogSearchRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async all(): Promise<Array<{ name: string; query: string }>> {
    const rows = await this.#db.q
      .selectFrom('log_viewer_query')
      .select(['name', 'query'])
      .orderBy('id')
      .execute()
    return rows.map((r) => ({ name: String(r.name), query: String(r.query) }))
  }

  async byName(name: string): Promise<{ name: string; query: string } | undefined> {
    return (await this.all()).find((s) => s.name === name)
  }

  async create(name: string, query: string): Promise<'created' | 'duplicate'> {
    if (await this.byName(name)) return 'duplicate'
    await this.#db.q.insertInto('log_viewer_query').values({ name, query }).execute()
    return 'created'
  }

  async delete(name: string): Promise<boolean> {
    if (!(await this.byName(name))) return false
    await this.#db.q.deleteFrom('log_viewer_query').where('name', '=', name).execute()
    return true
  }
}
