/**
 * The element types made from forms (story 239): one per form, allowed in the
 * Library, in a "Forms" folder. Derived from the forms, never from a file of
 * their own, so they are kept here rather than by the schema sync.
 *
 * A form removed retires its type when no Library form uses it; one still in
 * use stays, so its Library forms survive and show as using a missing form.
 */
import {
  type ContentTypeAggregate,
  LIBRARY_FORM_PROPERTIES,
  libraryFormId,
  libraryFormPropertyKey,
  libraryFormTypeAlias,
  libraryFormTypeKey,
  ObjectTypes,
  type SchemaForm,
} from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { ContentTypeRepository } from '../repositories/content-types.ts'
import { DataTypeRepository } from '../repositories/data-types.ts'
import { FolderRepository } from '../repositories/folders.ts'

export const FORM_LIBRARY_FOLDER = 'Forms'

export interface FormLibraryTypesReport {
  created: string[]
  updated: string[]
  retired: string[]
  /** A form whose type's alias another type already has. */
  clashes: string[]
}

type FormLike = Pick<SchemaForm, 'key' | 'alias' | 'name'>

function aggregateFor(
  form: FormLike,
  dataTypeKeys: Map<string, string>,
  parentKey: string | null,
): ContentTypeAggregate {
  const formKey = libraryFormId(form)
  const key = libraryFormTypeKey(formKey)
  const tabKey = libraryFormPropertyKey(key, '#tab')
  return {
    key,
    alias: libraryFormTypeAlias(form),
    name: form.name,
    description: `Made from the ${form.name} form.`,
    icon: 'icon-inbox',
    allowedAsRoot: false,
    variesByCulture: false,
    variesBySegment: false,
    isElement: true,
    allowedInLibrary: true,
    collectionKey: null,
    cleanup: {
      preventCleanup: false,
      keepAllVersionsNewerThanDays: null,
      keepLatestVersionPerDayForDays: null,
    },
    containers: [
      { key: tabKey, name: 'Form', alias: 'form', type: 'Tab', sortOrder: 0, parentKey: null },
    ],
    properties: LIBRARY_FORM_PROPERTIES.map((p, sortOrder) => ({
      key: libraryFormPropertyKey(key, p.alias),
      alias: p.alias,
      name: p.name,
      description: p.description,
      dataTypeKey: dataTypeKeys.get(p.dataType) ?? '',
      containerKey: tabKey,
      sortOrder,
      variesByCulture: false,
      variesBySegment: false,
      mandatory: false,
      mandatoryMessage: null,
      regEx: null,
      regExMessage: null,
      labelOnTop: false,
    })),
    compositions: [],
    allowedContentTypes: [],
    allowedComponentKeys: [],
    defaultComponentKey: null,
    parentKey,
    formKey,
  }
}

/** What a saved type would change: its name, alias, folder or fields. */
const differs = (a: ContentTypeAggregate, b: ContentTypeAggregate): boolean =>
  a.name !== b.name ||
  a.alias !== b.alias ||
  a.parentKey !== b.parentKey ||
  a.formKey !== b.formKey ||
  a.properties.length !== b.properties.length ||
  a.properties.some((p, i) => {
    const q = b.properties[i]
    return !q || q.key !== p.key || q.name !== p.name || q.dataTypeKey !== p.dataTypeKey
  })

/** Brings the types made from forms in line with `forms`. Idempotent. */
export async function ensureFormLibraryTypes(
  db: Db,
  forms: readonly FormLike[],
): Promise<FormLibraryTypesReport> {
  const report: FormLibraryTypesReport = { created: [], updated: [], retired: [], clashes: [] }
  const types = new ContentTypeRepository(db, { kind: 'document' })
  const dataTypes = new DataTypeRepository(db)
  const dataTypeKeys = new Map<string, string>()
  for (const { dataType } of LIBRARY_FORM_PROPERTIES) {
    const found = await dataTypes.byAlias(dataType)
    if (found) dataTypeKeys.set(dataType, found.key)
  }
  const folders = new FolderRepository(
    db,
    ObjectTypes.DocumentTypeContainer,
    ObjectTypes.DocumentType,
  )
  const parentKey = forms.length > 0 ? await folders.ensurePath([FORM_LIBRARY_FOLDER]) : null

  const wanted = new Set<string>()
  for (const form of forms) {
    const aggregate = aggregateFor(form, dataTypeKeys, parentKey)
    wanted.add(aggregate.key)
    const taken = await types.byAlias(aggregate.alias)
    if (taken && taken.key !== aggregate.key) {
      report.clashes.push(form.alias)
      continue
    }
    const existing = await types.byKey(aggregate.key)
    // `taken` is only a live type: a retired one is revived by saving it.
    if (existing && taken && !differs(existing, aggregate)) continue
    await types.save(aggregate)
    if (existing) report.updated.push(aggregate.alias)
    else report.created.push(aggregate.alias)
  }

  const made = await db.q
    .selectFrom('content_type as ct')
    .innerJoin('node as n', 'n.id', 'ct.node_id')
    .select(['n.unique_id', 'ct.alias', 'ct.node_id'])
    .where('ct.form_key', 'is not', null)
    .where('ct.retired_at', 'is', null)
    .execute()
  for (const row of made) {
    const key = String(row.unique_id).toLowerCase()
    if (wanted.has(key)) continue
    if ((await types.contentCount(key)) > 0) continue
    await db.q
      .updateTable('content_type')
      .set({ retired_at: DbDate.toDb(new Date()) })
      .where('node_id', '=', row.node_id)
      .execute()
    report.retired.push(String(row.alias))
  }
  return report
}

/** One Library form, as a picker and the entries filter list it. */
export interface LibraryFormItem {
  key: string
  name: string
  /** The form it is made from. */
  formKey: string
  published: boolean
}

/** Every Library form not in the recycle bin, by name. */
export async function listLibraryForms(db: Db): Promise<LibraryFormItem[]> {
  const rows = await db.q
    .selectFrom('node as n')
    .innerJoin('content as c', 'c.node_id', 'n.id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .innerJoin('document as d', 'd.node_id', 'n.id')
    .select(['n.unique_id', 'n.text', 'ct.form_key', 'd.published'])
    .where('n.node_object_type', '=', ObjectTypes.Element)
    .where('n.trashed', '=', db.dialect.boolValue(false) as boolean)
    .where('ct.form_key', 'is not', null)
    .orderBy('n.text')
    .execute()
  return rows.map((row) => ({
    key: String(row.unique_id).toLowerCase(),
    name: row.text ?? '',
    formKey: String(row.form_key),
    published: fromDbBool(row.published),
  }))
}
