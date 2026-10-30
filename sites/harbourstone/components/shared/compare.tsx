/** @jsxImportSource react */
'use client'
import {
  type KeyboardEvent,
  type ReactNode,
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

/** Whether the chosen bottlings differ on a row: what is worth reading across. */
const differs = (row: Row, chosen: readonly Bottling[]) =>
  chosen.length > 1 && new Set(chosen.map(row.value)).size > 1

/** The kinds, in the order the range first lists them: the category headers. */
const categoriesOf = (bottlings: readonly Bottling[]) => [
  ...new Set(bottlings.map((b) => b.kind || 'Other')),
]

/** The address's `?compare=`, as the browser has it now. */
const inAddressNow = () =>
  typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('compare') ?? '')

/**
 * The bottlings side by side, chosen in the browser: an island (story 209), the
 * same comparison harbourstone-next draws with Next.js. The choice is kept in
 * the address as `?compare=a,b`, so a link reopens it and Back steps through
 * each change. Until it mounts, its `children` are the server's list of the
 * range, which it takes over.
 */
export default function Compare({ bottlings }: { bottlings: Bottling[]; children?: ReactNode }) {
  const ids = useId()
  const [inAddress, setInAddress] = useState(inAddressNow)
  useEffect(() => {
    const follow = () => setInAddress(inAddressNow())
    addEventListener('popstate', follow)
    return () => removeEventListener('popstate', follow)
  }, [])
  const categories = useMemo(() => categoriesOf(bottlings), [bottlings])
  const [category, setCategory] = useState(categories[0] ?? '')

  const byId = useMemo(() => new Map(bottlings.map((b) => [b.id, b])), [bottlings])
  const fromAddress = (value: string) =>
    value
      .split(',')
      .filter((id) => byId.has(id))
      .slice(0, MOST)
  // Held here as well as in the address, so a second click before the address
  // updates builds on the first; Back and a shared link set it from the address.
  const [chosenIds, setChosenIds] = useState(() => fromAddress(inAddress))
  useEffect(() => setChosenIds(fromAddress(inAddress)), [inAddress])
  const chosen = chosenIds.map((id) => byId.get(id) as Bottling)
  const rows = [...FACTS, ...aspectRows(chosen)]
  const listed = bottlings.filter((b) => (b.kind || 'Other') === category)

  const choose = (next: string[]) => {
    setChosenIds(next)
    const query = new URLSearchParams(location.search)
    if (next.length > 0) query.set('compare', next.join(','))
    else query.delete('compare')
    const search = query.toString()
    history.pushState(null, '', search ? `${location.pathname}?${search}` : location.pathname)
    setInAddress(next.join(','))
  }
  const toggle = (id: string) =>
    choose(chosenIds.includes(id) ? chosenIds.filter((c) => c !== id) : [...chosenIds, id])

  return (
    <div className="compare">
      <section className="compare__picker" aria-labelledby={`${ids}-pick`}>
        <h2 id={`${ids}-pick`}>Choose up to {MOST}</h2>
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
        <p className="compare__status" role="status">
          {chosen.length === 0 ? 'Nothing chosen yet.' : `${chosen.length} of ${MOST} chosen.`}{' '}
          {chosen.length > 0 ? (
            <button type="button" className="compare__clear" onClick={() => choose([])}>
              Clear
            </button>
          ) : null}
        </p>
      </section>

      {chosen.length > 0 ? (
        <section aria-labelledby={`${ids}-table`}>
          <h2 id={`${ids}-table`} className="visually-hidden">
            Side by side
          </h2>
          {chosen.length > 1 ? (
            <p className="compare__legend">
              <span className="compare__differs-key" /> Rows where they differ are marked.
            </p>
          ) : null}
          <div className="compare__table-wrap">
            <table className="compare__table">
              <thead>
                <tr>
                  <td />
                  {chosen.map((b) => (
                    <th key={b.id} scope="col">
                      {b.bottle ? (
                        <img
                          src={b.bottle.src}
                          alt={b.bottle.alt}
                          width={b.bottle.width || 380}
                          height={b.bottle.height || 570}
                          loading="lazy"
                        />
                      ) : null}
                      <a href={b.href}>{b.title}</a>
                      <button
                        type="button"
                        className="compare__remove"
                        onClick={() => toggle(b.id)}
                        aria-label={`Remove ${b.title}`}
                      >
                        Remove
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className={differs(row, chosen) ? 'compare__differs' : undefined}
                  >
                    <th scope="row">{row.label}</th>
                    {chosen.map((b) => (
                      <td key={b.id}>{row.value(b) || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="compare__cards">
            {chosen.map((b) => (
              <li key={b.id} className="compare__card">
                <h3>
                  <a href={b.href}>{b.title}</a>
                </h3>
                <dl>
                  {rows.map((row) => (
                    <div
                      key={row.label}
                      className={differs(row, chosen) ? 'compare__differs' : undefined}
                    >
                      <dt>{row.label}</dt>
                      <dd>{row.value(b) || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" className="compare__remove" onClick={() => toggle(b.id)}>
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
    <div className="compare__tabs" role="tablist" aria-label="Kind" ref={list}>
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
            className={on ? 'compare__tab compare__tab--on' : 'compare__tab'}
            onClick={() => props.onChoose(category)}
            onKeyDown={(event) => move(event, index)}
          >
            {category} <span className="compare__tab-count">{props.counts[index]}</span>
          </button>
        )
      })}
      <span
        className="compare__tab-bar"
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
    <div className="compare__carousel" role="tabpanel" id={props.id} aria-label={props.label}>
      <button
        type="button"
        className="compare__nudge compare__nudge--back"
        aria-label="Earlier bottlings"
        disabled={ends.start}
        onClick={() => page(-1)}
      >
        ‹
      </button>
      <ul className="compare__track" ref={track} onScroll={update}>
        {props.bottlings.map((b, index) => {
          const on = props.chosen.includes(b.id)
          const full = !on && props.chosen.length >= MOST
          return (
            <li key={b.id} className="compare__slide" style={{ animationDelay: `${index * 60}ms` }}>
              <button
                type="button"
                className={
                  on ? 'compare__card-choice compare__card-choice--on' : 'compare__card-choice'
                }
                aria-pressed={on}
                disabled={full}
                title={full ? `Up to ${MOST} at once: remove one first` : undefined}
                onClick={() => props.onToggle(b.id)}
              >
                {b.bottle ? (
                  <img
                    className="compare__card-image"
                    src={b.bottle.src}
                    alt=""
                    width={b.bottle.width || 380}
                    height={b.bottle.height || 570}
                    loading="lazy"
                  />
                ) : null}
                <span className="compare__choice-name">{b.title}</span>
                <span className="eyebrow">
                  {[b.abv, b.age ? `${b.age} years` : b.batch ? `Batch ${b.batch}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="compare__card-mark" aria-hidden="true">
                  {on ? '✓ Comparing' : '+ Compare'}
                </span>
              </button>
            </li>
          )
        })}
        {props.bottlings.length === 0 ? <li>Nothing of this kind yet.</li> : null}
      </ul>
      <button
        type="button"
        className="compare__nudge compare__nudge--on"
        aria-label="Later bottlings"
        disabled={ends.end}
        onClick={() => page(1)}
      >
        ›
      </button>
    </div>
  )
}
