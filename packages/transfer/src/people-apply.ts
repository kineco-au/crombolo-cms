/**
 * A bundle's people, applied (story 071): planned by key, then written in the
 * content run's transaction and recorded on it, so a revert removes the people
 * it created. docs/content-transfer.md, "People".
 *
 * The same key is the same person: updated, keeping a password set or
 * re-hashed here. A different key whose e-mail or username is taken here is a
 * decision — take the bundle's details onto the person here, or leave it out.
 * Findings name people by key only.
 */
import {
  KNOWN_PERMISSIONS,
  normaliseUuid,
  ObjectTypes,
  SystemNodes,
  withoutPrunedPermissions,
} from '@crombolo/core'
import {
  AuditLog,
  type AuditSource,
  ContentTypeRepository,
  currentSchemaState,
  type Db,
  ExternalLoginRepository,
  externalLoginProvider,
  type Finding,
  type GranularPermission,
  LanguageRepository,
  MemberRepository,
  NodeRepository,
  type NodeSchemaState,
  type TransferRunRepository,
  UserGroupRepository,
  UserRepository,
} from '@crombolo/data'
import type { NodeResolutions, Resolution } from './check.ts'
import type {
  BundleExternalLogin,
  BundleGranular,
  BundleMember,
  BundlePeople,
  BundleUser,
  BundleUserGroup,
} from './people.ts'

export type PersonKind = 'member-group' | 'member' | 'user-group' | 'user'

export const PERSON_KINDS: readonly PersonKind[] = ['member-group', 'member', 'user-group', 'user']

export const isPersonKind = (kind: string): kind is PersonKind =>
  (PERSON_KINDS as readonly string[]).includes(kind)

/** What the import would do to one person or group. */
export interface PersonPlan {
  kind: PersonKind
  /** The bundle's key. */
  key: string
  action: 'create' | 'update' | 'unchanged' | 'skip'
  /** Where it lands here, when that is not its own key: matched by name, alias or answer. */
  localKey?: string
  /** The bundle's password replaces one set here: a new site's seeded administrator. */
  takePassword?: boolean
  /** A group to create, as it lands here: its verbs, the languages here and the items here (story 393). */
  group?: PlannedGroup
}

/** A user group's rights as the site will hold them, once checked against it. */
export interface PlannedGroup {
  permissions: string[]
  languages: string[]
  granular: GranularPermission[]
}

export interface PeoplePlan {
  findings: Finding[]
  plan: PersonPlan[]
  counts: Record<PersonKind, { create: number; update: number; skip: number }>
}

/** A hash set or re-hashed here, which an incoming one never replaces. */
const isLocalHash = (hash: string | null | undefined): boolean =>
  typeof hash === 'string' && hash.startsWith('$argon2')

const NOUN: Record<PersonKind, string> = {
  'member-group': 'member group',
  member: 'member',
  'user-group': 'user group',
  user: 'user',
}

const finding = (
  kind: Finding['kind'],
  code: string,
  subject: PersonKind,
  key: string,
  message: string,
): Finding => ({
  kind,
  code,
  subjectType: subject,
  subjectKey: key,
  subjectName: key,
  propertyAlias: null,
  culture: null,
  message,
  link: null,
})

const answerOf = (
  resolutions: Readonly<Record<string, NodeResolutions>>,
  key: string,
  all: Resolution | undefined,
): Resolution | undefined => resolutions[key]?.['*'] ?? all

/** Read-only: what applying these people here would do, and what needs a decision. */
export async function planPeople(
  db: Db,
  people: BundlePeople,
  options: {
    resolutions?: Readonly<Record<string, NodeResolutions>>
    resolveAll?: Resolution | undefined
    /** A user here the bundle's may take over without asking: a new site's seeded administrator. */
    adoptUsers?: boolean
    /** The pages and Library items the same bundle brings, which exist by the time people do. */
    carried?: ReadonlyMap<string, 'document' | 'element'>
    /** Story 432: the member identity providers this site declares, by id. */
    memberProviders?: readonly string[]
  } = {},
): Promise<PeoplePlan> {
  const resolutions = options.resolutions ?? {}
  const findings: Finding[] = []
  const plan: PersonPlan[] = []
  const nodes = new NodeRepository(db)
  const members = new MemberRepository(db)
  const memberTypes = new ContentTypeRepository(db, { kind: 'member' })
  const users = new UserRepository(db)
  const userGroups = new UserGroupRepository(db)

  for (const group of people.memberGroups) {
    const here = await nodes.byKey(group.key)
    if (here && here.objectType === ObjectTypes.MemberGroup) {
      plan.push({
        kind: 'member-group',
        key: group.key,
        action: here.text === group.name ? 'unchanged' : 'update',
      })
      continue
    }
    const named = await memberGroupNamed(db, group.name)
    plan.push(
      named
        ? { kind: 'member-group', key: group.key, action: 'unchanged', localKey: named }
        : { kind: 'member-group', key: group.key, action: 'create' },
    )
  }

  const languagesHere = new Set(
    (await new LanguageRepository(db).all()).map((l) => l.isoCode.toLowerCase()),
  )
  const groupFinding = (kind: Finding['kind'], code: string, group: string, message: string) =>
    findings.push(finding(kind, code, 'user-group', group, message))
  for (const group of people.userGroups) {
    const here = (await userGroups.byKey(group.key)) ?? (await userGroups.byAlias(group.alias))
    // A group here is this site's to manage: its permissions are not rewritten
    // by a bundle, only its members added.
    if (here) {
      plan.push({ kind: 'user-group', key: group.key, action: 'unchanged', localKey: here.key })
      continue
    }
    plan.push({
      kind: 'user-group',
      key: group.key,
      action: 'create',
      group: await plannedGroup(db, group, {
        languagesHere,
        carried: options.carried ?? new Map(),
        finding: (kind, code, message) => groupFinding(kind, code, group.key, message),
      }),
    })
  }

  const decide = (kind: PersonKind, key: string, clashKey: string): PersonPlan | undefined => {
    const answer = answerOf(resolutions, key, options.resolveAll)
    if (answer === 'skip') return { kind, key, action: 'skip' }
    if (answer === 'take-bundle') return { kind, key, action: 'update', localKey: clashKey }
    findings.push(
      finding(
        'person',
        'person-conflict',
        kind,
        key,
        `the ${NOUN[kind]} ${key} in the bundle has an e-mail address or username that ${NOUN[kind]} ${clashKey} already has here`,
      ),
    )
    return undefined
  }

  const missingTypes = new Set<string>()
  for (const member of people.members) {
    if (!(await memberTypes.byAlias(member.memberTypeAlias)))
      missingTypes.add(member.memberTypeAlias)
    const here = await members.byKey(member.key)
    if (here) {
      plan.push({ kind: 'member', key: member.key, action: 'update' })
      continue
    }
    const clash =
      (await memberKeyWhere(db, 'email', member.email)) ??
      (await memberKeyWhere(db, 'login_name', member.username))
    if (!clash) {
      plan.push({ kind: 'member', key: member.key, action: 'create' })
      continue
    }
    const decided = decide('member', member.key, clash)
    if (decided) plan.push(decided)
  }
  findings.push(...(await linkFindings(db, people.members, plan, options.memberProviders)))
  for (const alias of missingTypes)
    findings.push(
      finding(
        'blocking',
        'missing-member-type',
        'member',
        alias,
        `no member type "${alias}" here — deploy schema/ before importing these members`,
      ),
    )

  for (const user of people.users) {
    if (await users.byKey(user.key)) {
      plan.push({
        kind: 'user',
        key: user.key,
        action: 'update',
        ...(options.adoptUsers ? { takePassword: true } : {}),
      })
      continue
    }
    const clash = (await users.byUserName(user.userName)) ?? (await users.byEmail(user.email))
    if (!clash) {
      plan.push({ kind: 'user', key: user.key, action: 'create' })
      continue
    }
    if (options.adoptUsers) {
      plan.push({
        kind: 'user',
        key: user.key,
        action: 'update',
        localKey: clash.key,
        takePassword: true,
      })
      findings.push(
        finding(
          'auto',
          'user-adopted',
          'user',
          user.key,
          `user ${clash.key} here becomes the bundle's user ${user.key}, with the password it had there`,
        ),
      )
      continue
    }
    const decided = decide('user', user.key, clash.key)
    if (decided) plan.push(decided)
  }

  const counts = Object.fromEntries(
    PERSON_KINDS.map((kind) => [kind, { create: 0, update: 0, skip: 0 }]),
  ) as PeoplePlan['counts']
  for (const entry of plan) if (entry.action !== 'unchanged') counts[entry.kind][entry.action] += 1
  for (const kind of PERSON_KINDS) {
    const c = counts[kind]
    if (c.create + c.update > 0)
      findings.push(
        finding(
          'auto',
          'people',
          kind,
          kind,
          `${c.create} ${NOUN[kind]}(s) created, ${c.update} updated${c.skip > 0 ? `, ${c.skip} left out` : ''}`,
        ),
      )
  }
  return { findings, plan, counts }
}

/** A verb list with retired verbs read as their replacements; undefined for one that is no verb. */
function knownVerbs(verbs: readonly string[]): { verbs: string[]; unknown: string[] } {
  const replaced = withoutPrunedPermissions(verbs.filter((v) => v !== ''))
  return {
    verbs: replaced.filter((v) => KNOWN_PERMISSIONS.has(v)),
    unknown: replaced.filter((v) => !KNOWN_PERMISSIONS.has(v)),
  }
}

/** One per-item entry as rows here: undefined when the item is not here. */
async function granularRows(
  db: Db,
  entry: BundleGranular,
  carried: ReadonlyMap<string, 'document' | 'element'>,
  unknown: (verbs: string[]) => void,
): Promise<GranularPermission[] | undefined> {
  const key = normaliseUuid(entry.key)
  const context = entry.context ?? 'Document'
  if (context === 'DocumentTypeProperty') {
    const type = await new ContentTypeRepository(db).byKey(key)
    if (!type) return undefined
    const fields = new Set(type.properties.map((p) => normaliseUuid(p.key)))
    const rows: GranularPermission[] = []
    for (const permission of entry.permissions) {
      const [field = '', verb = ''] = permission.split('|')
      if (!fields.has(normaliseUuid(field))) return undefined
      const checked = knownVerbs([verb])
      unknown(checked.unknown)
      // A verb retired with nothing in its place leaves the field's explicit "nothing here".
      for (const kept of checked.verbs.length ? checked.verbs : checked.unknown.length ? [] : [''])
        rows.push({ key, permission: `${normaliseUuid(field)}|${kept}`, context })
    }
    return rows
  }
  const brought = carried.get(key)
  const here = brought ? undefined : (await new NodeRepository(db).byKey(key))?.objectType
  const isItem =
    context === 'Element'
      ? brought === 'element' || here === ObjectTypes.Element
      : brought === 'document' || here === ObjectTypes.Document
  if (!isItem) return undefined
  const checked = knownVerbs(entry.permissions)
  unknown(checked.unknown)
  return (checked.verbs.length ? checked.verbs : ['']).map((permission) => ({
    key,
    permission,
    context,
  }))
}

/** A bundle's group checked against this site: what it may do here, and findings for the rest. */
async function plannedGroup(
  db: Db,
  group: BundleUserGroup,
  here: {
    languagesHere: ReadonlySet<string>
    carried: ReadonlyMap<string, 'document' | 'element'>
    finding: (kind: Finding['kind'], code: string, message: string) => void
  },
): Promise<PlannedGroup> {
  const unknown = new Set<string>()
  const defaults = knownVerbs(group.permissions)
  for (const verb of defaults.unknown) unknown.add(verb)
  const languages: string[] = []
  for (const iso of group.hasAccessToAllLanguages ? [] : group.languages) {
    if (here.languagesHere.has(iso.toLowerCase())) languages.push(iso)
    else
      here.finding(
        'auto',
        'missing-language',
        `the user group ${group.key} may edit ${iso}, which this site does not have: it is left out`,
      )
  }
  const granular: GranularPermission[] = []
  for (const entry of group.granular ?? []) {
    if (typeof entry?.key !== 'string' || !entry.key || !Array.isArray(entry.permissions)) {
      here.finding(
        'blocking',
        'invalid-permission',
        `the user group ${group.key} has a per-item permission with no key or no verbs`,
      )
      continue
    }
    const rows = await granularRows(db, entry, here.carried, (verbs) => {
      for (const verb of verbs) unknown.add(verb)
    })
    if (rows) granular.push(...rows)
    else
      here.finding(
        'auto',
        'missing-page',
        `the user group ${group.key} has permissions on ${entry.key}, which is not here: they are left out`,
      )
  }
  for (const verb of unknown)
    here.finding(
      'blocking',
      'unknown-permission',
      `the user group ${group.key} has "${verb}", which is not a permission here; \`crombolo users groups permissions --verbs\` lists them`,
    )
  return { permissions: defaults.verbs, languages, granular }
}

async function memberGroupNamed(db: Db, name: string): Promise<string | undefined> {
  const rows = await db.q
    .selectFrom('node')
    .select('unique_id')
    .where('node_object_type', '=', ObjectTypes.MemberGroup)
    .where('text', '=', name)
    .execute()
  return rows[0] ? normaliseUuid(String(rows[0].unique_id)) : undefined
}

async function memberKeyWhere(
  db: Db,
  column: 'email' | 'login_name',
  value: string,
): Promise<string | undefined> {
  const rows = await db.q
    .selectFrom('member as m')
    .innerJoin('node as n', 'n.id', 'm.node_id')
    .select('n.unique_id')
    .where((eb) => eb(eb.fn('lower', [`m.${column}`]), '=', eb.fn('lower', [eb.val(value)])))
    .execute()
  return rows[0] ? normaliseUuid(String(rows[0].unique_id)) : undefined
}

/** Who a planned member is here: the person the bundle's is taken onto, or the bundle's own key. */
const memberTarget = (plan: readonly PersonPlan[], key: string): string | undefined => {
  const p = plan.find((entry) => entry.kind === 'member' && entry.key === key)
  if (!p || p.action === 'skip') return undefined
  return normaliseUuid(p.localKey ?? key)
}

/**
 * Story 432: what the members' links to identity providers will do. One another member
 * holds is left out, naming both; one to a provider this site does not declare is kept,
 * and said.
 */
async function linkFindings(
  db: Db,
  members: readonly BundleMember[],
  plan: readonly PersonPlan[],
  declared: readonly string[] | undefined,
): Promise<Finding[]> {
  const logins = new ExternalLoginRepository(db)
  const out: Finding[] = []
  const undeclared = new Map<string, number>()
  let arriving = 0
  for (const member of members) {
    const target = memberTarget(plan, member.key)
    if (!target || !member.externalLogins) continue
    for (const link of member.externalLogins) {
      const held = await logins.find(externalLoginProvider('member', link.provider), link.subject)
      if (held && held.ownerKey !== target) {
        out.push(
          finding(
            'auto',
            'login-held',
            'member',
            member.key,
            `the ${link.provider} sign-in of member ${member.key} is linked to member ${held.ownerKey} here, so it is left out`,
          ),
        )
        continue
      }
      arriving += 1
      if (declared && !declared.includes(link.provider))
        undeclared.set(link.provider, (undeclared.get(link.provider) ?? 0) + 1)
    }
  }
  if (arriving > 0)
    out.push(
      finding('auto', 'login-links', 'member', 'member', `${arriving} sign-in link(s) arrive`),
    )
  for (const [provider, count] of undeclared)
    out.push(
      finding(
        'auto',
        'login-provider-undeclared',
        'member',
        provider,
        `${count} sign-in link(s) to "${provider}", which this site does not declare: kept, and used once it does`,
      ),
    )
  return out
}

/**
 * Story 432: a member's links made what the bundle says, when it says anything: those it
 * does not carry go, those another member holds are left out. Each change is audited.
 */
export async function syncMemberLinks(
  tx: Db,
  owner: string,
  links: readonly BundleExternalLogin[],
  source: AuditSource,
  through: string,
): Promise<{ linked: number; unlinked: number }> {
  const logins = new ExternalLoginRepository(tx)
  const audit = new AuditLog(tx)
  const key = normaliseUuid(owner)
  const wanted = new Map(
    links.map((link) => [externalLoginProvider('member', link.provider), link.subject]),
  )
  const now = (await logins.forOwner(key)).filter((login) =>
    login.loginProvider.startsWith(externalLoginProvider('member', '')),
  )
  const providerOf = (loginProvider: string) =>
    loginProvider.slice(externalLoginProvider('member', '').length)
  let linked = 0
  let unlinked = 0
  for (const login of now) {
    if (wanted.get(login.loginProvider) === login.providerKey) continue
    if (wanted.has(login.loginProvider)) continue
    await logins.unlink(key, login.loginProvider)
    unlinked += 1
    await audit.record({
      category: 'member',
      action: 'Unlink',
      source,
      entityType: 'Member',
      entityKey: key,
      detail: `Sign-in through ${providerOf(login.loginProvider)} removed, ${through}`,
    })
  }
  for (const [loginProvider, subject] of wanted) {
    if (now.some((l) => l.loginProvider === loginProvider && l.providerKey === subject)) continue
    const held = await logins.find(loginProvider, subject)
    if (held && held.ownerKey !== key) continue
    await logins.link(key, loginProvider, subject)
    linked += 1
    await audit.record({
      category: 'member',
      action: 'Link',
      source,
      entityType: 'Member',
      entityKey: key,
      detail: `Signs in through ${providerOf(loginProvider)}, ${through}`,
    })
  }
  return { linked, unlinked }
}

/** What one applied person was before: enough for a revert to remove what it created. */
export interface AppliedPerson {
  kind: PersonKind
  key: string
  action: 'create' | 'update'
}

/** Writes the plan, inside the caller's transaction, and records each on the run. */
export async function applyPeople(
  tx: Db,
  people: BundlePeople,
  plan: readonly PersonPlan[],
  run: {
    id: string
    runs: TransferRunRepository
    nodeState: NodeSchemaState
    nodeId?: string
    /** Where the import came from, for the audit of the links it makes (story 432). */
    source?: AuditSource
  },
): Promise<AppliedPerson[]> {
  const applied: AppliedPerson[] = []
  const planFor = new Map(plan.map((p) => [`${p.kind}|${p.key}`, p]))
  const nodes = new NodeRepository(tx)
  const record = async (kind: PersonKind, key: string, action: 'create' | 'update') => {
    applied.push({ kind, key, action })
    await run.runs.record({
      runId: run.id,
      nodeKey: key,
      kind,
      action,
      beforeEventId: null,
      beforePublishedEventId: null,
      eventId: null,
    })
  }

  // Member groups first: memberships name them.
  const memberGroupKey = new Map<string, string>()
  for (const group of people.memberGroups) {
    const p = planFor.get(`member-group|${group.key}`)
    if (!p || p.action === 'skip') continue
    memberGroupKey.set(group.key, p.localKey ?? group.key)
    if (p.action === 'create') {
      await nodes.create({
        key: group.key,
        parentId: SystemNodes.Root,
        objectType: ObjectTypes.MemberGroup,
        text: group.name,
      })
      await record('member-group', group.key, 'create')
    } else if (p.action === 'update') {
      const here = await nodes.byKey(group.key)
      if (here) await nodes.rename(here.id, group.name)
      await record('member-group', group.key, 'update')
    }
  }

  const userGroups = new UserGroupRepository(tx)
  const userGroupKey = new Map<string, string>()
  for (const group of people.userGroups) {
    const p = planFor.get(`user-group|${group.key}`)
    if (!p || p.action === 'skip') continue
    userGroupKey.set(group.alias, p.localKey ?? group.key)
    if (p.action !== 'create') continue
    const starts = async (key: string | null) =>
      key && (await nodes.byKey(key)) ? { root: false, key } : { root: false, key: null }
    const planned = p.group ?? { permissions: group.permissions, languages: [], granular: [] }
    // An item the plan counted on that the run then left out has nothing to hold a permission.
    const granular: GranularPermission[] = []
    for (const row of planned.granular)
      if (row.context === 'DocumentTypeProperty' || (row.key && (await nodes.byKey(row.key))))
        granular.push(row)
    const saved = await userGroups.save({
      key: group.key,
      alias: group.alias,
      name: group.name,
      description: null,
      icon: group.icon,
      sections: group.sections,
      languages: planned.languages,
      hasAccessToAllLanguages: group.hasAccessToAllLanguages,
      startNodes: {
        document: await starts(group.documentStartNodeKey),
        media: await starts(group.mediaStartNodeKey),
        element: { root: false, key: null },
      },
      permissions: planned.permissions,
      granular,
    })
    if (saved !== 'saved') throw new Error(`The user group "${group.alias}" could not be created.`)
    await record('user-group', group.key, 'create')
  }

  const members = new MemberRepository(tx, { nodeState: run.nodeState, nodeId: run.nodeId })
  const memberTypes = new ContentTypeRepository(tx, { kind: 'member' })
  for (const member of people.members) {
    const p = planFor.get(`member|${member.key}`)
    if (!p || p.action === 'skip' || p.action === 'unchanged') continue
    const type = await memberTypes.byAlias(member.memberTypeAlias)
    if (!type)
      throw new Error(
        `No member type "${member.memberTypeAlias}", which the check should have refused.`,
      )
    const groupKeys = member.groupKeys.flatMap((k) => memberGroupKey.get(k) ?? [])
    const target = p.localKey ?? member.key
    const here = p.action === 'update' ? await members.byKey(target) : undefined
    const content = memberContent(
      member,
      type.key,
      target,
      here ? await currentValues(members, target) : [],
    )
    const identity = {
      email: member.email,
      username: member.username,
      isApproved: member.isApproved,
      isLockedOut: member.isLockedOut,
      groupKeys,
      ...(here && isLocalHash(here.passwordHash)
        ? {}
        : { passwordHash: member.passwordHash, passwordConfig: member.passwordConfig }),
    }
    if (here) {
      await members.update(target, content, identity)
      await record('member', target, 'update')
    } else {
      await members.create(content, identity)
      await record('member', member.key, 'create')
    }
    if (member.externalLogins)
      await syncMemberLinks(
        tx,
        here ? target : member.key,
        member.externalLogins,
        run.source ?? 'cli',
        'by an import',
      )
  }

  const users = new UserRepository(tx)
  for (const user of people.users) {
    const p = planFor.get(`user|${user.key}`)
    if (!p || p.action === 'skip' || p.action === 'unchanged') continue
    const groupKeys = user.groupAliases.flatMap((alias) => userGroupKey.get(alias) ?? [])
    const target = p.localKey ?? user.key
    const here = p.action === 'update' ? await users.byKey(target) : undefined
    if (here) {
      const outcome = await users.update(target, {
        name: user.name,
        userName: user.userName,
        email: user.email,
        languageIsoCode: user.languageIsoCode,
        groupKeys: [...new Set([...here.groupKeys, ...groupKeys])],
      })
      if (outcome !== 'updated')
        throw new Error(`The user ${target} could not be updated (${outcome}).`)
      if (p.takePassword || !isLocalHash(await users.passwordHash(target)))
        await setUserPassword(tx, target, user)
      await record('user', target, 'update')
    } else {
      const created = await users.create({
        key: user.key,
        name: user.name,
        userName: user.userName,
        email: user.email,
        kind: 'Default',
        groupKeys,
        languageIsoCode: user.languageIsoCode,
      })
      if (!created) throw new Error(`The user ${user.key} could not be created.`)
      await setUserPassword(tx, user.key, user)
      await record('user', user.key, 'create')
    }
    await users.setApproved([target], !user.disabled)
  }
  return applied
}

async function setUserPassword(tx: Db, key: string, user: BundleUser): Promise<void> {
  await tx.q
    .updateTable('user_account')
    .set({ password_hash: user.passwordHash, password_config: user.passwordConfig })
    .where('key', '=', normaliseUuid(key))
    .execute()
}

async function currentValues(members: MemberRepository, key: string) {
  return (await members.content.byKey(key))?.values ?? []
}

/** The member's content: the bundle's values over what is here. Pure. */
function memberContent(
  member: BundleMember,
  contentTypeKey: string,
  key: string,
  current: ReadonlyArray<{
    alias: string
    culture: string | null
    segment: string | null
    value: unknown
  }>,
) {
  const at = (alias: string, culture: string | null, segment: string | null) =>
    `${alias}|${culture ?? ''}|${segment ?? ''}`
  const merged = new Map(current.map((v) => [at(v.alias, v.culture, v.segment), v]))
  for (const v of member.values)
    merged.set(at(v.property, v.culture, v.segment), {
      alias: v.property,
      culture: v.culture,
      segment: v.segment,
      value: v.value,
    })
  return {
    key,
    contentTypeKey,
    componentKey: null,
    parentKey: null,
    values: [...merged.values()],
    variants: [{ culture: null, segment: null, name: member.name }],
  }
}

/** Removes what a run created, for a revert: members, users and groups. */
export async function removePerson(tx: Db, kind: PersonKind, key: string): Promise<boolean> {
  switch (kind) {
    case 'member':
      return new MemberRepository(tx).delete(key)
    case 'user': {
      const users = new UserRepository(tx)
      if (!(await users.byKey(key))) return false
      await users.delete(key)
      return true
    }
    case 'member-group': {
      const nodes = new NodeRepository(tx)
      const node = await nodes.byKey(key)
      if (!node || node.objectType !== ObjectTypes.MemberGroup) return false
      await tx.q.deleteFrom('member_group_member').where('member_group_id', '=', node.id).execute()
      await tx.q.deleteFrom('node').where('id', '=', node.id).execute()
      return true
    }
    case 'user-group': {
      const groups = new UserGroupRepository(tx)
      if (!(await groups.byKey(key))) return false
      return groups.delete(key).then(() => true)
    }
  }
}

/** This site's people, for a bundle: members and their groups, and users and theirs when asked. */
export async function exportPeople(
  db: Db,
  options: { members: boolean; users: boolean },
): Promise<BundlePeople> {
  const people: BundlePeople = { memberGroups: [], members: [], userGroups: [], users: [] }
  const state = await currentSchemaState(db)
  if (options.members) {
    const groups = await db.q
      .selectFrom('node')
      .select(['unique_id', 'text'])
      .where('node_object_type', '=', ObjectTypes.MemberGroup)
      .orderBy('text')
      .execute()
    people.memberGroups = groups.map((g) => ({
      key: normaliseUuid(String(g.unique_id)),
      name: String(g.text),
    }))
    const members = new MemberRepository(db, {
      nodeState: { version: state.version, revision: state.revision },
    })
    const logins = new ExternalLoginRepository(db)
    const memberLogins = externalLoginProvider('member', '')
    for (let skip = 0; ; skip += 500) {
      const page = await members.filter({ skip, take: 500 })
      for (const member of page.items) {
        const content = await members.content.byKey(member.key)
        people.members.push({
          key: member.key,
          name: member.name,
          memberTypeAlias: member.contentTypeAlias,
          email: member.email,
          username: member.username,
          isApproved: member.isApproved,
          isLockedOut: member.isLockedOut,
          passwordHash: member.passwordHash,
          passwordConfig: member.passwordConfig,
          groupKeys: await members.groupKeys(member.key),
          externalLogins: (await logins.forOwner(member.key))
            .filter((login) => login.loginProvider.startsWith(memberLogins))
            .map((login) => ({
              provider: login.loginProvider.slice(memberLogins.length),
              subject: login.providerKey,
            })),
          values: (content?.values ?? []).map((v) => ({
            property: v.alias,
            culture: v.culture,
            segment: v.segment,
            editor: v.editorAlias ?? '',
            value: v.value,
          })),
        })
      }
      if (skip + 500 >= page.total) break
    }
  }
  if (options.users) {
    const groups = await new UserGroupRepository(db).all()
    people.userGroups = groups.map((g) => ({
      key: g.key,
      alias: g.alias,
      name: g.name,
      icon: g.icon,
      sections: g.sections,
      permissions: g.permissions,
      hasAccessToAllLanguages: g.hasAccessToAllLanguages,
      languages: g.languages,
      documentStartNodeKey: g.startNodes.document.key,
      mediaStartNodeKey: g.startNodes.media.key,
      granular: bundleGranular(g.granular),
    }))
    const aliasOf = new Map(groups.map((g) => [g.key, g.alias]))
    const users = new UserRepository(db)
    for (const user of await users.all()) {
      if (user.kind !== 'Default') continue
      const row = await db.q
        .selectFrom('user_account')
        .select(['password_hash', 'password_config'])
        .where('id', '=', user.id)
        .executeTakeFirst()
      people.users.push({
        key: user.key,
        name: user.name,
        userName: user.userName,
        email: user.email,
        languageIsoCode: user.languageIsoCode,
        disabled: !user.isApproved,
        passwordHash: row?.password_hash ?? null,
        passwordConfig: row?.password_config ?? null,
        groupAliases: user.groupKeys.flatMap((k) => aliasOf.get(k) ?? []),
      })
    }
  }
  return people
}

/** A group's per-item rows as a bundle carries them: one entry per item, its verbs together. */
export function bundleGranular(rows: readonly GranularPermission[]): BundleGranular[] {
  const entries = new Map<string, BundleGranular>()
  for (const row of rows) {
    if (!row.key) continue
    if (
      row.context !== 'Document' &&
      row.context !== 'Element' &&
      row.context !== 'DocumentTypeProperty'
    )
      continue
    const id = `${row.context}|${row.key}`
    let entry = entries.get(id)
    if (!entry) {
      entry = {
        key: row.key,
        ...(row.context === 'Document' ? {} : { context: row.context }),
        permissions: [],
      }
      entries.set(id, entry)
    }
    if (row.permission !== '') entry.permissions.push(row.permission)
  }
  return [...entries.values()]
}
