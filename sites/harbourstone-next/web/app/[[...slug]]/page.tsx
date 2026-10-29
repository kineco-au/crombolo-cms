import type { Metadata } from 'next'
import { CmsPage } from '@/components/page'
import { crombolo } from '@/lib/crombolo'

interface Props {
  params: Promise<{ slug?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const pathOf = async (params: Props['params']) => `/${((await params).slug ?? []).join('/')}`

/** Every page the site's sitemap lists is built ahead; any other address renders when asked for. */
export async function generateStaticParams() {
  const sitemap = await crombolo.sitemap(crombolo.options.host).catch(() => undefined)
  const paths = (sitemap?.items ?? []).map((item) => new URL(item.url).pathname)
  return [
    { slug: [] },
    ...paths
      .filter((path) => path !== '/')
      .map((path) => ({ slug: path.split('/').filter(Boolean) })),
  ]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await crombolo.page(await pathOf(params))
  return crombolo.metadata(page.ok ? page.value : undefined)
}

/** Every address the CMS answers: its page, its redirect, or not found. */
export default async function Page({ params, searchParams }: Props) {
  const page = await crombolo.resolvePage(await pathOf(params))
  return <CmsPage page={page} searchParams={searchParams} />
}
