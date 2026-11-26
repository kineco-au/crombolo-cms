/**
 * Story 433: an old link to an API user in Users opens its screen in Service accounts,
 * where service accounts are looked after now.
 */
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api'
import { UMB_USER_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/user'
import { accountHref } from './service-accounts-words.js'

export class CromboloServiceAccountRedirect extends UmbControllerBase {
  constructor(host) {
    super(host)
    this.consumeContext(UMB_USER_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.kind, (kind) => {
        const key = context?.getUnique?.()
        if (kind !== 'Api' || !key) return
        const base = (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(
          /\/?$/,
          '/',
        )
        history.replaceState(null, '', `${base}${accountHref(key)}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
    })
  }
}

export { CromboloServiceAccountRedirect as api }
