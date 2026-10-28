/**
 * Who may read and change a media item (story 196). A folder or item may carry
 * a rule naming member groups that may read and write; the nearest rule on an
 * item's path governs, as for protected pages. Each item also has its own read
 * and write policy, stamped from the folder's defaults when it was created.
 */

/** An item's own setting: `inherit` follows the nearest rule. */
export type MediaPolicy = 'inherit' | 'public' | 'groups' | 'creator' | 'none'

/** Who may see a file created in a folder later. */
export type NewMediaRead = 'public' | 'groups' | 'creator'
/** Who may change a file created in a folder later. */
export type NewMediaWrite = 'groups' | 'creator' | 'none'

export const MEDIA_POLICIES: readonly MediaPolicy[] = [
  'inherit',
  'public',
  'groups',
  'creator',
  'none',
]
export const NEW_MEDIA_READ: readonly NewMediaRead[] = ['public', 'groups', 'creator']
export const NEW_MEDIA_WRITE: readonly NewMediaWrite[] = ['groups', 'creator', 'none']

/** A rule set on a media folder or item, governing it and everything below that sets none. */
export interface MediaRule {
  /** The node the rule is set on. */
  nodeId: number
  /** Anyone may read, whatever the groups say. */
  publicRead: boolean
  readGroups: readonly string[]
  writeGroups: readonly string[]
  /** What files created below get; null leaves them following the rule. */
  newRead: NewMediaRead | null
  newWrite: NewMediaWrite | null
  /** File types a member may upload below (story 198), by name; empty is none. */
  memberTypes: readonly string[]
  /** The largest file a member may upload below, in bytes; null sets no limit of its own. */
  memberMaxBytes: number | null
}

/** What an item says about itself. */
export interface MediaItemAccess {
  readPolicy: MediaPolicy
  writePolicy: MediaPolicy
  /** The member who created it, by key. */
  creatorMemberKey: string | null
}

/** The member asking, by key and the names of their groups. */
export interface MediaMember {
  key: string
  groups: readonly string[]
}

export const OPEN_MEDIA: MediaItemAccess = {
  readPolicy: 'inherit',
  writePolicy: 'inherit',
  creatorMemberKey: null,
}

export const parseMediaPolicy = (value: unknown): MediaPolicy =>
  MEDIA_POLICIES.includes(value as MediaPolicy) ? (value as MediaPolicy) : 'inherit'

/** The nearest rule on a path of node ids (`-1,1050,1063`), the node's own first. Pure. */
export function nearestMediaRule(
  path: string,
  rules: ReadonlyMap<number, MediaRule>,
): MediaRule | undefined {
  const ids = path.split(',').map(Number)
  for (let i = ids.length - 1; i >= 0; i--) {
    const rule = rules.get(ids[i] as number)
    if (rule) return rule
  }
  return undefined
}

const inGroups = (names: readonly string[], member: MediaMember | undefined) => {
  if (!member) return false
  const held = new Set(member.groups.map((g) => g.toLowerCase()))
  return names.some((name) => held.has(name.toLowerCase()))
}

/**
 * Whether a member, or a visitor when `member` is undefined, may read or change
 * an item. The item's own policy wins; `inherit` follows the nearest rule, and
 * with no rule anyone may read and no member may change. Groups match in any
 * case. Pure.
 */
export function memberMay(
  action: 'read' | 'write',
  item: MediaItemAccess,
  rule: MediaRule | undefined,
  member: MediaMember | undefined,
): boolean {
  const policy = action === 'read' ? item.readPolicy : item.writePolicy
  const groups = action === 'read' ? (rule?.readGroups ?? []) : (rule?.writeGroups ?? [])
  switch (policy) {
    case 'public':
      return action === 'read'
    case 'groups':
      return inGroups(groups, member)
    case 'creator':
      return (
        member !== undefined &&
        item.creatorMemberKey !== null &&
        member.key.toLowerCase() === item.creatorMemberKey.toLowerCase()
      )
    case 'none':
      return false
    case 'inherit':
      if (action === 'read') return !rule || rule.publicRead || inGroups(groups, member)
      return inGroups(groups, member)
  }
}

/** Whether an item is closed to a visitor who is not signed in. Pure. */
export const isProtectedMedia = (item: MediaItemAccess, rule: MediaRule | undefined): boolean =>
  !memberMay('read', item, rule, undefined)

/** The policies a new file gets from the rule above it. Pure. */
export function stampedPolicies(rule: MediaRule | undefined): {
  readPolicy: MediaPolicy
  writePolicy: MediaPolicy
} {
  return { readPolicy: rule?.newRead ?? 'inherit', writePolicy: rule?.newWrite ?? 'inherit' }
}
