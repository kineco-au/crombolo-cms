/** "View as a group…" in the user menu: opens the panel to choose the groups (story 314). */
import { UmbActionBase } from '@umbraco-cms/backoffice/action'
import { umbOpenModal } from '@umbraco-cms/backoffice/modal'
import { VIEW_AS_MODAL } from './view-as.js'

export class CromboloViewAsAction extends UmbActionBase {
  async execute() {
    await umbOpenModal(this, VIEW_AS_MODAL, { modal: { type: 'sidebar', size: 'small' } }).catch(
      () => undefined,
    )
  }
}

export { CromboloViewAsAction as api }
