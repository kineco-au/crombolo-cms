/**
 * Hides the media library's changes from a user without `Crombolo.Media.Update`
 * (story 088). Umbraco has no media verbs, so its actions carry no permission
 * condition; this appends one to each, and puts the media workspace in its own
 * read-only state, the one it uses for a trashed item, so the name and the
 * properties cannot be typed into either. The server refuses them regardless.
 */

export const MEDIA_UPDATE = 'Crombolo.Media.Update'

/** The vendored media actions that change something. */
export const MEDIA_CHANGES = [
  'Umb.EntityAction.Media.Create',
  'Umb.EntityAction.Media.Delete',
  'Umb.EntityAction.Media.MoveTo',
  'Umb.EntityAction.Media.SortChildrenOf',
  'Umb.EntityAction.Media.RecycleBin.Trash',
  'Umb.EntityAction.Media.RecycleBin.Restore',
  'Umb.EntityAction.Media.RecycleBin.Empty',
  'Umb.EntityBulkAction.Media.MoveTo',
  'Umb.EntityBulkAction.Media.Trash',
  'Umb.CollectionAction.Media.Create',
  'Umb.CollectionAction.Media.EmptyRecycleBin',
  'Umb.WorkspaceAction.Media.Save',
]

/** Whether a user's fallback verbs let them change media. */
export const mayChangeMedia = (verbs) => Array.isArray(verbs) && verbs.includes(MEDIA_UPDATE)

export const MEDIA_READ_ONLY = {
  type: 'workspaceContext',
  alias: 'Crombolo.WorkspaceContext.MediaReadOnly',
  name: 'Crombolo Media Read Only',
  // Loaded only in the backoffice, where its imports resolve.
  api: () => import('./media-read-only.js'),
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Media' }],
}

export const onInit = (_host, extensionRegistry) => {
  for (const alias of MEDIA_CHANGES)
    extensionRegistry.appendCondition(alias, {
      alias: 'Umb.Condition.UserPermission.Fallback',
      allOf: [MEDIA_UPDATE],
    })
  extensionRegistry.register(MEDIA_READ_ONLY)
}
