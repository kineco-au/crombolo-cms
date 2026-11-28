import type { PublishedContent } from '@crombolo/crombolo'

/** The heading and introduction most pages open with, as wide as the page below it. */
export function PageHeader({ model, narrow }: { model: PublishedContent; narrow?: boolean }) {
  return (
    <header class={`${narrow ? 'text-column' : 'page-column'} pt-12 pb-8`}>
      <h1 class="heading-display">{model.text('title') || model.name}</h1>
      {model.hasValue('intro') ? <p class="lede">{model.text('intro')}</p> : null}
    </header>
  )
}
