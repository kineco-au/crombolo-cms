import type { PublishedContent } from '@crombolo/crombolo'

/** The heading and introduction most pages open with. */
export function PageHeader({ model }: { model: PublishedContent }) {
  return (
    <header class="page-header wrap">
      <h1>{model.text('title') || model.name}</h1>
      {model.hasValue('intro') ? <p class="lead">{model.text('intro')}</p> : null}
    </header>
  )
}
