/**
 * `<backoffice>/crombolo/api/dictionary/…` (story 297): what a `{#key}` chip shows
 * and changes. Anyone signed in reads the items and their words; changing them
 * asks for Translation or Settings, as Umbraco's dictionary editor does. Outside
 * the contract.
 */
import { hasSection, type Principal } from '@crombolo/api-management'
import {
  appendCacheInstruction,
  type Db,
  DictionaryRepository,
  LanguageRepository,
} from '@crombolo/data'

export interface DictionaryWordsOptions {
  db: Db
  /** Tells this node's cache the dictionary changed. */
  onChange?: () => void
  nodeId?: string
}

/** The words of each language for the editor: every language, '' where none is set. Pure. */
export function wordsByLanguage(
  languages: readonly { isoCode: string; cultureName: string; isDefault: boolean }[],
  translations: readonly { isoCode: string; translation: string }[],
): { isoCode: string; name: string; isDefault: boolean; text: string }[] {
  const text = new Map(translations.map((t) => [t.isoCode.toLowerCase(), t.translation]))
  return [...languages]
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) || a.cultureName.localeCompare(b.cultureName),
    )
    .map((l) => ({
      isoCode: l.isoCode,
      name: l.cultureName,
      isDefault: l.isDefault,
      text: text.get(l.isoCode.toLowerCase()) ?? '',
    }))
}

export async function handleDictionaryWords(
  request: Request,
  path: string,
  principal: Principal,
  options: DictionaryWordsOptions,
): Promise<Response | undefined> {
  const { db } = options
  const repo = new DictionaryRepository(db)
  const languages = await new LanguageRepository(db).all()
  const defaultIso = languages.find((l) => l.isDefault)?.isoCode.toLowerCase()

  if (path === '/words' && request.method === 'GET') {
    const items = await repo.all()
    return Response.json({
      words: items
        .map((item) => ({
          name: item.name,
          text:
            item.translations.find((t) => t.isoCode.toLowerCase() === defaultIso)?.translation ??
            '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  }

  const match = /^\/words\/([^/]+)$/.exec(path)
  if (!match) return undefined
  const item = await repo.byName(decodeURIComponent(match[1] as string))
  if (!item) return Response.json({ message: 'No dictionary item has this name.' }, { status: 404 })
  // As the Management API's dictionary: Translation, or Settings.
  const mayChange = hasSection(principal, 'translation') || hasSection(principal, 'settings')

  if (request.method === 'GET')
    return Response.json({
      name: item.name,
      mayChange,
      languages: wordsByLanguage(languages, item.translations),
    })

  if (request.method === 'PUT') {
    if (!mayChange)
      return Response.json(
        { message: 'Changing the dictionary needs access to Translation.' },
        { status: 403 },
      )
    const body = (await request.json().catch(() => ({}))) as { words?: unknown }
    const given = body.words && typeof body.words === 'object' ? body.words : {}
    const known = new Map(languages.map((l) => [l.isoCode.toLowerCase(), l.isoCode]))
    const next = new Map(item.translations.map((t) => [t.isoCode.toLowerCase(), t]))
    for (const [iso, text] of Object.entries(given as Record<string, unknown>)) {
      const isoCode = known.get(iso.toLowerCase())
      if (!isoCode || typeof text !== 'string')
        return Response.json({ message: `There is no language ${iso}.` }, { status: 400 })
      if (text.trim()) next.set(isoCode.toLowerCase(), { isoCode, translation: text })
      else next.delete(isoCode.toLowerCase())
    }
    const result = await db.transaction(async (tx) => {
      const done = await new DictionaryRepository(tx).update(item.key, {
        name: item.name,
        translations: [...next.values()],
      })
      if (done === 'Success')
        await appendCacheInstruction(tx, {
          kind: 'content',
          payload: { dictionary: true },
          by: options.nodeId,
        })
      return done
    })
    if (result !== 'Success') return Response.json({ message: result }, { status: 400 })
    options.onChange?.()
    return Response.json({
      name: item.name,
      mayChange,
      languages: wordsByLanguage(languages, [...next.values()]),
    })
  }
  return new Response('Method Not Allowed', { status: 405 })
}
