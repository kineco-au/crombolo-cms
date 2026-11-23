/** Opens the directory's page for a user group (story 405). */
import { UmbEntityActionBase } from '@umbraco-cms/backoffice/entity-action'
import { groupHref } from './users-managed.js'

export class CromboloOpenGroupInDirectoryAction extends UmbEntityActionBase {
  async execute() {
    const href = await groupHref(this.args.unique)
    if (href) window.open(href, '_blank', 'noopener')
  }
}

export { CromboloOpenGroupInDirectoryAction as api }
