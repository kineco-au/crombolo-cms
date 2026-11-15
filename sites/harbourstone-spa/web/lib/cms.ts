import { createDeliveryClient } from '@crombolo/delivery-client'
import { CMS } from './address'
import type { DeliveryTypes } from './cms-types.gen'
import { accessToken } from './members'
import { previewToken } from './preview'

/**
 * The site, read from the browser with no key: what it publishes, a member's own
 * pages with their token, and drafts while an editor previews.
 */
export const cms = createDeliveryClient<DeliveryTypes>({
  baseUrl: CMS,
  memberToken: accessToken,
  preview: () => {
    const token = previewToken()
    return token ? { token } : undefined
  },
})
