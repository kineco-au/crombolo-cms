import type { PageProps, PublishedContent } from '@crombolo/crombolo'
import { formatDate } from '../shared/dates.ts'
import { Layout } from '../shared/layout.tsx'
import { PageHeader } from '../shared/page-header.tsx'
import { Pager } from '../shared/pager.tsx'

const tagsOf = (post: PublishedContent) => (post.value('tags') ?? []) as string[]

const newestFirst = (a: PublishedContent, b: PublishedContent) =>
  String(b.value('publishDate')).localeCompare(String(a.value('publishDate')))

/** The posts below this page, newest first, narrowed by `?tag=` and paged by `?page=`. */
export default async function BlogList(props: PageProps) {
  const { model, nav, searchParams, dictionary, culture } = props
  const query = await searchParams
  const tag = typeof query.tag === 'string' ? query.tag : undefined
  const perPage = Number(model.value('postsPerPage')) || 5
  const posts = nav
    .children(model)
    .filter((post) => !tag || tagsOf(post).includes(tag))
    .sort(newestFirst)
  const pages = Math.max(1, Math.ceil(posts.length / perPage))
  const page = Math.min(pages, Math.max(1, Number.parseInt(String(query.page), 10) || 1))
  const shown = posts.slice((page - 1) * perPage, page * perPage)
  const tagged = (name: string) => `${model.url}?tag=${encodeURIComponent(name)}`
  const href = (n: number) => `${tag ? `${tagged(tag)}&` : `${model.url}?`}page=${n}`
  const allTags = [...new Set(nav.children(model).flatMap(tagsOf))].sort()

  return (
    <Layout {...props}>
      <PageHeader model={model} />
      <div class="wrap">
        <nav class="filters" aria-label={dictionary('blog.tags')}>
          <a href={model.url} aria-current={tag ? undefined : 'true'}>
            {dictionary('blog.all')}
          </a>
          {allTags.map((name) => (
            <a href={tagged(name)} aria-current={name === tag ? 'true' : undefined}>
              {name}
            </a>
          ))}
        </nav>
        <ol class="posts">
          {shown.map(async (post) => {
            const image = (await post.media('image'))[0]
            return (
              <li class="post-row">
                {image ? <img src={image.cropUrl({ width: 480, height: 320 })} alt="" /> : null}
                <div>
                  <p class="eyebrow">{formatDate(post.value('publishDate'), culture)}</p>
                  <h2>
                    <a href={post.url}>{post.text('title')}</a>
                  </h2>
                  <p>{post.text('excerpt')}</p>
                </div>
              </li>
            )
          })}
        </ol>
        <Pager
          page={page}
          pages={pages}
          href={href}
          labels={{
            newer: dictionary('blog.newer'),
            older: dictionary('blog.older'),
            position: `${dictionary('blog.page')} ${page} / ${pages}`,
          }}
        />
      </div>
    </Layout>
  )
}
