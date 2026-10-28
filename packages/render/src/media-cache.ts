/**
 * Media, cached apart from the published page snapshot (story 197): the items
 * used most recently, by key and by file URL, held within a memory budget and
 * filled from indexed lookups. A media change drops only the items it touched;
 * a server that missed changes empties the cache and refills it on demand.
 * docs/rendering.md, "The media cache".
 */

import type { MediaItemAccess } from '@crombolo/core'
import { PublishedMedia } from './media.ts'
import type { PublishedProperty } from './model.ts'

/** One media item as a source loads it. */
export interface PublishedMediaNode {
  key: string
  id: number
  name: string
  mediaTypeAlias: string
  properties: PublishedProperty[]
  /** Its place in the media tree; a root item's parent is -1. */
  parentId?: number
  /** Its ancestors' ids and its own, root first. */
  path?: string
  sortOrder?: number
  createDate?: Date
  updateDate?: Date
  /** Who it says may read and change it; open when absent. */
  access?: MediaItemAccess
}

/** Where the cache fills from: indexed lookups, never a scan of the library. */
export interface MediaSource {
  /** The items with these keys that are not in the recycle bin. */
  loadMediaByKeys(keys: readonly string[]): Promise<PublishedMediaNode[]>
  /** The items whose files are served at these `/media/…` addresses, not in the bin. */
  loadMediaByUrls(urls: readonly string[]): Promise<PublishedMediaNode[]>
}

/** What a media change touched: the items, and the old paths of any that moved. */
export interface MediaChange {
  keys: readonly string[]
  /** Paths (`-1,1050,1063`) whose descendants' paths changed with them. */
  moved?: readonly string[]
}

export interface MediaCacheOptions {
  /** The memory budget in bytes; items past it are evicted, least recently used first. */
  budgetBytes?: number
}

export interface MediaCacheStats {
  items: number
  /** The estimated size of what is held, in bytes. */
  bytes: number
  budgetBytes: number
  hits: number
  misses: number
  /** Queries made to the source. */
  loads: number
  evictions: number
}

export const DEFAULT_MEDIA_CACHE_MEGABYTES = 64

interface Entry {
  media: PublishedMedia
  bytes: number
}

/** A rough size: twice the JSON of its values (UTF-16), plus the object's own fields. Pure. */
export function estimateMediaBytes(node: PublishedMediaNode): number {
  let json = 0
  try {
    json = JSON.stringify(node.properties).length
  } catch {
    json = 1024
  }
  return 2 * (json + node.name.length + node.key.length + (node.path?.length ?? 0)) + 400
}

const lower = (key: string) => key.toLowerCase()

export class MediaCache {
  #source: MediaSource
  #budget: number
  /** In recency order: the first is the least recently used. */
  #entries = new Map<string, Entry>()
  #byUrl = new Map<string, string>()
  #bytes = 0
  /** Lookups not yet sent, sent together once the current task yields. */
  #batch = new Map<string, Array<(media: PublishedMedia | undefined) => void>>()
  #batchFailures = new Map<string, Array<(error: unknown) => void>>()
  #inFlight = new Map<string, Promise<PublishedMedia | undefined>>()
  #urlsInFlight = new Map<string, Promise<PublishedMedia | undefined>>()
  /** Moves on a clear or a drop under a path, so a load that one overtook is not kept. */
  #generation = 0
  /** Keys dropped while a load of them was in flight. */
  #droppedInFlight = new Set<string>()
  #stats = { hits: 0, misses: 0, loads: 0, evictions: 0 }

  constructor(source: MediaSource, options: MediaCacheOptions = {}) {
    this.#source = source
    this.#budget = Math.max(0, options.budgetBytes ?? DEFAULT_MEDIA_CACHE_MEGABYTES * 1024 * 1024)
  }

  /** An item by key; undefined when there is none, or it is in the recycle bin. */
  byKey(key: string): Promise<PublishedMedia | undefined> {
    const id = lower(key)
    const held = this.#touch(id)
    if (held) {
      this.#stats.hits += 1
      return Promise.resolve(held)
    }
    this.#stats.misses += 1
    const pending = this.#inFlight.get(id)
    if (pending) return pending
    const loading = new Promise<PublishedMedia | undefined>((resolve, reject) => {
      const first = this.#batch.size === 0
      this.#batch.set(id, [...(this.#batch.get(id) ?? []), resolve])
      this.#batchFailures.set(id, [...(this.#batchFailures.get(id) ?? []), reject])
      if (first) queueMicrotask(() => void this.#flush())
    })
    this.#inFlight.set(id, loading)
    return loading
  }

  /** Several items by key, in one query for those not held; keyed by lowercase key. */
  async byKeys(keys: readonly string[]): Promise<Map<string, PublishedMedia>> {
    const found = await Promise.all([...new Set(keys.map(lower))].map((key) => this.byKey(key)))
    const out = new Map<string, PublishedMedia>()
    for (const media of found) if (media) out.set(lower(media.key), media)
    return out
  }

  /** The item whose file is served at this address, `/media/<folder>/<name>`. */
  byUrl(url: string): Promise<PublishedMedia | undefined> {
    const key = this.#byUrl.get(url)
    const held = key ? this.#touch(key) : undefined
    if (held) {
      this.#stats.hits += 1
      return Promise.resolve(held)
    }
    this.#stats.misses += 1
    const pending = this.#urlsInFlight.get(url)
    if (pending) return pending
    const generation = this.#generation
    this.#stats.loads += 1
    const loading = this.#source
      .loadMediaByUrls([url])
      .then((nodes) => {
        const node = nodes[0]
        if (!node) return undefined
        return this.#keep(node, generation)
      })
      .finally(() => this.#urlsInFlight.delete(url))
    this.#urlsInFlight.set(url, loading)
    return loading
  }

  /** Drops these items, so the next read loads them again. */
  drop(keys: readonly string[]): void {
    for (const key of keys) {
      const id = lower(key)
      this.#remove(id)
      if (this.#inFlight.has(id)) this.#droppedInFlight.add(id)
    }
  }

  /** Drops every item below a path (`-1,1050`), whose paths changed with a move. */
  dropUnder(path: string): void {
    const prefix = `${path},`
    for (const [key, entry] of [...this.#entries])
      if (entry.media.path.startsWith(prefix)) this.#remove(key)
    this.#generation += 1
  }

  /** Applies what a media change says it touched. */
  apply(change: MediaChange): void {
    this.drop(change.keys)
    for (const path of change.moved ?? []) this.dropUnder(path)
  }

  /** Empties the cache, as a server that missed changes does. */
  clear(): void {
    this.#entries.clear()
    this.#byUrl.clear()
    this.#bytes = 0
    this.#generation += 1
  }

  stats(): MediaCacheStats {
    return {
      items: this.#entries.size,
      bytes: this.#bytes,
      budgetBytes: this.#budget,
      ...this.#stats,
    }
  }

  async #flush(): Promise<void> {
    const batch = this.#batch
    const failures = this.#batchFailures
    this.#batch = new Map()
    this.#batchFailures = new Map()
    const keys = [...batch.keys()]
    const generation = this.#generation
    this.#stats.loads += 1
    try {
      const nodes = await this.#source.loadMediaByKeys(keys)
      const loaded = new Map<string, PublishedMedia>()
      for (const node of nodes) {
        const id = lower(node.key)
        const stale = this.#droppedInFlight.has(id)
        loaded.set(id, stale ? new PublishedMedia(node) : this.#keep(node, generation))
      }
      for (const key of keys) {
        this.#inFlight.delete(key)
        this.#droppedInFlight.delete(key)
        for (const resolve of batch.get(key) ?? []) resolve(loaded.get(key))
      }
    } catch (error) {
      for (const key of keys) {
        this.#inFlight.delete(key)
        this.#droppedInFlight.delete(key)
        for (const reject of failures.get(key) ?? []) reject(error)
      }
    }
  }

  #touch(id: string): PublishedMedia | undefined {
    const entry = this.#entries.get(id)
    if (!entry) return undefined
    this.#entries.delete(id)
    this.#entries.set(id, entry)
    return entry.media
  }

  /** Holds a loaded item, unless a clear overtook its load; evicts to stay in budget. */
  #keep(node: PublishedMediaNode, generation: number): PublishedMedia {
    const media = new PublishedMedia(node)
    if (generation !== this.#generation) return media
    const id = lower(node.key)
    const bytes = estimateMediaBytes(node)
    if (bytes > this.#budget) return media
    this.#remove(id)
    this.#entries.set(id, { media, bytes })
    this.#bytes += bytes
    if (media.url) this.#byUrl.set(media.url, id)
    while (this.#bytes > this.#budget) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) break
      this.#remove(oldest)
      this.#stats.evictions += 1
    }
    return media
  }

  #remove(id: string): void {
    const entry = this.#entries.get(id)
    if (!entry) return
    this.#entries.delete(id)
    this.#bytes -= entry.bytes
    const url = entry.media.url
    if (url && this.#byUrl.get(url) === id) this.#byUrl.delete(url)
  }
}
