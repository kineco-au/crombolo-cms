/**
 * The media workspace, read only for a user who may not change media (story
 * 088): the state the workspace uses for a trashed item, so the name and the
 * properties cannot be typed into. Registered by `media-permissions.js`.
 */

import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api'
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'
import { UMB_MEDIA_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/media'
import { mayChangeMedia } from './media-permissions.js'

const READ_ONLY_RULE = 'CROMBOLO_MEDIA_READ_ONLY'

/** The media workspace, read only for a user who may not change media. */
export class CromboloMediaReadOnly extends UmbControllerBase {
  #workspace
  #allowed = true

  constructor(host) {
    super(host)
    this.consumeContext(UMB_MEDIA_WORKSPACE_CONTEXT, (workspace) => {
      this.#workspace = workspace
      this.#apply()
    })
    this.consumeContext(UMB_CURRENT_USER_CONTEXT, (user) => {
      if (!user) return
      this.observe(user.fallbackPermissions, (verbs) => {
        // Not known yet is not a refusal: the workspace stays as it is until it is.
        if (verbs === undefined) return
        this.#allowed = mayChangeMedia(verbs)
        this.#apply()
      })
    })
  }

  #apply() {
    const guard = this.#workspace?.readOnlyGuard
    if (!guard) return
    if (this.#allowed) guard.removeRule(READ_ONLY_RULE)
    else guard.addRule({ unique: READ_ONLY_RULE, permitted: true })
  }
}

export { CromboloMediaReadOnly as api }
