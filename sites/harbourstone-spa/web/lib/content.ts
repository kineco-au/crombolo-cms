import type {
  ApiBlockList,
  ApiElement,
  ApiMediaWithCrops,
  RichTextValue,
} from '@crombolo/delivery-client'
import { cms } from './cms'
import type { Content } from './cms-types.gen'

/** A page as the Delivery API answers it, told apart by `contentType`. */
export type Page = Content

/** A page of one content type, with its properties typed. */
export type PageOf<Alias extends Page['contentType']> = Extract<Page, { contentType: Alias }>

const props = (item: { properties: object }) => item.properties as Record<string, unknown>

/** A text property, or '' when it is empty. */
export function text(item: { properties: object }, alias: string): string {
  const value = props(item)[alias]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** The first image a media picker holds. */
export function image(item: { properties: object }, alias: string): ApiMediaWithCrops | undefined {
  const value = props(item)[alias]
  return Array.isArray(value) ? (value[0] as ApiMediaWithCrops | undefined) : undefined
}

export function richText(item: { properties: object }, alias: string): RichTextValue | undefined {
  return (props(item)[alias] as RichTextValue | null) ?? undefined
}

export function blocks(item: { properties: object }, alias: string): ApiBlockList | undefined {
  return (props(item)[alias] as ApiBlockList | null) ?? undefined
}

/** Picked elements, such as a bottling's tasting notes. */
export function elements(item: { properties: object }, alias: string): ApiElement[] {
  const value = props(item)[alias]
  return Array.isArray(value) ? (value as ApiElement[]) : []
}

/** A page's address in this app. */
export const hrefOf = (item: { route: { path: string } }) => item.route.path

/** The pages below one, in the order editors gave them; a members-only one only for its members. */
export async function childrenOf(page: { id: string }): Promise<Page[]> {
  const children = await cms.content({
    fetch: `children:${page.id}`,
    sort: 'sortOrder:asc',
    take: 100,
  })
  return children.items
}

/** A bottling's line over its name: kind, strength, and an age or a batch. */
export function specOf(bottling: { properties: object }): string {
  const parts = [text(bottling, 'kind'), text(bottling, 'abv')]
  if (text(bottling, 'age')) parts.push(`${text(bottling, 'age')} years`)
  else if (text(bottling, 'batch')) parts.push(`Batch ${text(bottling, 'batch')}`)
  return parts.filter(Boolean).join(' · ')
}

/** A picked image's address, carrying its focal point, and its size. */
export function imageOf(media: ApiMediaWithCrops): {
  src: string
  width: number
  height: number
  alt: string
} {
  const focal = media.focalPoint
  return {
    src: focal ? `${media.url}?rxy=${focal.left},${focal.top}` : media.url,
    width: media.width ?? 0,
    height: media.height ?? 0,
    alt: media.name,
  }
}
