/**
 * The Permissions dialog's rules for a media folder or item (stories 204, 355):
 * the form a saved state comes to, the one-line summary, and the body a form
 * saves as. Browser-free, so the dialog, the command line and the tests share
 * one copy. docs/rendering.md, "Protected media".
 */

/**
 * @typedef {{ name: string, read: boolean, write: boolean }} GroupGrant
 * @typedef {{ key: string, read: boolean, write: boolean }} MemberGrant
 * @typedef {{
 *   publicRead?: boolean,
 *   groups?: GroupGrant[],
 *   members?: MemberGrant[],
 *   newRead?: string | null,
 *   newWrite?: string | null,
 *   memberTypes?: string[],
 *   memberMaxBytes?: number | null,
 * }} Rule
 * @typedef {{
 *   key?: string,
 *   name?: string,
 *   hasParent?: boolean,
 *   hasFile?: boolean,
 *   own?: Rule | null,
 *   inherited?: (Rule & { from?: { key?: string, name: string } }) | null,
 *   item: {
 *     readPolicy: string,
 *     writePolicy: string,
 *     creator?: { key: string, name?: string | null } | null,
 *   },
 *   protected?: boolean,
 *   memberGroups?: string[],
 *   usedBy?: string[],
 * }} AccessState
 * @typedef {{
 *   inherit: boolean,
 *   read: string,
 *   write: string,
 *   allMembers?: boolean,
 *   groups: GroupGrant[],
 *   members: MemberGrant[],
 *   newRead?: string | null,
 *   newWrite?: string | null,
 *   memberTypes?: string[],
 *   memberMaxBytes?: number | null,
 * }} AccessForm
 */

export const PUBLIC_NOTE =
  'Anyone who has the link can open these files, without signing in, and can pass the link on.'

/**
 * One line saying who can see and change a folder or file, as saved.
 * @param {AccessState | undefined} state
 * @returns {string}
 */
export const summarise = (state) => (state ? describeAccess(formFor(state), state) : '')

/**
 * The groups a rule shows: every member group on the site, ticked as the rule
 * says, and any the rule names that no longer exists.
 * @param {Rule | null | undefined} rule
 * @param {string[]} memberGroups
 * @returns {GroupGrant[]}
 */
export function groupRows(rule, memberGroups) {
  const named = new Map((rule?.groups ?? []).map((g) => [g.name.toLowerCase(), g]))
  const rows = memberGroups.map((name) => {
    const set = named.get(name.toLowerCase())
    return { name, read: set?.read ?? false, write: set?.write ?? false }
  })
  for (const g of rule?.groups ?? [])
    if (!memberGroups.some((name) => name.toLowerCase() === g.name.toLowerCase())) rows.push(g)
  return rows
}

/** Megabytes as the dialog shows a size limit; empty for none. */
export const megabytesOf = (bytes) =>
  bytes ? String(Math.round((bytes / (1024 * 1024)) * 100) / 100) : ''

/** A size limit typed in megabytes, as bytes; null when empty or not a size. */
export const bytesOf = (megabytes) => {
  const value = Number(String(megabytes ?? '').trim())
  return String(megabytes ?? '').trim() !== '' && Number.isFinite(value) && value > 0
    ? Math.round(value * 1024 * 1024)
    : null
}

/** Read audiences; the default, Enabled, lets anyone with the link see a file. */
export const READ_MODES = [
  { value: 'public', label: 'Enabled' },
  { value: 'private', label: 'Disabled' },
  { value: 'custom', label: 'Custom' },
]
/** Write audiences: members are never allowed to change files publicly. */
export const WRITE_MODES = [
  { value: 'private', label: 'No Public Access' },
  { value: 'custom', label: 'Custom' },
]

/**
 * An existing setting shown without broadening its audience.
 * @param {string} policy
 * @param {'read' | 'write'} action
 * @param {Rule | null | undefined} rule
 */
export function accessMode(policy, action, rule) {
  if (policy === 'none' || (action === 'write' && ['public', 'members'].includes(policy)))
    return 'private'
  if (policy === 'public') return 'public'
  if (policy !== 'inherit') return 'custom'
  if (action === 'read' && (!rule || rule.publicRead)) return 'public'
  const flag = action === 'read' ? 'read' : 'write'
  return [...(rule?.groups ?? []), ...(rule?.members ?? [])].some((grant) => grant[flag])
    ? 'custom'
    : 'private'
}

/** Whether a folder or item follows the folder above it, with no settings of its own. */
export const inheritsParent = (state) =>
  Boolean(state.hasParent) &&
  !state.own &&
  state.item.readPolicy === 'inherit' &&
  state.item.writePolicy === 'inherit'

/**
 * The dialog's form: the audiences a rule and an item's own policies come to.
 * A file that may only be seen by the member who added it lists that member.
 */
export function viewOf(rule, item, state) {
  const members = (rule?.members ?? []).map((m) => ({ ...m }))
  const creator = item.creator?.key
  for (const action of ['read', 'write']) {
    if (item[`${action}Policy`] !== 'creator' || !creator) continue
    const existing = members.find((m) => m.key === creator)
    if (existing) existing[action] = true
    else members.push({ key: creator, read: action === 'read', write: action === 'write' })
  }
  const kept = (value) => (value === 'creator' ? value : null)
  return {
    read: accessMode(item.readPolicy, 'read', rule),
    write: accessMode(item.writePolicy, 'write', rule),
    allMembers: item.readPolicy === 'members',
    groups: groupRows(rule, state.memberGroups ?? []),
    members,
    newRead: kept(state.own?.newRead),
    newWrite: kept(state.own?.newWrite),
    memberTypes: [...(rule?.memberTypes ?? [])],
    memberMaxBytes: rule?.memberMaxBytes ?? null,
  }
}

const INHERITED_ITEM = { readPolicy: 'inherit', writePolicy: 'inherit' }

/**
 * The form for a folder or item as saved: following the folder above, or its own settings.
 * @param {AccessState} state
 * @returns {AccessForm}
 */
export function formFor(state) {
  const inherit = inheritsParent(state)
  return {
    inherit,
    ...(inherit
      ? viewOf(state.inherited, INHERITED_ITEM, state)
      : viewOf(state.own ?? state.inherited, state.item, state)),
  }
}

/** The form when "Inherit parent permissions" is ticked again: the folder above's settings. */
export const inheritedForm = (state) => ({
  inherit: true,
  ...viewOf(state.inherited, INHERITED_ITEM, state),
})

const listed = (names) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const chosen = (form, action) => {
  const groups = form.groups.filter((g) => g[action]).map((g) => g.name)
  const count = form.members.filter((m) => m[action]).length
  return listed([...groups, ...(count ? [`${count} chosen member${count === 1 ? '' : 's'}`] : [])])
}

/**
 * Where a form's settings come from and who they let in, in a sentence or two.
 * @param {AccessForm} form
 * @param {AccessState} state
 * @returns {string}
 */
export function describeAccess(form, state) {
  const source = form.inherit
    ? state.inherited?.from
      ? `Inherited from ${state.inherited.from.name}.`
      : 'Default permissions.'
    : state.hasParent
      ? 'Set for this item.'
      : ''
  const readers = chosen(form, 'read')
  const writers = chosen(form, 'write')
  const read =
    form.read === 'public'
      ? 'Anyone with the link can see this.'
      : form.read === 'private'
        ? 'Only back-office users can see this.'
        : form.allMembers
          ? 'All signed-in members can see this.'
          : readers
            ? `Only ${readers} can see this.`
            : 'Nobody has been chosen to see this yet.'
  const write =
    form.write === 'custom' && writers ? `${writers} can change it.` : 'No members can change it.'
  return [source, read, write].filter(Boolean).join(' ')
}

/**
 * What the dialog sends: no settings of its own when it inherits, else a rule
 * holding both audiences. An all-members read nobody changed is kept as it was.
 * @param {AccessForm} form
 * @param {{ readPolicy: string, writePolicy: string }} [original]
 */
export function requestFor(form, original = INHERITED_ITEM) {
  if (form.inherit) return { rule: null, item: { ...INHERITED_ITEM } }
  const grants = (list) =>
    list
      .map((g) => ({
        ...g,
        read: form.read === 'custom' && g.read,
        write: form.write === 'custom' && g.write,
      }))
      .filter((g) => g.read || g.write)
  const members = grants(form.members)
  return {
    rule: {
      publicRead: form.read === 'public',
      groups: grants(form.groups),
      ...(members.length ? { members } : {}),
      newRead: form.newRead ?? null,
      newWrite: form.newWrite ?? null,
      memberTypes: form.memberTypes ?? [],
      memberMaxBytes: form.memberMaxBytes ?? null,
    },
    item: {
      readPolicy: form.allMembers && original.readPolicy === 'members' ? 'members' : 'inherit',
      writePolicy: 'inherit',
    },
  }
}

/** Says which site features use a folder, in a sentence. */
export const usedByText = (bundles) =>
  bundles?.length ? `Used by ${bundles.join(', ')} to store members' files.` : ''
