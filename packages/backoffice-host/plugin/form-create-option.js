/**
 * Form, in the Create menu of Content Types: forms sit beside content types in
 * Structure, so a new one starts from the same place. It is saved under Forms.
 */
import { UmbEntityCreateOptionActionBase } from '@umbraco-cms/backoffice/entity-create-option-action'

export class CromboloFormCreateOptionAction extends UmbEntityCreateOptionActionBase {
  async getHref() {
    return 'section/settings/forms?new='
  }
}

export { CromboloFormCreateOptionAction as api }
