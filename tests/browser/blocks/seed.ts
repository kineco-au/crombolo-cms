/**
 * Story 456: what the browser site's server holds before the block journeys begin,
 * written through the repository, which `serve.ts` alone may reach: the journeys run
 * in Node, where the data layer does not load.
 */
import { ContentTypeRepository, type Db, DocumentRepository } from '@crombolo/data'
import { BLOCK_KEYS, STORED_PROBLEM_HOLDER, STORED_PROBLEM_PAGE } from './site.ts'

/**
 * The draft saved before the rules (story 456), written past them as content saved
 * by an earlier release was: never published, so it routes nowhere.
 */
export async function seedBlockProblem(
  db: Db,
  nodeState: { version: string; revision: string },
): Promise<void> {
  const types = new ContentTypeRepository(db)
  const typeKey = (await types.byAlias('blocksPage'))?.key
  const holderKey = (await types.byAlias('blocksHolder'))?.key
  if (!typeKey || !holderKey) throw new Error('The blocks page types are missing')
  const card = (key: string, title: string | null) => ({
    key,
    contentTypeKey: BLOCK_KEYS.card,
    values:
      title === null
        ? []
        : [
            {
              alias: 'title',
              editorAlias: 'Umbraco.TextBox',
              culture: null,
              segment: null,
              value: title,
            },
          ],
  })
  const contents = [card(crypto.randomUUID(), 'Fine card'), card(crypto.randomUUID(), null)]
  const docs = new DocumentRepository(db, { nodeState })
  // Below a page of its own: Content opens on the first page at the root (story 288), and
  // this one, opened, is changed by the editor filling in its blocks.
  const holder = await docs.create({
    key: crypto.randomUUID(),
    contentTypeKey: holderKey,
    componentKey: null,
    parentKey: null,
    values: [],
    variants: [{ culture: null, segment: null, name: STORED_PROBLEM_HOLDER }],
  })
  await docs.create({
    key: crypto.randomUUID(),
    contentTypeKey: typeKey,
    componentKey: null,
    parentKey: holder.key,
    values: [
      {
        alias: 'cards',
        culture: null,
        segment: null,
        value: {
          layout: { 'Umbraco.BlockList': contents.map((c) => ({ contentKey: c.key })) },
          contentData: contents,
          settingsData: [],
          expose: contents.map((c) => ({ contentKey: c.key, culture: null, segment: null })),
        },
      },
    ],
    variants: [{ culture: null, segment: null, name: STORED_PROBLEM_PAGE }],
  })
}
