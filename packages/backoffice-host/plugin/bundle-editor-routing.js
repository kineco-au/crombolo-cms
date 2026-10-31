/**
 * Which workspace the Created view opens (story 233): Crombolo's Bundle Editor
 * alone when it is registered. Its manifest overwrites Umbraco's builder, but
 * the routes are ours, so they do not rely on that alone. Pure, for a test.
 */
export const BUNDLE_EDITOR_ALIAS = 'Crombolo.Workspace.BundleEditor'
export const UMBRACO_BUILDER_ALIAS = 'Umb.Workspace.PackageBuilder'

export function editorsOf(workspaces) {
  return workspaces.some((workspace) => workspace.alias === BUNDLE_EDITOR_ALIAS)
    ? workspaces.filter((workspace) => workspace.alias !== UMBRACO_BUILDER_ALIAS)
    : workspaces
}
