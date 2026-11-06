/**
 * Migration 064: alt text on the Image media type (story 168), which a fresh
 * site gets from `BUILT_IN_MEDIA_TYPES`. One statement, so the plan can show it:
 * a site with its own `altText` keeps it, and one with no Image yet is about to
 * be given the field with the type.
 */
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { IMAGE_ALT_TEXT_ALIAS, IMAGE_ALT_TEXT_KEY } from './built-in-media-types.ts'
import { STATE_SEARCH_REMOVALS } from './search-removals.ts'

export const STATE_IMAGE_ALT_TEXT = '{c3e7a512-0064-4f0b-9d61-a8b2c4e60064}'

const TEXTSTRING_DATA_TYPE = '0cc0eba1-9960-42c9-bf9b-60e150b429ae'

export const imageAltTextMigration: Migration = {
  from: STATE_SEARCH_REMOVALS,
  to: STATE_IMAGE_ALT_TEXT,
  name: 'AddImageAltText',
  kind: 'expand',
  release: '0.51.0',
  async up(db: Db) {
    const no = sql.lit(db.dialect.boolValue(false))
    await db.q
      .insertInto('property_type')
      .columns([
        'unique_id',
        'data_type_id',
        'content_type_id',
        'property_type_group_id',
        'alias',
        'name',
        'sort_order',
        'mandatory',
        'label_on_top',
        'variations',
      ])
      .expression(
        db.q
          .selectFrom(['node as image', 'node as text_type'])
          .where('image.unique_id', '=', SYSTEM_MEDIA_TYPE_KEYS.Image)
          .where('text_type.unique_id', '=', TEXTSTRING_DATA_TYPE)
          .where(({ exists, not, selectFrom }) =>
            not(
              exists(
                selectFrom('property_type as p')
                  .select('p.id')
                  .whereRef('p.content_type_id', '=', 'image.id')
                  .where('p.alias', '=', IMAGE_ALT_TEXT_ALIAS),
              ),
            ),
          )
          .select(({ selectFrom }) => [
            sql.lit(IMAGE_ALT_TEXT_KEY).as('unique_id'),
            'text_type.id as data_type_id',
            'image.id as content_type_id',
            selectFrom('property_type_group as g')
              .select((group) => group.fn.min('g.id').as('id'))
              .whereRef('g.content_type_node_id', '=', 'image.id')
              .as('property_type_group_id'),
            sql.lit(IMAGE_ALT_TEXT_ALIAS).as('alias'),
            sql.lit('Alternative text').as('name'),
            selectFrom('property_type as p')
              .select((type) => type.fn.countAll().as('n'))
              .whereRef('p.content_type_id', '=', 'image.id')
              .as('sort_order'),
            no.as('mandatory'),
            no.as('label_on_top'),
            sql.lit(0).as('variations'),
          ]),
      )
      .execute()
  },
}
