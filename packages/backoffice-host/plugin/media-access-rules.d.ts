/** Types for media-access-rules.js, so a site's own tsconfig, without allowJs, checks the server against them. */

export interface GroupGrant {
  name: string
  read: boolean
  write: boolean
}
export interface MemberGrant {
  key: string
  read: boolean
  write: boolean
}
export interface Rule {
  publicRead?: boolean
  groups?: GroupGrant[]
  members?: MemberGrant[]
  newRead?: string | null
  newWrite?: string | null
  memberTypes?: string[]
  memberMaxBytes?: number | null
}
export interface ItemPolicy {
  readPolicy: string
  writePolicy: string
}
export interface AccessState {
  key?: string
  name?: string
  hasParent?: boolean
  hasFile?: boolean
  own?: Rule | null
  inherited?: (Rule & { from?: { key?: string; name: string } }) | null
  item: ItemPolicy & { creator?: { key: string; name?: string | null } | null }
  protected?: boolean
  memberGroups?: string[]
  usedBy?: string[]
}
export interface AccessView {
  read: string
  write: string
  allMembers: boolean
  groups: GroupGrant[]
  members: MemberGrant[]
  newRead: string | null
  newWrite: string | null
  memberTypes: string[]
  memberMaxBytes: number | null
}
export interface AccessForm {
  inherit: boolean
  read: string
  write: string
  allMembers?: boolean
  groups: GroupGrant[]
  members: MemberGrant[]
  newRead?: string | null
  newWrite?: string | null
  memberTypes?: string[]
  memberMaxBytes?: number | null
}
export interface AccessRequest {
  rule:
    | (Required<
        Pick<
          Rule,
          'publicRead' | 'groups' | 'newRead' | 'newWrite' | 'memberTypes' | 'memberMaxBytes'
        >
      > &
        Pick<Rule, 'members'>)
    | null
  item: ItemPolicy
}

export const PUBLIC_NOTE: string
export function summarise(state: AccessState | undefined): string
export function groupRows(rule: Rule | null | undefined, memberGroups: string[]): GroupGrant[]
export function megabytesOf(bytes: number | null | undefined): string
export function bytesOf(megabytes: string | number | null | undefined): number | null
export const READ_MODES: { value: string; label: string }[]
export const WRITE_MODES: { value: string; label: string }[]
export function accessMode(
  policy: string,
  action: 'read' | 'write',
  rule: Rule | null | undefined,
): string
export function inheritsParent(state: AccessState): boolean
export function viewOf(
  rule: Rule | null | undefined,
  item: ItemPolicy & { creator?: { key: string } | null },
  state: AccessState,
): AccessView
export function formFor(state: AccessState): AccessForm & AccessView
export function inheritedForm(state: AccessState): AccessForm & AccessView
export function describeAccess(form: AccessForm, state: AccessState): string
export function requestFor(form: AccessForm, original?: ItemPolicy): AccessRequest
export function usedByText(bundles: string[] | null | undefined): string
