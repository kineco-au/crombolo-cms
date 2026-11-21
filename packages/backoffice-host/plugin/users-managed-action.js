/** Opens the directory's page for a person (story 389). */
import { UmbEntityActionBase } from '@umbraco-cms/backoffice/entity-action'
import { directoryHref } from './users-managed.js'

export class CromboloOpenInDirectoryAction extends UmbEntityActionBase {
  async execute() {
    const href = await directoryHref(this.args.unique)
    if (href) window.open(href, '_blank', 'noopener')
  }
}

export { CromboloOpenInDirectoryAction as api }
