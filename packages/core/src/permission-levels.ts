/**
 * Permission levels (story 338): what the group editor offers in place of a
 * checkbox per verb. A level is a named set of verbs, never stored: the editor
 * writes a level's verbs, and reads a group's verbs back as the level they
 * match, or `custom`. Each kind's levels are cumulative.
 */
import {
  DocumentPermissions as D,
  ElementPermissions as E,
  FormPermissions as F,
  MediaPermissions as M,
} from './permissions.ts'

export type PermissionKind = 'pages' | 'library' | 'media' | 'forms'

export const PAGE_LEVELS = ['none', 'see', 'edit', 'publish', 'full'] as const
export const MEDIA_LEVELS = ['none', 'see', 'edit'] as const
export const FORM_LEVELS = ['none', 'see', 'manage'] as const

export type PermissionLevel = 'none' | 'see' | 'edit' | 'publish' | 'full' | 'manage'

const cumulative = (steps: readonly (readonly string[])[]) =>
  steps.map((_, i) => steps.slice(0, i + 1).flat())

const PAGES = cumulative([
  [],
  [D.Read],
  [D.Create, D.Update, D.Move, D.Duplicate, D.Sort, D.PropertyValueWrite],
  [D.Publish, D.Unpublish, D.Rollback],
  [D.Delete, D.RecycleBinRestore, D.PublicAccess, D.CultureAndHostnames, D.Permissions],
])

const LIBRARY = cumulative([
  [],
  [E.Read],
  [E.Create, E.Update, E.Move, E.Duplicate],
  [E.Publish, E.Unpublish, E.Rollback],
  [E.Delete],
])

const MEDIA = cumulative([[], [M.Read], [M.Update]])

const FORMS = cumulative([[], [F.View, F.EntriesView], [F.Manage, F.EntriesManage]])

/** Sensitive answers are a toggle beside a Forms level, not a level of their own. */
export const SENSITIVE_ANSWERS = F.EntriesSensitive

const TABLE: Record<PermissionKind, { levels: readonly PermissionLevel[]; verbs: string[][] }> = {
  pages: { levels: PAGE_LEVELS, verbs: PAGES },
  library: { levels: PAGE_LEVELS, verbs: LIBRARY },
  media: { levels: MEDIA_LEVELS, verbs: MEDIA },
  forms: { levels: FORM_LEVELS, verbs: FORMS },
}

/** Every verb a kind's levels speak for: what the editor owns of a group's verbs. */
export const kindVerbs = (kind: PermissionKind): readonly string[] => TABLE[kind].verbs.at(-1) ?? []

/** The levels a kind offers, in order. */
export const levelsOf = (kind: PermissionKind): readonly PermissionLevel[] => TABLE[kind].levels

/** The verbs a level stands for. */
export function levelVerbs(kind: PermissionKind, level: PermissionLevel): string[] {
  const at = TABLE[kind].levels.indexOf(level)
  if (at === -1) throw new Error(`${kind} has no level "${level}"`)
  return [...(TABLE[kind].verbs[at] ?? [])]
}

/** The level a group's verbs are, for one kind, or `custom` when they match none. */
export function levelOfVerbs(
  kind: PermissionKind,
  verbs: readonly string[],
): PermissionLevel | 'custom' {
  const own = new Set(kindVerbs(kind))
  const held = new Set(verbs.filter((verb) => own.has(verb)))
  const { levels, verbs: sets } = TABLE[kind]
  for (const [i, set] of sets.entries())
    if (set.length === held.size && set.every((verb) => held.has(verb)))
      return levels[i] as PermissionLevel
  return 'custom'
}

/**
 * A group's verbs with one kind set to a level: the kind's own verbs replaced,
 * everything else kept, so a level never touches another kind or a toggle.
 */
export function withLevel(
  verbs: readonly string[],
  kind: PermissionKind,
  level: PermissionLevel,
): string[] {
  const own = new Set(kindVerbs(kind))
  return [...new Set([...verbs.filter((verb) => !own.has(verb)), ...levelVerbs(kind, level)])]
}

/** A Pages verb set as the Library's, for "Same as pages". */
export function libraryLikePages(pageVerbs: readonly string[]): string[] {
  const level = levelOfVerbs('pages', pageVerbs)
  return level === 'custom' ? [] : levelVerbs('library', level)
}
