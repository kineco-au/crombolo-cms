/**
 * A site for story 355's media commands: an article type that uses media three
 * ways (a media picker, a multi-URL link and an image in rich text), and the
 * media and pages made through the back office's own API.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { type Harness, V1 } from './harness.ts'

const ARTICLE = `[content-type]
alias = "article"
name = "Article"
allow-at-root = true
allow-children = ["article"]
components = ["article"]
default-component = "article"

[[property]]
alias = "hero"
name = "Hero"
type = "imageMediaPicker"

[[property]]
alias = "links"
name = "Links"
type = "multiUrlPicker"

[[property]]
alias = "body"
name = "Body"
type = "richtext"
`

const VIEW = `export default async function Article({ model }) {
  const hero = await model.value('hero')
  const links = (await model.value('links')) ?? []
  return (
    <main>
      <img class="hero" src={hero?.url} />
      <ul>{links.map((l) => <li><a class="link" href={l.url}>{l.name}</a></li>)}</ul>
      <div class="body">{model.html('body')}</div>
    </main>
  )
}
`

/** The article type and its view, into a site's schema and components folders. */
export function writeArticleSchema(schemaDir: string, componentsDir: string): void {
  mkdirSync(join(schemaDir, 'content-types'), { recursive: true })
  mkdirSync(componentsDir, { recursive: true })
  writeFileSync(join(schemaDir, 'content-types', 'article.toml'), ARTICLE)
  writeFileSync(join(componentsDir, 'article.tsx'), VIEW)
}

/** A small PNG, `width` by `height`. */
export async function png(width = 4, height = 3): Promise<Uint8Array<ArrayBuffer>> {
  const source = await Bun.file(join(import.meta.dir, '..', 'fixtures', 'pixel.png')).bytes()
  return new Uint8Array(
    await new Bun.Image(source).resize(width, height, { fit: 'fill' }).png().bytes(),
  )
}

export interface MadeMedia {
  key: string
  src: string
}

/** Media, member groups and pages made as the back office makes them, signed in as `h`. */
export function mediaMaker(h: Harness) {
  const upload = async (file: File) => {
    const id = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', id)
    form.set('File', file)
    const done = await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })
    if (done.status !== 201) throw new Error(`upload ${file.name}: ${done.status}`)
    return id
  }
  const create = async (type: string, name: string, parent: string | null, values: unknown[]) => {
    const response = await h.post(`${V1}/media`, {
      mediaType: { id: type },
      parent: parent ? { id: parent } : null,
      values,
      variants: [{ culture: null, segment: null, name }],
    })
    if (response.status !== 201)
      throw new Error(`create ${name}: ${response.status} ${await response.text()}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const srcOf = async (key: string) => {
    const read = await h.json<{ values: Array<{ alias: string; value: unknown }> }>(
      `${V1}/media/${key}`,
    )
    const file = read.values.find((v) => v.alias === 'umbracoFile')?.value
    return typeof file === 'string' ? file : ((file as { src?: string } | undefined)?.src ?? '')
  }
  return {
    srcOf,
    folder: (name: string, parent: string | null = null) =>
      create(SYSTEM_MEDIA_TYPE_KEYS.Folder, name, parent, []),
    async image(
      name: string,
      parent: string | null = null,
      extra: { alt?: string; focalPoint?: { left: number; top: number } } = {},
    ): Promise<MadeMedia> {
      const id = await upload(new File([await png()], `${name}.png`))
      const key = await create(SYSTEM_MEDIA_TYPE_KEYS.Image, name, parent, [
        {
          alias: 'umbracoFile',
          culture: null,
          segment: null,
          value: { src: '', temporaryFileId: id, crops: [], focalPoint: extra.focalPoint ?? null },
        },
        ...(extra.alt === undefined
          ? []
          : [{ alias: 'altText', culture: null, segment: null, value: extra.alt }]),
      ])
      return { key, src: await srcOf(key) }
    },
    async file(name: string, parent: string | null = null): Promise<MadeMedia> {
      const id = await upload(new File(['%PDF-1.7'], `${name}.pdf`))
      const key = await create(SYSTEM_MEDIA_TYPE_KEYS.File, name, parent, [
        { alias: 'umbracoFile', culture: null, segment: null, value: { temporaryFileId: id } },
      ])
      return { key, src: await srcOf(key) }
    },
    group: async (name: string) =>
      (await h.post(`${V1}/member-group`, { name })).headers.get(
        'umb-generated-resource',
      ) as string,
    /** A published article using `media` in its picker, a link and an image in its text. */
    async article(name: string, media: MadeMedia): Promise<string> {
      const db = h.server.db
      const typeKey = (await new ContentTypeRepository(db).byAlias('article'))?.key as string
      const componentKey = (await new ComponentRepository(db).byAlias('article'))?.key as string
      const udi = `umb://media/${media.key.replaceAll('-', '')}`
      const values = {
        hero: [
          {
            key: crypto.randomUUID(),
            mediaKey: media.key,
            mediaTypeAlias: 'Image',
            crops: [],
            focalPoint: null,
          },
        ],
        links: [{ type: 'media', unique: media.key, name: 'Download', url: media.src }],
        body: {
          markup: `<p><img src="${media.src}" alt="pictured" data-udi="${udi}" /></p>`,
          blocks: null,
        },
      }
      const response = await h.post(`${V1}/document`, {
        documentType: { id: typeKey },
        template: { id: componentKey },
        parent: null,
        values: Object.entries(values).map(([alias, value]) => ({
          alias,
          culture: null,
          segment: null,
          value,
        })),
        variants: [{ culture: null, segment: null, name }],
      })
      if (response.status !== 201)
        throw new Error(`create ${name}: ${response.status} ${await response.text()}`)
      const key = response.headers.get('umb-generated-resource') as string
      await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
      return key
    },
  }
}

/** The addresses a rendered article shows its picked image, its link and its text's image at. */
export function articleAddresses(html: string) {
  const plain = (value: string | undefined) => value?.replaceAll('&amp;', '&')
  return {
    hero: plain(/class="hero" src="([^"]+)"/.exec(html)?.[1]),
    link: plain(/class="link" href="([^"]+)"/.exec(html)?.[1]),
    text: plain(/<img src="([^"]+)" alt="pictured"/.exec(html)?.[1]),
  }
}
