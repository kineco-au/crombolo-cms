/**
 * `Crombolo.Condition.VariesByEnvironment`: a page's property that varies by
 * environment (story 387), for its "Values per environment" action.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry'
import { UMB_PROPERTY_CONTEXT } from '@umbraco-cms/backoffice/property'
import { readPageValues } from './environment-values.js'

export class CromboloVariesByEnvironmentCondition extends UmbConditionBase {
  #alias
  #key

  constructor(host, args) {
    super(host, args)
    this.permitted = false
    this.consumeContext(UMB_PROPERTY_CONTEXT, (property) => {
      this.observe(property?.alias, (alias) => {
        this.#alias = alias
        this.#check()
      })
    })
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
      this.observe(workspace?.unique, (unique) => {
        this.#key = unique
        this.#check()
      })
    })
  }

  async #check() {
    if (!this.#alias || !this.#key) return
    const items = await readPageValues(this.#key)
    this.permitted = items.some((item) => item.alias === this.#alias)
  }
}

export default CromboloVariesByEnvironmentCondition

export { CromboloVariesByEnvironmentCondition as api }
