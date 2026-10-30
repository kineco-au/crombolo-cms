/**
 * Anonymising a bundle before it is written (story 104, reused by 100's clone):
 * the structure travels, the people in it do not. It runs on what the export
 * gathered and before anything is serialised, so an unsanitised copy never
 * exists in the output.
 *
 * - Back-office users are removed; the destination makes one fresh local
 *   administrator. User groups stay, as structure.
 * - Members stay as placeholders — type, groups and approval kept — with name,
 *   username and email replaced, the password and every property value gone.
 * - Every email address in content, people and the dictionary is replaced, the
 *   same address by the same stand-in each time so references still agree.
 * - The site's and bundles' own tables (story 189) are default-deny: a table
 *   travels only as its owner's rules say, and one without a rule travels
 *   empty. An `email` column takes the same stand-ins as everything else.
 *
 * Tokens, sessions, external logins and form entries are never exported, so
 * there is nothing of theirs to remove. Code and schema are left alone: an
 * address in a template is the site's, not a person's.
 */
import type { BundleNode, BundleValue, ContentSet } from './model.ts'
import type { BundleMember, BundlePeople } from './people.ts'
import {
  type AnonymiseRules,
  type SiteDataRow,
  type SiteDataTable,
  siteDataName,
} from './site-data.ts'

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** The domain stand-ins use: reserved, so nothing is ever delivered to it. */
export const ANONYMISED_DOMAIN = 'example.invalid'

export interface SanitiseInput {
  set: ContentSet
  people?: BundlePeople
  /** The dictionary `.udt`, whose translations may hold addresses. */
  dictionary?: string
  siteData?: SanitiseSiteData
}

/** The tables to anonymise, with each owner's rules. */
export interface SanitiseSiteData {
  tables: readonly SiteDataTable[]
  /** By owner: `site`, or a bundle's id. */
  rules: Readonly<Record<string, AnonymiseRules | undefined>>
  /** What a scrubbed column holds: null where it may, otherwise its type's empty value. */
  empty: (owner: string, table: string, column: string) => unknown
}

export interface SanitiseResult {
  set: ContentSet
  people: BundlePeople | undefined
  dictionary: string | undefined
  siteData: SiteDataTable[] | undefined
  /** The tables no rule lets travel, as `owner.table`: they travel empty. */
  emptied: string[]
  /** How many distinct email addresses were replaced. */
  emails: number
}

export function sanitise(input: SanitiseInput): SanitiseResult {
  const standIns = new Map<string, string>()
  const standInFor = (address: string): string => {
    const known = address.toLowerCase()
    let replacement = standIns.get(known)
    if (!replacement) {
      replacement = `person-${standIns.size + 1}@${ANONYMISED_DOMAIN}`
      standIns.set(known, replacement)
    }
    return replacement
  }
  const scrub = (text: string) =>
    text.replace(EMAIL, (address) =>
      address.toLowerCase().endsWith(`@${ANONYMISED_DOMAIN}`) ? address : standInFor(address),
    )
  const deep = (value: unknown): unknown => {
    if (typeof value === 'string') return scrub(value)
    if (Array.isArray(value)) return value.map(deep)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)]))
    return value
  }

  const usernames = new Map<string, string>()
  const node = (n: BundleNode): BundleNode => ({
    ...n,
    variants: deep(n.variants) as BundleNode['variants'],
    values: n.values.map((v: BundleValue) => ({ ...v, value: deep(v.value) })),
    ...(n.access
      ? {
          access: {
            ...n.access,
            // A protected page naming a member names their stand-in; one naming
            // someone who did not travel names nobody.
            ...(n.access.memberUserNames
              ? {
                  memberUserNames: n.access.memberUserNames.flatMap((name) => {
                    const standIn = usernames.get(name.toLowerCase())
                    return standIn ? [standIn] : []
                  }),
                }
              : {}),
          },
        }
      : {}),
  })

  const member = (m: BundleMember, index: number): BundleMember => {
    const n = index + 1
    standIns.set(m.email.toLowerCase(), `member-${n}@${ANONYMISED_DOMAIN}`)
    usernames.set(m.username.toLowerCase(), `member-${n}`)
    return {
      ...m,
      name: `Member ${n}`,
      username: `member-${n}`,
      email: `member-${n}@${ANONYMISED_DOMAIN}`,
      passwordHash: null,
      passwordConfig: null,
      values: [],
    }
  }

  // Members first, so an address that belongs to one maps to their stand-in
  // wherever content mentions it.
  const people = input.people
    ? {
        memberGroups: input.people.memberGroups,
        members: input.people.members.map(member),
        userGroups: input.people.userGroups,
        users: [],
      }
    : undefined
  for (const user of input.people?.users ?? []) standInFor(user.email)

  const set = { ...input.set, nodes: input.set.nodes.map(node) }
  const dictionary = input.dictionary === undefined ? undefined : scrub(input.dictionary)

  // A member column names a member only when that member travels, as their
  // placeholder under the same key.
  const travelling = new Set((people?.members ?? []).map((m) => m.key.toLowerCase()))
  const emptied: string[] = []
  const email = (value: unknown): unknown => {
    if (typeof value !== 'string' || value === '') return value
    const whole = value.trim()
    // A column declared to hold an address is replaced even when it is not
    // shaped like one, so nothing in it travels.
    const matches = whole.match(EMAIL)
    if (!matches || (matches.length === 1 && matches[0] === whole)) {
      return whole.toLowerCase().endsWith(`@${ANONYMISED_DOMAIN}`) ? whole : standInFor(whole)
    }
    return scrub(value)
  }
  const siteData = input.siteData?.tables.map((t): SiteDataTable => {
    const rule = input.siteData?.rules[t.owner]?.[t.table]
    if (rule === undefined) {
      emptied.push(siteDataName(t.owner, t.table))
      return { ...t, rows: [] }
    }
    if (rule === 'keep') return t
    const rows = t.rows.map((row) => {
      const out: SiteDataRow = { ...row }
      for (const [column, how] of Object.entries(rule)) {
        if (!Object.hasOwn(out, column)) continue
        const value = out[column]
        if (how === 'email') out[column] = email(value)
        else if (how === 'scrub')
          out[column] = input.siteData?.empty(t.owner, t.table, column) ?? null
        else
          out[column] =
            typeof value === 'string' && travelling.has(value.toLowerCase())
              ? value
              : (input.siteData?.empty(t.owner, t.table, column) ?? null)
      }
      return out
    })
    return { ...t, rows }
  })

  return {
    set,
    people,
    dictionary,
    siteData,
    emptied,
    emails: standIns.size,
  }
}
