import type { PageProps, PublishedContent } from '@crombolo/crombolo'

type Props = Pick<PageProps, 'model' | 'nav' | 'dictionary'>

/** The pages of the guide this one is in, the first of them first; none where it is in no guide. */
export function stepsOf({ model, nav }: Pick<Props, 'model' | 'nav'>): PublishedContent[] {
  const parent = nav.parent(model)
  const first = model.value('steps') ? model : parent?.value('steps') ? parent : undefined
  return first ? [first, ...nav.children(first)] : []
}

/** The guide's pages, with this one marked. */
export function StepMenu({ model, nav, dictionary }: Props) {
  return (
    <nav aria-label={dictionary('steps.label')}>
      <ol class="border-l border-line lg:sticky lg:top-6">
        {stepsOf({ model, nav }).map((step) => (
          <li>
            <a
              class="-ml-px block border-l-3 border-transparent px-4 py-1.5 text-ink no-underline hover:text-terracotta aria-[current=page]:border-terracotta aria-[current=page]:font-semibold aria-[current=page]:text-terracotta"
              href={step.url}
              aria-current={step.key === model.key ? 'page' : undefined}
            >
              {step.name}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Buttons to the pages before and after this one in its guide. */
export function StepLinks({ model, nav, dictionary }: Props) {
  const steps = stepsOf({ model, nav })
  const at = steps.findIndex((step) => step.key === model.key)
  if (at < 0) return null
  const previous = steps[at - 1]
  const next = steps[at + 1]
  return (
    <div class="mt-12 flex flex-wrap justify-between gap-4">
      {previous ? (
        <a class="btn-quiet" rel="prev" href={previous.url}>
          <small class="block text-xs opacity-80">{dictionary('steps.previous')}</small>
          {previous.name}
        </a>
      ) : null}
      {next ? (
        <a class={`btn-primary ms-auto text-right`} rel="next" href={next.url}>
          <small class="block text-xs opacity-80">{dictionary('steps.next')}</small>
          {next.name}
        </a>
      ) : null}
    </div>
  )
}
