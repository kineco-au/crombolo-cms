/**
 * A form workflow's secret headers (story 304), each already sealed, with the
 * URL it was set for. docs/forms.md, "Where a form may send".
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export interface FormWorkflowSecret {
  header: string
  sealed: string
  url: string
}

export class FormWorkflowSecretRepository {
  constructor(private readonly db: Db) {}

  /** One workflow's secrets, by header. */
  async of(formKey: string, workflowKey: string): Promise<Map<string, FormWorkflowSecret>> {
    const rows = await this.db.q
      .selectFrom('form_workflow_secret')
      .select(['header', 'sealed', 'url'])
      .where('form_key', '=', formKey)
      .where('workflow_key', '=', workflowKey)
      .execute()
    return new Map(rows.map((row) => [row.header, row]))
  }

  /** Sets one header's secret for `url`, or with `undefined` removes it. */
  async set(
    formKey: string,
    workflowKey: string,
    header: string,
    secret: { sealed: string; url: string } | undefined,
    by: string | null,
  ): Promise<void> {
    await this.db.q
      .deleteFrom('form_workflow_secret')
      .where('form_key', '=', formKey)
      .where('workflow_key', '=', workflowKey)
      .where('header', '=', header)
      .execute()
    if (!secret) return
    await this.db.q
      .insertInto('form_workflow_secret')
      .values({
        form_key: formKey,
        workflow_key: workflowKey,
        header,
        sealed: secret.sealed,
        url: secret.url,
        set_by: by,
        set_at: DbDate.toDb(new Date()),
      })
      .execute()
  }

  /** Forgets a form's secrets, or only those of the workflows not in `keep`. */
  async forget(formKey: string, keep: readonly string[] = []): Promise<void> {
    let query = this.db.q.deleteFrom('form_workflow_secret').where('form_key', '=', formKey)
    if (keep.length > 0) query = query.where('workflow_key', 'not in', [...keep])
    await query.execute()
  }
}
