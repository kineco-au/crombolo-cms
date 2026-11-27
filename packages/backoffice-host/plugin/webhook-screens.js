/**
 * Settings → Webhooks: the list says "No webhooks created" when there are none, by
 * re-registering Umbraco's webhook collection with that label. A webhook's name and
 * description as fields in Details, not in the header, is the fork's (story 235).
 */
import { UMB_WEBHOOK_COLLECTION_ALIAS } from '@umbraco-cms/backoffice/webhook'

export const NO_WEBHOOKS = 'No webhooks created'

export const onInit = (_host, extensionRegistry) => {
  const collection = extensionRegistry.getByAlias(UMB_WEBHOOK_COLLECTION_ALIAS)
  if (!collection) return
  extensionRegistry.unregister(UMB_WEBHOOK_COLLECTION_ALIAS)
  extensionRegistry.register({
    ...collection,
    meta: { ...collection.meta, noItemsLabel: NO_WEBHOOKS },
  })
}
