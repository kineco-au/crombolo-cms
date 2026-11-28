import type { PublishedContent } from '@crombolo/crombolo'
import { h1, lead, narrow as narrowWrap, wrap } from './styles.ts'

/** The heading and introduction most pages open with, as wide as the page below it. */
export function PageHeader({ model, narrow }: { model: PublishedContent; narrow?: boolean }) {
  return (
    <header class={`${narrow ? narrowWrap : wrap} pt-12 pb-8`}>
      <h1 class={h1}>{model.text('title') || model.name}</h1>
      {model.hasValue('intro') ? <p class={lead}>{model.text('intro')}</p> : null}
    </header>
  )
}
