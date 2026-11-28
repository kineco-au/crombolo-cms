'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export interface Bottling {
  id: string
  title: string
  href: string
  kind: string
  productType: string
  abv: string
  age: string
  batch: string
  summary: string
  bottle?: { src: string; width: number; height: number; alt: string }
  notes: Array<{ aspect: string; note: string }>
}

/** How many sit side by side. */
export const MOST = 4

const ASPECT_ORDER = ['Nose', 'Palate', 'Finish']

interface Row {
  label: string
  value: (bottling: Bottling) => string
}

const FACTS: Row[] = [
  { label: 'Kind', value: (b) => b.kind },
  { label: 'Product type', value: (b) => b.productType },
  { label: 'ABV', value: (b) => b.abv },
  { label: 'Age', value: (b) => (b.age ? `${b.age} years` : '') },
  { label: 'Batch', value: (b) => b.batch },
  { label: 'Summary', value: (b) => b.summary },
]

/** The tasting rows: every aspect any bottling has, nose then palate then finish. */
function aspectRows(bottlings: readonly Bottling[]): Row[] {
  const aspects = [...new Set(bottlings.flatMap((b) => b.notes.map((n) => n.aspect)))].sort(
    (a, b) => (ASPECT_ORDER.indexOf(a) + 1 || 99) - (ASPECT_ORDER.indexOf(b) + 1 || 99),
  )
  return aspects.map((aspect) => ({
    label: aspect,
    value: (b) => b.notes.find((n) => n.aspect === aspect)?.note ?? '',
  }))
}

/** A cell of the side-by-side table. */
const cell = 'border-b border-ink/10 p-3 text-left align-top'

/** Whether the chosen bottlings differ on a row: what is worth reading across. */
const differs = (row: Row, chosen: readonly Bottling[]) =>
  chosen.length > 1 && new Set(chosen.map(row.value)).size > 1

/** The kinds, in the order the range first lists them: the category headers. */
const categoriesOf = (bottlings: readonly Bottling[]) => [
  ...new Set(bottlings.map((b) => b.kind || 'Other')),
]

/**
 * The bottlings side by side, chosen in the browser (story 208). The choice is
 * kept in the address as `?compare=a,b`, so a link reopens it and Back steps
 * through each change.
 */
export function Compare({ bottlings }: { bottlings: Bottling[] }) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const ids = useId()
  const categories = useMemo(() => categoriesOf(bottlings), [bottlings])
  const [category, setCategory] = useState(categories[0] ?? '')

  const byId = useMemo(() => new Map(bottlings.map((b) => [b.id, b])), [bottlings])
  const inAddress = params.get('compare') ?? ''
  const fromAddress = (value: string) =>
    value
      .split(',')
      .filter((id) => byId.has(id))
      .slice(0, MOST)
  // Held here as well as in the address, so a second click before the address
  // updates builds on the first; Back and a shared link set it from the address.
  const [chosenIds, setChosenIds] = useState(() => fromAddress(inAddress))
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the address, not the lookup.
  useEffect(() => setChosenIds(fromAddress(inAddress)), [inAddress])
  const chosen = chosenIds.map((id) => byId.get(id) as Bottling)
  const rows = [...FACTS, ...aspectRows(chosen)]
  const listed = bottlings.filter((b) => (b.kind || 'Other') === category)

  const choose = (next: string[]) => {
    setChosenIds(next)
    const query = new URLSearchParams(params.toString())
    if (next.length > 0) query.set('compare', next.join(','))
    else query.delete('compare')
    const search = query.toString()
    router.push(search ? `${path}?${search}` : path, { scroll: false })
  }
  const toggle = (id: string) =>
    choose(chosenIds.includes(id) ? chosenIds.filter((c) => c !== id) : [...chosenIds, id])

  return (
    <div className="page-column grid gap-10 pt-6 pb-16">
      <section aria-labelledby={`${ids}-pick`}>
        <h2 id={`${ids}-pick`} className="sr-only">
          Choose up to {MOST}
        </h2>
        <Categories
          id={ids}
          categories={categories}
          counts={categories.map((c) => bottlings.filter((b) => (b.kind || 'Other') === c).length)}
          current={category}
          onChoose={setCategory}
        />
        <Carousel
          key={category}
          id={`${ids}-panel`}
          label={category}
          bottlings={listed}
          chosen={chosenIds}
          onToggle={toggle}
        />
        <p className="mt-4 text-center" role="status">
          {chosen.length === 0 ? 'Nothing chosen yet.' : `${chosen.length} of ${MOST} chosen.`}{' '}
          {chosen.length > 0 ? (
            <button
              type="button"
              className="cursor-pointer text-sm underline underline-offset-2 hover:text-brass-deep"
              onClick={() => choose([])}
            >
              Clear
            </button>
          ) : null}
        </p>
      </section>

      {chosen.length > 0 ? (
        <section aria-labelledby={`${ids}-table`}>
          <h2 id={`${ids}-table`} className="sr-only">
            Side by side
          </h2>
          {chosen.length > 1 ? (
            <p className="mb-4 flex items-center gap-2 text-sm text-muted">
              <span className="inline-block size-4 bg-sand" /> Rows where they differ are marked.
            </p>
          ) : null}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr>
                  <td className={`${cell} w-36`} />
                  {chosen.map((b) => (
                    <th key={b.id} scope="col" className={cell}>
                      {b.bottle ? (
                        <Image
                          src={b.bottle.src}
                          alt={b.bottle.alt}
                          width={b.bottle.width || 760}
                          height={b.bottle.height || 1140}
                          sizes="12rem"
                          className="mb-3 aspect-[2/3] w-full max-w-32 object-cover"
                        />
                      ) : null}
                      <Link
                        className="heading-display text-xl hover:text-brass-deep motion-safe:transition-colors"
                        href={b.href}
                      >
                        {b.title}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className={differs(row, chosen) ? 'bg-sand' : undefined}>
                    <th scope="row" className={`${cell} font-medium`}>
                      {row.label}
                    </th>
                    {chosen.map((b) => (
                      <td key={b.id} className={cell}>
                        {row.value(b) || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  {chosen.map((b) => (
                    <td key={b.id} className="p-3">
                      <button
                        type="button"
                        className="cursor-pointer text-sm underline underline-offset-2 hover:text-brass-deep"
                        onClick={() => toggle(b.id)}
                        aria-label={`Remove ${b.title}`}
                      >
                        Remove
                      </button>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <ul className="grid gap-6 md:hidden">
            {chosen.map((b) => (
              <li key={b.id} className="border border-line bg-card p-5">
                <h3 className="heading-display text-2xl">
                  <Link href={b.href}>{b.title}</Link>
                </h3>
                <dl className="mt-3 text-sm">
                  {rows.map((row) => (
                    <div
                      key={row.label}
                      className={`grid grid-cols-[7rem_1fr] gap-2 p-1.5 ${differs(row, chosen) ? 'bg-sand' : ''}`}
                    >
                      <dt className="font-medium">{row.label}</dt>
                      <dd>{row.value(b) || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className="mt-4 cursor-pointer text-sm underline underline-offset-2 hover:text-brass-deep"
                  onClick={() => toggle(b.id)}
                >
                  Remove {b.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/** The round buttons either side of the carousel, gone on a phone, where a thumb scrolls it. */
const nudge =
  'hidden size-10 cursor-pointer rounded-full border border-line bg-foam text-2xl leading-none text-ink disabled:cursor-default disabled:opacity-30 sm:block motion-safe:transition-opacity'

/**
 * The category headers: tabs, with an underline that slides to the one chosen.
 * Arrow keys move between them, as a tab list's do.
 */
function Categories(props: {
  id: string
  categories: string[]
  counts: number[]
  current: string
  onChoose(category: string): void
}) {
  const list = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState({ left: 0, width: 0 })
  // Measured after layout, so the underline sits under the tab as drawn, and
  // again whenever another tab is chosen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chosen tab moves the underline.
  useLayoutEffect(() => {
    const measure = () => {
      const tab = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (tab) setBar({ left: tab.offsetLeft, width: tab.offsetWidth })
    }
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [props.current])
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next =
      props.categories[(index + step + props.categories.length) % props.categories.length]
    if (next === undefined) return
    props.onChoose(next)
    list.current?.querySelector<HTMLElement>(`[data-category="${CSS.escape(next)}"]`)?.focus()
  }
  return (
    <div
      className="relative mb-6 flex justify-center-safe gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]"
      role="tablist"
      aria-label="Kind"
      ref={list}
    >
      {props.categories.map((category, index) => {
        const on = category === props.current
        return (
          <button
            key={category}
            type="button"
            role="tab"
            id={`${props.id}-tab-${index}`}
            aria-selected={on}
            aria-controls={`${props.id}-panel`}
            tabIndex={on ? 0 : -1}
            data-category={category}
            className="group flex-none cursor-pointer px-4 py-3 tracking-wide text-muted hover:text-ink aria-selected:text-ink motion-safe:transition-colors"
            onClick={() => props.onChoose(category)}
            onKeyDown={(event) => move(event, index)}
          >
            {category}{' '}
            <span className="ml-1.5 inline-block min-w-[1.4em] rounded-full bg-muted px-1.5 text-center text-xs leading-relaxed text-foam group-aria-selected:bg-brass-deep motion-safe:transition-colors">
              {props.counts[index]}
            </span>
          </button>
        )
      })}
      <span
        className="absolute -bottom-px left-0 h-[3px] bg-brass transition-[transform,width] duration-400 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none"
        aria-hidden="true"
        style={{ transform: `translateX(${bar.left}px)`, width: `${bar.width}px` }}
      />
    </div>
  )
}

/**
 * One category's bottlings in a horizontal scroll that snaps card by card, with
 * buttons that glide a page at a time. Remounted per category, so the cards
 * come in afresh. Clicking a card adds it to the comparison, or takes it out.
 */
function Carousel(props: {
  id: string
  label: string
  bottlings: Bottling[]
  chosen: string[]
  onToggle(id: string): void
}) {
  const track = useRef<HTMLUListElement>(null)
  const [ends, setEnds] = useState({ start: true, end: true })
  const update = () => {
    const el = track.current
    if (!el) return
    setEnds({
      start: el.scrollLeft <= 1,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    })
  }
  useLayoutEffect(update, [])
  const page = (direction: 1 | -1) => {
    const el = track.current
    if (!el) return
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: smooth ? 'smooth' : 'auto' })
  }
  return (
    <div
      className="relative grid items-center gap-2 sm:grid-cols-[auto_1fr_auto]"
      role="tabpanel"
      id={props.id}
      aria-label={props.label}
    >
      <button
        type="button"
        className={nudge}
        aria-label="Earlier bottlings"
        disabled={ends.start}
        onClick={() => page(-1)}
      >
        ‹
      </button>
      <ul
        className="grid auto-cols-[minmax(12rem,15rem)] grid-flow-col justify-center-safe gap-4 overflow-x-auto overscroll-x-contain scroll-px-1 px-1 pt-1 pb-4 snap-x snap-mandatory"
        ref={track}
        onScroll={update}
      >
        {props.bottlings.map((b, index) => {
          const on = props.chosen.includes(b.id)
          const full = !on && props.chosen.length >= MOST
          return (
            <li
              key={b.id}
              className="snap-start motion-safe:animate-slide-in"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <button
                type="button"
                className="group grid size-full cursor-pointer justify-items-center gap-1.5 rounded border border-line bg-card px-3 pt-4 pb-5 text-center hover:enabled:-translate-y-1 hover:enabled:shadow-[0_12px_24px_-16px_rgb(26_22_18/0.45)] disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-brass-deep aria-pressed:ring-2 aria-pressed:ring-brass aria-pressed:ring-inset motion-safe:transition motion-safe:duration-250"
                aria-pressed={on}
                disabled={full}
                title={full ? `Up to ${MOST} at once: remove one first` : undefined}
                onClick={() => props.onToggle(b.id)}
              >
                {b.bottle ? (
                  <Image
                    className="aspect-[2/3] w-full max-w-36 object-cover group-hover:group-enabled:scale-[1.04] motion-safe:transition-transform motion-safe:duration-400"
                    src={b.bottle.src}
                    alt=""
                    width={b.bottle.width || 760}
                    height={b.bottle.height || 1140}
                    sizes="9rem"
                  />
                ) : null}
                <span className="mt-1 font-medium">{b.title}</span>
                <span className="caps text-brass-deep">
                  {[b.abv, b.age ? `${b.age} years` : b.batch ? `Batch ${b.batch}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span
                  className="mt-1 text-sm text-brass-deep group-aria-pressed:font-medium"
                  aria-hidden="true"
                >
                  {on ? '✓ Comparing' : '+ Compare'}
                </span>
              </button>
            </li>
          )
        })}
        {props.bottlings.length === 0 ? (
          <li className="text-muted">Nothing of this kind yet.</li>
        ) : null}
      </ul>
      <button
        type="button"
        className={nudge}
        aria-label="Later bottlings"
        disabled={ends.end}
        onClick={() => page(1)}
      >
        ›
      </button>
    </div>
  )
}
