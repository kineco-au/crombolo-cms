/**
 * The components the backoffice offers to start from — Umbraco's snippets, with
 * its ids, written as TSX. One is rendered the way any component is:
 * `<Breadcrumb model={model} nav={nav} />`. `Empty` is also the skeleton a new
 * component starts with.
 */
import type { Snippet } from '@crombolo/api-management/domain'

const IMPORTS = "import type { PageProps } from '@crombolo/crombolo'\n\n"

export const COMPONENT_SNIPPETS: readonly Snippet[] = [
  {
    id: 'Empty',
    name: 'Empty',
    content: `${IMPORTS}export default function Partial({ model }: Pick<PageProps, 'model'>) {
  return <div>{model.name}</div>
}
`,
  },
  {
    id: 'Breadcrumb',
    name: 'Breadcrumb',
    content: `${IMPORTS}export default function Breadcrumb({ model, nav }: Pick<PageProps, 'model' | 'nav'>) {
  const trail = [...nav.ancestors(model)].reverse()
  return (
    <ul class="breadcrumb">
      {trail.map((page) => (
        <li>
          <a href={page.url}>{page.name}</a>
        </li>
      ))}
      <li class="active">{model.name}</li>
    </ul>
  )
}
`,
  },
  {
    id: 'ListAncestorsFromCurrentPage',
    name: 'List Ancestors From Current Page',
    content: `${IMPORTS}export default function Ancestors({ model, nav }: Pick<PageProps, 'model' | 'nav'>) {
  return (
    <ul>
      {nav.ancestors(model).map((page) => (
        <li>
          <a href={page.url}>{page.name}</a>
        </li>
      ))}
    </ul>
  )
}
`,
  },
  {
    id: 'ListChildPagesFromCurrentPage',
    name: 'List Child Pages From Current Page',
    content: `${IMPORTS}export default function ChildPages({ model, nav }: Pick<PageProps, 'model' | 'nav'>) {
  return (
    <ul>
      {nav.children(model).map((page) => (
        <li>
          <a href={page.url}>{page.name}</a>
        </li>
      ))}
    </ul>
  )
}
`,
  },
  {
    id: 'ListChildPagesOrderedByDate',
    name: 'List Child Pages Ordered By Date',
    content: `${IMPORTS}export default function ChildPagesByDate({ model, nav }: Pick<PageProps, 'model' | 'nav'>) {
  const pages = [...nav.children(model)].sort(
    (a, b) => b.createDate.getTime() - a.createDate.getTime(),
  )
  return (
    <ul>
      {pages.map((page) => (
        <li>
          <a href={page.url}>{page.name}</a>
        </li>
      ))}
    </ul>
  )
}
`,
  },
  {
    id: 'ListChildPagesOrderedByName',
    name: 'List Child Pages Ordered By Name',
    content: `${IMPORTS}export default function ChildPagesByName({ model, nav }: Pick<PageProps, 'model' | 'nav'>) {
  const pages = [...nav.children(model)].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <ul>
      {pages.map((page) => (
        <li>
          <a href={page.url}>{page.name}</a>
        </li>
      ))}
    </ul>
  )
}
`,
  },
  {
    id: 'ListDescendantsFromCurrentPage',
    name: 'List Descendants From Current Page',
    content: `import type { PageProps, PublishedContent } from '@crombolo/crombolo'

export default function Descendants({ model, nav }: Pick<PageProps, 'model' | 'nav'>) {
  const branch = (page: PublishedContent) => (
    <ul>
      {nav.children(page).map((child) => (
        <li>
          <a href={child.url}>{child.name}</a>
          {nav.children(child).length > 0 ? branch(child) : null}
        </li>
      ))}
    </ul>
  )
  return branch(model)
}
`,
  },
  {
    id: 'Navigation',
    name: 'Navigation',
    content: `${IMPORTS}export default function Navigation({ model, nav }: Pick<PageProps, 'model' | 'nav'>) {
  const site = nav.ancestors(model).at(-1) ?? model
  return (
    <ul class="nav">
      {nav.children(site).map((page) => (
        <li class={page.id === model.id ? 'current' : undefined}>
          <a href={page.url}>{page.name}</a>
        </li>
      ))}
    </ul>
  )
}
`,
  },
  {
    id: 'SiteMap',
    name: 'Site Map',
    content: `import type { PageProps, PublishedContent } from '@crombolo/crombolo'

export default function SiteMap({ nav }: Pick<PageProps, 'nav'>) {
  const branch = (pages: PublishedContent[]) => (
    <ul>
      {pages.map((page) => (
        <li>
          <a href={page.url}>{page.name}</a>
          {nav.children(page).length > 0 ? branch(nav.children(page)) : null}
        </li>
      ))}
    </ul>
  )
  return <div class="sitemap">{branch(nav.root())}</div>
}
`,
  },
  {
    id: 'PersonalisedPart',
    name: 'Personalised part',
    // Story 264: a part fetched for each visitor, so the page around it is shared.
    content: `'use deferred'
// A personalised part: it shows the signed-in visitor, and is fetched for each
// visitor after the page loads, so the rest of the page can be the same for
// everyone and kept by a CDN. Use one for a greeting, a basket or an account
// link. For something that runs in the browser, such as a counter or a map,
// start from "Interactive part" instead.
//
// Use it with what to show until it arrives, which is what is shared:
//   <Greeting fallback={<a href="/sign-in">Sign in</a>} />
// Its props travel in its address, so pass data only: text, numbers, lists.
import { usePage } from '@crombolo/crombolo'

export default function Greeting() {
  const { member } = usePage()
  if (!member) return <a href="/sign-in">Sign in</a>
  return <a href="/account">Hi {member.name}</a>
}
`,
  },
  {
    id: 'InteractivePart',
    name: 'Interactive part',
    // Story 264: an island, which React runs in the browser.
    content: `/** @jsxImportSource react */
'use client'
// An interactive part: React runs it in the browser, so it can respond to
// clicks and typing. The site needs react and react-dom installed. For
// something that shows the signed-in visitor, start from "Personalised part"
// instead: an interactive part sees only the props it is given.
//
// Use it with what to show until it runs:
//   <Counter start={0} fallback={<p>0</p>} />
import { useState } from 'react'

export default function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start)
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {count}
    </button>
  )
}
`,
  },
]
