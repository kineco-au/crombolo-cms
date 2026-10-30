import type {
  ApiBlockList,
  ApiElement,
  ApiMediaWithCrops,
  ContentItem,
  RichTextValue,
} from '@crombolo/next-integration'
import { crombolo } from './crombolo'

/** A page as the Delivery API answers it: its properties by alias. */
export type Page = ContentItem

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
  return props(item)[alias] as RichTextValue | undefined
}

export function blocks(item: { properties: object }, alias: string): ApiBlockList | undefined {
  return props(item)[alias] as ApiBlockList | undefined
}

/** Picked elements, such as a bottling's tasting notes. */
export function elements(item: { properties: object }, alias: string): ApiElement[] {
  const value = props(item)[alias]
  return Array.isArray(value) ? (value as ApiElement[]) : []
}

/** A page's address in this app. */
export const hrefOf = (item: Page) => item.route.path

/** The home page and the pages below it, in the order editors gave them. */
export async function siteTree(): Promise<{ home: Page | undefined; sections: Page[] }> {
  const home = await crombolo.page('/')
  if (!home.ok) return { home: undefined, sections: [] }
  return { home: home.value, sections: await childrenOf(home.value) }
}

export async function childrenOf(page: Page): Promise<Page[]> {
  const children = await crombolo.content({
    fetch: `children:${page.id}`,
    sort: 'sortOrder:asc',
    take: 100,
  })
  return children.items
}

/** A bottling's line over its name: kind, strength, and an age or a batch. */
export function specOf(bottling: Page): string {
  const parts = [text(bottling, 'kind'), text(bottling, 'abv')]
  if (text(bottling, 'age')) parts.push(`${text(bottling, 'age')} years`)
  else if (text(bottling, 'batch')) parts.push(`Batch ${text(bottling, 'batch')}`)
  return parts.filter(Boolean).join(' · ')
}
