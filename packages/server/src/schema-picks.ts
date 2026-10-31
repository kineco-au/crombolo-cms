/**
 * What a created bundle carries of the site's forms, approval workflows and
 * user groups (story 226): what its author picked, and what those bring. A
 * workflow brings the document types it covers and the groups its stages
 * name; a form brings the document type its "save as content" step creates.
 * What its author unticked stays out. docs/bundles.md, "The Bundle Editor".
 */
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { BundleSchemaPicks } from '@crombolo/data'
import type { LoadedSchema, SchemaSet } from '@crombolo/schema'
import type { BundleFile } from '@crombolo/transfer'

export type SchemaPickKind = 'form' | 'workflow' | 'userGroup' | 'documentType'

/** One thing a bundle carries, and why: picked, or brought by a pick. */
export interface CarriedPick {
  kind: SchemaPickKind
  alias: string
  /** Absent for what was picked; the pick that brought it, otherwise. */
  for?: { kind: SchemaPickKind; alias: string; name: string }
  /** Brought by a pick and unticked: it is not carried. */
  excluded?: boolean
}

const id = (kind: SchemaPickKind, alias: string) => `${kind}:${alias}`.toLowerCase()

/** Everything the picks carry, and what they would have brought and were unticked. Pure. */
export function carriedPicks(set: SchemaSet, picks: BundleSchemaPicks): CarriedPick[] {
  const out: CarriedPick[] = []
  const seen = new Set<string>()
  const excluded = new Set(picks.excluded.map((entry) => entry.toLowerCase()))
  const add = (pick: CarriedPick) => {
    const key = id(pick.kind, pick.alias)
    if (seen.has(key)) return
    seen.add(key)
    out.push(pick.for && excluded.has(key) ? { ...pick, excluded: true } : pick)
  }
  for (const alias of picks.forms) add({ kind: 'form', alias })
  for (const alias of picks.workflows) add({ kind: 'workflow', alias })
  for (const alias of picks.userGroups) add({ kind: 'userGroup', alias })
  for (const alias of picks.workflows) {
    const workflow = (set.workflows ?? []).find(
      (w) => w.alias.toLowerCase() === alias.toLowerCase(),
    )
    if (!workflow) continue
    const by = { kind: 'workflow' as const, alias: workflow.alias, name: workflow.name }
    for (const type of workflow.appliesTo.contentTypes)
      add({ kind: 'documentType', alias: type, for: by })
    for (const stage of workflow.stages)
      for (const group of stage.approvers) add({ kind: 'userGroup', alias: group, for: by })
  }
  for (const alias of picks.forms) {
    const form = (set.forms ?? []).find((f) => f.alias.toLowerCase() === alias.toLowerCase())
    if (!form) continue
    const by = { kind: 'form' as const, alias: form.alias, name: form.name }
    for (const step of form.workflows)
      if (step.type === 'saveAsContent' && typeof step.settings['content-type'] === 'string')
        add({ kind: 'documentType', alias: step.settings['content-type'], for: by })
  }
  return out
}

const FILE_KEY: Record<SchemaPickKind, (alias: string) => string> = {
  form: (alias) => `form:${alias}`,
  workflow: (alias) => `workflow:${alias}`,
  userGroup: (alias) => `user-group:${alias}`,
  documentType: (alias) => alias,
}

/** The site's own files for what is carried, at their `schema/` paths. */
export function schemaPickFiles(
  loaded: Pick<LoadedSchema, 'files'>,
  schemaDir: string,
  carried: readonly CarriedPick[],
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): BundleFile[] {
  const files: BundleFile[] = []
  for (const pick of carried) {
    if (pick.excluded) continue
    const file = loaded.files.get(FILE_KEY[pick.kind](pick.alias))
    if (!file?.startsWith(schemaDir)) continue
    const rel = relative(schemaDir, file).split(sep).join('/')
    files.push({ path: `schema/${rel}`, text: read(file) })
  }
  return files
}
