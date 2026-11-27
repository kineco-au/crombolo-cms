/**
 * Story 432: members already here linked to an identity provider from a property they
 * hold, such as an Umbraco site's `aDObjectID`, so their first sign-in finds them. Run as
 * often as wanted: a member linked already is left, and an id another member holds is
 * refused, naming both. docs/operations.md, "Signing in through an identity provider".
 */
import { normaliseUuid } from '@crombolo/core'
import {
  AuditLog,
  type AuditSource,
  currentSchemaState,
  type Db,
  ExternalLoginRepository,
  externalLoginProvider,
  MemberRepository,
} from '@crombolo/data'

export interface MemberLinkOutcome {
  linked: number
  /** Linked to that provider already, under that id or another. */
  already: number
  /** With nothing in the property. */
  empty: number
  /** Whose id another member holds: each by key, with the other. */
  held: Array<{ member: string; heldBy: string }>
  /** Whether the site declares the provider; links to one it does not are kept, unused. */
  declared: boolean
}

/** A property's value as an id, or undefined when it holds none. */
function idIn(value: unknown): string | undefined {
  const one = Array.isArray(value) ? value[0] : value
  if (typeof one !== 'string' && typeof one !== 'number') return undefined
  const text = String(one).trim()
  return text === '' ? undefined : text
}

/** Links every member whose property holds an id and who has no link to the provider. */
export async function linkMembersByProperty(
  db: Db,
  options: {
    provider: string
    property: string
    declared: readonly string[]
    source: AuditSource
    /** Says what it would do, and writes nothing. */
    dryRun?: boolean
    /** Called after each page, for progress. */
    progress?: (done: number, total: number) => void
    /** Story 448: who asked, where a request did, so each link is audited as theirs. */
    user?: { key: string; name: string }
  },
): Promise<MemberLinkOutcome> {
  const state = await currentSchemaState(db)
  const members = new MemberRepository(db, {
    nodeState: { version: state.version, revision: state.revision },
  })
  const logins = new ExternalLoginRepository(db)
  const loginProvider = externalLoginProvider('member', options.provider)
  const outcome: MemberLinkOutcome = {
    linked: 0,
    already: 0,
    empty: 0,
    held: [],
    declared: options.declared.includes(options.provider),
  }
  // A page at a time, so a site of hundreds of thousands holds one page in memory.
  for (let skip = 0; ; skip += 500) {
    const page = await members.filter({ skip, take: 500 })
    for (const member of page.items) {
      const key = normaliseUuid(member.key)
      const content = await members.content.byKey(member.key)
      const id = idIn(content?.values.find((v) => v.alias === options.property)?.value)
      if (!id) {
        outcome.empty += 1
        continue
      }
      if ((await logins.forOwner(key)).some((login) => login.loginProvider === loginProvider)) {
        outcome.already += 1
        continue
      }
      const held = await logins.find(loginProvider, id)
      if (held && held.ownerKey !== key) {
        outcome.held.push({ member: key, heldBy: held.ownerKey })
        continue
      }
      outcome.linked += 1
      if (options.dryRun) continue
      await db.transaction(async (tx) => {
        await new ExternalLoginRepository(tx).link(key, loginProvider, id)
        await new AuditLog(tx).record({
          category: 'member',
          action: 'Link',
          source: options.source,
          ...(options.user ? { userKey: options.user.key, userName: options.user.name } : {}),
          entityType: 'Member',
          entityKey: key,
          entityName: member.name,
          detail: `Signs in through ${options.provider}, from its ${options.property}`,
        })
      })
    }
    options.progress?.(Math.min(skip + 500, page.total), page.total)
    if (skip + 500 >= page.total) break
  }
  return outcome
}
