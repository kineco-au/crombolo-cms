/**
 * What a bundle may ask to do with the site (story 222): each permission, and
 * the sentence an administrator reads before granting it. A bundle's package
 * declares the ones it needs in `crombolo.permissions`; an administrator grants
 * the whole list, or the bundle stays off. docs/bundles.md, "Permissions".
 */

export const BUNDLE_PERMISSIONS = {
  'redirects.read': "See the site's redirects",
  'redirects.write': 'Add, change and remove redirects',
  'documents.read': "Look up the addresses of the site's pages",
  'identityProviders.read':
    'See the sign-in providers the site uses and their settings, never their secrets',
  'identityProviders.write': "Change administrators' settings for those sign-in providers",
  'media.read': 'See media in the folders it names',
  'media.write': 'Add and change media in the folders it names',
  'member.delegate':
    'Act for a signed-in member who uses it: what it adds is theirs, and it sees only what they may see',
} as const

export type BundlePermission = keyof typeof BUNDLE_PERMISSIONS

export const isBundlePermission = (value: unknown): value is BundlePermission =>
  typeof value === 'string' && Object.hasOwn(BUNDLE_PERMISSIONS, value)

/** Each permission with what it lets the bundle do, in the order declared. */
export function describePermissions(
  permissions: readonly string[],
): { permission: string; allows: string }[] {
  return permissions.map((permission) => ({
    permission,
    allows: isBundlePermission(permission) ? BUNDLE_PERMISSIONS[permission] : permission,
  }))
}

/** Why a declared list is not one, or undefined when it is. */
export function permissionsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) return '"crombolo.permissions" must be a list of permissions'
  const unknown = value.filter((permission) => !isBundlePermission(permission))
  if (unknown.length > 0)
    return `"crombolo.permissions" names ${unknown.map((p) => JSON.stringify(p)).join(', ')}, which this release does not offer: ${Object.keys(BUNDLE_PERMISSIONS).join(', ')}`
  if (new Set(value).size !== value.length) return '"crombolo.permissions" names a permission twice'
  return undefined
}
