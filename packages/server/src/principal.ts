/**
 * What a signed-in person may do, as every check in the Management API reads
 * it: built the one way for the server and for the command line (story 350).
 */
import type { Principal } from '@crombolo/api-management/domain'
import type { ResolvedIdentity } from '@crombolo/auth'
import type { Db } from '@crombolo/data'
import { loadAccess } from './access.ts'

export async function principalOf(
  db: Db,
  identity: Omit<ResolvedIdentity, 'sessionId'>,
  viaToken?: Principal['viaToken'],
): Promise<Principal> {
  return {
    id: identity.user.key,
    userName: identity.user.login,
    name: identity.user.userName,
    email: identity.user.email,
    isAdmin: identity.isAdmin,
    languageIsoCode: identity.user.language ?? undefined,
    avatarUrls: identity.user.avatar ? [identity.user.avatar] : [],
    allowedSections: identity.allowedSections,
    permissions: identity.permissions,
    groupKeys: identity.groupKeys,
    hasAccessToAllLanguages: identity.hasAccessToAllLanguages,
    ...(await loadAccess(
      db,
      identity.user.id,
      identity.viewingAs ? identity.groupKeys : undefined,
    )),
    ...(identity.viewingAs ? { viewingAs: identity.viewingAs } : {}),
    ...(viaToken ? { viaToken } : {}),
  }
}
