/**
 * `Crombolo.Condition.User.IsApiUser`: the user open in the workspace is an API user,
 * whom a site with its people in a directory still edits itself (story 389).
 */
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry'
import { UMB_USER_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/user'

export class CromboloIsApiUserCondition extends UmbConditionBase {
  constructor(host, args) {
    super(host, args)
    this.consumeContext(UMB_USER_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.kind, (kind) => {
        this.permitted = kind === 'Api'
      })
    })
  }
}

export { CromboloIsApiUserCondition as api }
