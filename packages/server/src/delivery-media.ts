/**
 * The Delivery API's media endpoints over the database (story 197): pages of a
 * folder's children counted and ordered in SQL, items read through the media
 * cache, so no request holds the library. docs/delivery-api.md, "Media".
 */
import type { DeliveryMediaPort } from '@crombolo/api-delivery'
import { type Db, MediaListingRepository } from '@crombolo/data'
import type { MediaCache, PublishedMedia } from '@crombolo/render'

export function createDeliveryMediaPort(db: Db, media: MediaCache): DeliveryMediaPort {
  const listing = new MediaListingRepository(db)
  const inOrder = async (keys: readonly string[]) => {
    const found = await media.byKeys(keys)
    return keys.flatMap((key) => {
      const item = found.get(key.toLowerCase())
      return item ? [item] : []
    })
  }
  return {
    byKeys: inOrder,
    async byPath(path) {
      const node = await listing.byPath(path)
      return node ? media.byKey(node.key) : undefined
    },
    async children(parent, query) {
      const page = await listing.children({
        parentId: parent === 'root' ? -1 : parent.id,
        parentPath: parent === 'root' ? '-1' : parent.path,
        mediaTypes: query.filters.filter((f) => f.kind === 'mediaType').map((f) => f.value),
        names: query.filters.filter((f) => f.kind === 'name').map((f) => f.value),
        sort:
          query.sort && query.sort.field !== 'level'
            ? { field: query.sort.field, ascending: query.sort.ascending }
            : undefined,
        skip: query.skip,
        take: query.take,
        readable: query.readable,
      })
      return { total: page.total, items: await inOrder(page.keys) }
    },
    async paths(items: readonly PublishedMedia[]) {
      const ids = (item: PublishedMedia) =>
        item.path
          .split(',')
          .map(Number)
          .filter((id) => id > 0)
      const names = await listing.names(items.flatMap(ids))
      return new Map(
        items.map((item) => [
          item.id,
          `/${ids(item)
            .map((id) => (names.get(id) ?? '').toLowerCase())
            .join('/')}/`,
        ]),
      )
    },
  }
}
