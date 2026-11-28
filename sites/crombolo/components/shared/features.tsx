import type { PublishedElement } from '@crombolo/crombolo'

/** Features as cards: a heading, and the sentence that earns it. */
export function FeatureCards({ items }: { items: PublishedElement[] }) {
  if (items.length === 0) return null
  // Four fill a row of four; anything else rows of three.
  const columns = items.length % 4 === 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
  return (
    <div class={`grid gap-6 sm:grid-cols-2 ${columns}`}>
      {items.map((item) => (
        <article class="card">
          <h3 class="card-heading">{item.text('heading')}</h3>
          {item.text('detail') ? <p class="text-muted">{item.text('detail')}</p> : null}
        </article>
      ))}
    </div>
  )
}

/** The same elements as a ticked list. */
export function FeatureChecklist({ items }: { items: PublishedElement[] }) {
  if (items.length === 0) return null
  return (
    <ul>
      {items.map((item) => (
        <li class="relative border-b border-line py-3 pl-9 before:absolute before:left-1 before:font-bold before:text-terracotta before:content-['✓']">
          <strong class="block font-semibold">{item.text('heading')}</strong>
          {item.text('detail') ? <span class="text-muted">{item.text('detail')}</span> : null}
        </li>
      ))}
    </ul>
  )
}
