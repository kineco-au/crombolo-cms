/**
 * Who a preview shows the page to (story 443): signed out, or a stand-in
 * member of groups the user chose. The stand-in is nobody, so a lookup by its
 * key finds no one and nothing can be written as it.
 */
import { ObjectTypes } from '@crombolo/core'
import type { Db } from '@crombolo/data'
import type { RequestMember } from '@crombolo/render'

export const PREVIEW_STAND_IN_KEY = '00000000-0000-0000-0000-000000000000'

const PREFIX = 'g:'

/** The member a preview as these groups' names renders as. Pure. */
export function previewStandIn(groupNames: readonly string[]): RequestMember {
  return {
    key: PREVIEW_STAND_IN_KEY,
    name: 'Preview member',
    username: '',
    email: '',
    roles: [...groupNames],
  }
}

/** The cookie's choice for these group keys. Pure. */
export const previewGroupsValue = (keys: readonly string[]) => `${PREFIX}${keys.join(',')}`

/** The group keys a cookie's choice names; none for anything else, such as a story 264 member. Pure. */
export function previewGroupKeys(value: string | undefined): string[] {
  if (!value?.startsWith(PREFIX)) return []
  return value
    .slice(PREFIX.length)
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean)
}

export interface PreviewGroup {
  key: string
  name: string
}

/** Every member group, by name. */
export async function previewGroups(db: Db): Promise<PreviewGroup[]> {
  const rows = await db.q
    .selectFrom('node')
    .select(['unique_id', 'text'])
    .where('node_object_type', '=', ObjectTypes.MemberGroup)
    .execute()
  return rows
    .map((row) => ({ key: String(row.unique_id).toLowerCase(), name: String(row.text ?? '') }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The groups among these keys that still exist, in the order chosen. Pure. */
export function chosenGroups(
  keys: readonly string[],
  groups: readonly PreviewGroup[],
): PreviewGroup[] {
  const byKey = new Map(groups.map((g) => [g.key, g]))
  return keys.flatMap((key) => byKey.get(key.toLowerCase()) ?? [])
}
