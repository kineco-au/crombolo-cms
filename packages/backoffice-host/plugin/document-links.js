/**
 * From a page to what defines it (story 289): its content type or its template,
 * as a tree action, for whoever may open Settings, where those live.
 */
import { UmbDocumentDetailRepository } from '@umbraco-cms/backoffice/document'
import { UmbEntityActionBase } from '@umbraco-cms/backoffice/entity-action'

class CromboloDocumentLinkAction extends UmbEntityActionBase {
  async execute() {
    const target = this.args.meta.target
    const { data } = await new UmbDocumentDetailRepository(this).requestByUnique(this.args.unique)
    const unique = target === 'template' ? data?.template?.unique : data?.documentType?.unique
    if (!unique) return
    const path = `section/settings/workspace/${target}/edit/${unique}`
    history.pushState(null, '', new URL(path, document.baseURI).pathname)
  }
}

export { CromboloDocumentLinkAction as api }
