/**
 * Who a document write is for (story 170). Every operation is handed one, so what
 * it may do, whether approvals apply and whom the audit names never depend on how
 * the write was started. Authentication stays with the transport that made it.
 */
import type { GroupGrant, StartNodes } from '@crombolo/core'

/** A backoffice user, as far as a document write needs to know one. */
export interface ContentPrincipal {
  /** The user's key. */
  id: string
  name: string
  isAdmin: boolean
  /** Section manifest aliases, such as `Umb.Section.Content`. */
  allowedSections: readonly string[]
  hasAccessToAllLanguages: boolean
  languages: readonly string[]
  startNodes: { document: StartNodes; media: StartNodes }
  groups: readonly GroupGrant[]
}

/** Where a write came from, for the audit log. */
export interface ActorOrigin {
  source: 'request' | 'cli' | 'job'
  ipAddress?: string | null
  forwardedFor?: string | null
}

export type Actor =
  /** A signed-in user: their permissions, start nodes, languages and approvals. */
  | { kind: 'user'; principal: ContentPrincipal; origin: ActorOrigin }
  /**
   * Someone at the command line on the box: no permission checks, since they hold
   * the database, but approvals apply unless they say `skipApproval`, which the
   * audit records.
   */
  | { kind: 'operator'; name: string; skipApproval?: boolean; origin: ActorOrigin }
  /**
   * The site acting on what was already decided — a schedule, an approved
   * request, a form's workflow: no permission checks and no approval gate.
   */
  | {
      kind: 'system'
      name: string
      origin: ActorOrigin
      /** The person it acts for, when there is one: the approver of a request. */
      user?: { id: string; name: string }
      /** Said with what it did, in notifications and the audit: `approved through "Legal"`. */
      note?: string
    }

/**
 * A signed-in member, acting through a server bundle (story 198): media
 * operations only, with the media permissions deciding what they may do. A
 * document operation never takes one, which `Actor` leaving it out enforces.
 */
export interface MemberActor {
  kind: 'member'
  member: { key: string; name: string; groups: readonly string[] }
  /** What they acted through, for the audit log: the bundle's name. */
  via?: string
  origin: ActorOrigin
}

/** Who a media write is for: anyone a document write may be for, or a member. */
export type MediaActor = Actor | MemberActor

export const memberActor = (
  member: MemberActor['member'],
  options: { via?: string } & Omit<ActorOrigin, 'source'> = {},
): MemberActor => {
  const { via, ...origin } = options
  return {
    kind: 'member',
    member: { key: member.key, name: member.name, groups: [...member.groups] },
    via,
    origin: { source: 'request', ...origin },
  }
}

export const userActor = (
  principal: ContentPrincipal,
  origin: Omit<ActorOrigin, 'source'> = {},
): Actor => ({ kind: 'user', principal, origin: { source: 'request', ...origin } })

export const operatorActor = (name: string, options: { skipApproval?: boolean } = {}): Actor => ({
  kind: 'operator',
  name,
  skipApproval: options.skipApproval,
  origin: { source: 'cli' },
})

export const systemActor = (
  name: string,
  options: {
    source?: ActorOrigin['source']
    user?: { id: string; name: string }
    note?: string
  } = {},
): Actor => ({
  kind: 'system',
  name,
  origin: { source: options.source ?? 'job' },
  user: options.user,
  note: options.note,
})

/** The name an audit entry or a notification gives the actor. */
export const actorName = (actor: MediaActor): string =>
  actor.kind === 'user'
    ? actor.principal.name
    : actor.kind === 'system'
      ? (actor.user?.name ?? actor.name)
      : actor.kind === 'member'
        ? actor.member.name
        : actor.name

/** The user's key, when the actor is one; versions record it as their author. */
export const actorUserKey = (actor: MediaActor): string | null =>
  actor.kind === 'user'
    ? actor.principal.id
    : actor.kind === 'system'
      ? (actor.user?.id ?? null)
      : null

/** The member's key, when the actor is one. */
export const actorMemberKey = (actor: MediaActor): string | null =>
  actor.kind === 'member' ? actor.member.key : null

/** What the actor says alongside the change, if anything. */
export const actorNote = (actor: MediaActor): string | undefined =>
  actor.kind === 'system' ? actor.note : undefined
