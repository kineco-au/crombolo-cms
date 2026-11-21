/**
 * Story 392: what removing a language, a form's field or a workflow costs, which only
 * the site's data says: a language with values, a field with entries and a workflow
 * with open requests become a change that loses something, accepted by name first.
 */
import { CHANGE_CLASSES, type ChangeKind, needsAcceptance } from '@crombolo/core'
import type { Db } from '@crombolo/data'

interface Item {
  id: string
  kind: ChangeKind
  class: string
  subject: string
  accept: boolean
  says: string
}

const OPEN_REQUESTS = ['waiting', 'scheduled']

const raised = <T extends Item>(found: T, kind: ChangeKind, says: string): T => ({
  ...found,
  id: `${kind}:${found.subject}`,
  kind,
  class: CHANGE_CLASSES[kind],
  accept: needsAcceptance(kind),
  says,
})

const count = async (rows: Promise<Array<{ n: unknown }>>) => Number((await rows)[0]?.n ?? 0)

/** Each item as it costs on this site. */
export async function withLosses<T extends Item>(db: Db, items: readonly T[]): Promise<T[]> {
  const out: T[] = []
  for (const found of items) {
    if (found.kind === 'language-removed') {
      const n = await count(
        db.q
          .selectFrom('property_value as pv')
          .innerJoin('language as l', 'l.id', 'pv.language_id')
          .where('l.iso_code', '=', found.subject)
          .select((eb) => eb.fn.countAll().as('n'))
          .execute(),
      )
      out.push(
        n > 0
          ? raised(found, 'language-values-dropped', `${found.says} Its ${n} values go with it.`)
          : found,
      )
    } else if (found.kind === 'form-field-removed') {
      const [form, field] = found.subject.split('.') as [string, string]
      const n = await count(
        db.q
          .selectFrom('form_entry_value as v')
          .innerJoin('form_entry as e', 'e.id', 'v.entry_id')
          .where('e.form_alias', '=', form)
          .where('v.field_alias', '=', field)
          .select((eb) => eb.fn.countAll().as('n'))
          .execute(),
      )
      out.push(
        n > 0
          ? raised(
              found,
              'form-field-entries-orphaned',
              `${found.says} ${n} entries hold it, and the form will no longer show it.`,
            )
          : found,
      )
    } else if (found.kind === 'workflow-removed') {
      // Each request holds the workflow it was made under, whole.
      const open = await db.q
        .selectFrom('approval_request')
        .where('state', 'in', OPEN_REQUESTS)
        .select('workflow')
        .execute()
      const n = open.filter((r) => {
        try {
          return (JSON.parse(String(r.workflow)) as { alias?: string }).alias === found.subject
        } catch {
          return false
        }
      }).length
      out.push(
        n > 0
          ? raised(
              found,
              'workflow-requests-withdrawn',
              `${found.says} ${n} requests waiting under it are withdrawn.`,
            )
          : found,
      )
    } else out.push(found)
  }
  return out
}
