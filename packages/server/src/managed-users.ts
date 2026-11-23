/**
 * Story 389: a site whose back-office people come from a directory outside it. Only
 * the API clients `users.managedBy` names create, change, disable or delete a person,
 * or change whom a group holds; everyone else is refused, administrators included.
 * A person's own language, avatar, password and two-factor stay theirs, and API users
 * stay the administrator's. docs/configuration.md, "Users managed from outside".
 */
import type {
  Principal,
  UserGroupPort,
  UserGroupStatus,
  UserPort,
} from '@crombolo/api-management/domain'
import { normaliseUuid } from '@crombolo/core'
import { type Db, UserRepository } from '@crombolo/data'

/** What a refused change says, wherever it was asked. */
export const MANAGED_OUTSIDE =
  "This site's people come from a directory outside it: add, change or remove them there."

/** The ports, with every change to a person kept for the directory's clients. */
export function managedUserPorts(
  db: Db,
  ports: { users: UserPort; groups: UserGroupPort },
  managedBy: readonly string[],
  /** Story 405: the API clients that define the groups; none leaves them to the site. */
  groupsManagedBy: readonly string[] = [],
): { users: UserPort; groups: UserGroupPort } {
  const defined = groupsDefinedBy(ports, groupsManagedBy)
  if (managedBy.length === 0) return defined
  const clients = new Set(managedBy)
  const repository = new UserRepository(db)
  const isDirectory = (principal: Principal) =>
    principal.viaClient !== undefined && clients.has(principal.viaClient)
  const self = (principal: Principal, key: string) =>
    normaliseUuid(principal.id) === normaliseUuid(key)
  /** Whether the change is refused: someone else's, to a person rather than an API user. */
  const refused = async (principal: Principal, keys: readonly string[]): Promise<boolean> => {
    if (isDirectory(principal)) return false
    const found = await repository.byKeys(keys)
    return found.some((user) => user.kind !== 'Api')
  }
  const others = (principal: Principal, key: string) =>
    self(principal, key) ? Promise.resolve(false) : refused(principal, [key])
  const { users, groups } = defined
  return {
    users: {
      ...users,
      async create(principal, input) {
        if (input.kind !== 'Api' && !isDirectory(principal))
          return { status: 'ManagedOutside' as const }
        return users.create(principal, input)
      },
      async invite(principal, input, message) {
        if (!isDirectory(principal)) return { status: 'ManagedOutside' as const }
        return users.invite(principal, input, message)
      },
      async resendInvite(principal, key, message) {
        if (await refused(principal, [key])) return 'ManagedOutside'
        return users.resendInvite(principal, key, message)
      },
      async update(principal, key, input) {
        if (await refused(principal, [key])) return 'ManagedOutside'
        return users.update(principal, key, input)
      },
      async delete(principal, keys) {
        if (await refused(principal, keys)) return 'ManagedOutside'
        return users.delete(principal, keys)
      },
      async setApproved(principal, keys, approved) {
        if (await refused(principal, keys)) return 'ManagedOutside'
        return users.setApproved(principal, keys, approved)
      },
      async unlock(principal, keys) {
        if (await refused(principal, keys)) return 'ManagedOutside'
        return users.unlock(principal, keys)
      },
      async setGroups(principal, keys, groupKeys) {
        if (await refused(principal, keys)) return 'ManagedOutside'
        return users.setGroups(principal, keys, groupKeys)
      },
      async changePassword(principal, key, password, old) {
        if (await others(principal, key)) return 'ManagedOutside'
        return users.changePassword(principal, key, password, old)
      },
      async resetPassword(principal, key) {
        if (await others(principal, key)) return { status: 'ManagedOutside' as const }
        return users.resetPassword(principal, key)
      },
      async setAvatar(principal, key, file) {
        if (await others(principal, key)) return 'ManagedOutside'
        return users.setAvatar(principal, key, file)
      },
      async removeAvatar(principal, key) {
        if (await others(principal, key)) return 'ManagedOutside'
        return users.removeAvatar(principal, key)
      },
      async mayManage(principal, key) {
        if (await others(principal, key)) return 'ManagedOutside'
        return users.mayManage ? users.mayManage(principal, key) : 'Success'
      },
    },
    groups: {
      ...groups,
      async addUsers(principal, key, userKeys): Promise<UserGroupStatus> {
        if (await refused(principal, userKeys)) return 'ManagedOutside'
        return groups.addUsers(principal, key, userKeys)
      },
      async removeUsers(principal, key, userKeys): Promise<UserGroupStatus> {
        if (await refused(principal, userKeys)) return 'ManagedOutside'
        return groups.removeUsers(principal, key, userKeys)
      },
    },
  }
}

/** What a refused group change says (story 405). */
export const GROUPS_DEFINED_OUTSIDE =
  "This site's user groups are defined outside it: create, change or remove them there."

/**
 * Story 405: a group's definition kept for the API clients that define groups; who is
 * in a group stays 389's.
 */
function groupsDefinedBy(
  ports: { users: UserPort; groups: UserGroupPort },
  managedBy: readonly string[],
): { users: UserPort; groups: UserGroupPort } {
  if (managedBy.length === 0) return ports
  const clients = new Set(managedBy)
  const defines = (principal: Principal) =>
    principal.viaClient !== undefined && clients.has(principal.viaClient)
  const { groups } = ports
  return {
    users: ports.users,
    groups: {
      ...groups,
      async create(principal, input) {
        if (!defines(principal)) return { status: 'ManagedOutside' as const }
        return groups.create(principal, input)
      },
      async update(principal, key, input): Promise<UserGroupStatus> {
        if (!defines(principal)) return 'ManagedOutside'
        return groups.update(principal, key, input)
      },
      async delete(principal, keys): Promise<UserGroupStatus> {
        if (!defines(principal)) return 'ManagedOutside'
        return groups.delete(principal, keys)
      },
    },
  }
}

/** The directory's address for one group, `{alias}` and `{key}` filled in (story 405). */
export const managedGroupHref = (template: string, group: { key: string; alias: string }) =>
  template
    .replaceAll('{alias}', encodeURIComponent(group.alias))
    .replaceAll('{key}', encodeURIComponent(group.key))

/** The directory's address for one user, `{email}`, `{key}` and `{userName}` filled in. */
export const managedHref = (
  template: string,
  user: { key: string; email: string; userName: string },
): string =>
  template
    .replaceAll('{email}', encodeURIComponent(user.email))
    .replaceAll('{key}', encodeURIComponent(user.key))
    .replaceAll('{userName}', encodeURIComponent(user.userName))
