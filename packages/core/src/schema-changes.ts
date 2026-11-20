/**
 * What each kind of change to a site's definitions and files costs its content
 * (story 382), in the four classes a sync, a merge and an apply share: `none`
 * touches nothing stored; `additive` adds, and loses nothing; `data-requiring`
 * needs values converted or filled first; `breaking` loses what editors entered.
 * A removal or a rename is listed and accepted by a person whatever its class.
 */

export type ChangeClass = 'none' | 'additive' | 'data-requiring' | 'breaking'

export const CHANGE_CLASSES = {
  'type-added': 'additive',
  'type-renamed': 'additive',
  'type-described': 'none',
  'type-retired': 'additive',
  'property-added': 'additive',
  'property-renamed': 'additive',
  'property-described': 'none',
  'property-loosened': 'additive',
  'property-made-mandatory': 'data-requiring',
  'property-tightened': 'data-requiring',
  'property-editor-changed': 'breaking',
  'property-made-invariant': 'breaking',
  'property-made-varying': 'additive',
  'property-retired': 'additive',
  'property-purged': 'breaking',
  'data-type-added': 'additive',
  'data-type-changed': 'additive',
  'data-type-removed': 'additive',
  'file-added': 'additive',
  'file-changed': 'none',
  'file-removed': 'additive',
  'file-moved': 'additive',
  'page-deleted': 'breaking',
} as const satisfies Record<string, ChangeClass>

export type ChangeKind = keyof typeof CHANGE_CLASSES

/** The kinds a person accepts by name at every merge and apply, whatever they cost. */
export const ACCEPTED_BY_NAME: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  'type-renamed',
  'type-retired',
  'property-renamed',
  'property-retired',
  'property-purged',
  'data-type-removed',
  'file-removed',
  'file-moved',
  'page-deleted',
])

/** Whether a change must be accepted before it merges or applies: it loses data, removes or renames. */
export const needsAcceptance = (kind: ChangeKind): boolean =>
  CHANGE_CLASSES[kind] === 'breaking' || ACCEPTED_BY_NAME.has(kind)

/** The greater of two classes. */
export function costlier(a: ChangeClass, b: ChangeClass): ChangeClass {
  const rank: Record<ChangeClass, number> = {
    none: 0,
    additive: 1,
    'data-requiring': 2,
    breaking: 3,
  }
  return rank[b] > rank[a] ? b : a
}
