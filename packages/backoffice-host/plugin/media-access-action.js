/** Opens the Permissions dialog for a media folder or item (story 196). */
import { UmbEntityActionBase } from '@umbraco-cms/backoffice/entity-action'
import { umbOpenModal } from '@umbraco-cms/backoffice/modal'
import { MEDIA_ACCESS_MODAL } from './media-access.js'

export class CromboloMediaAccessAction extends UmbEntityActionBase {
  async execute() {
    await umbOpenModal(this, MEDIA_ACCESS_MODAL, {
      modal: { type: 'sidebar', size: 'medium' },
      data: { unique: this.args.unique },
    }).catch(() => undefined)
  }
}

export { CromboloMediaAccessAction as api }
