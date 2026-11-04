/** @jsxImportSource react */
'use client'
import { type ReactNode, useEffect, useRef, useState } from 'react'

export interface WalkthroughCode {
  lang: string
  /** The file the code goes in, when it is a file's whole text. */
  file?: string
  text: string
}

export interface WalkthroughStep {
  id: string
  title: string
  text: string
  code: WalkthroughCode[]
  /** What the reader should see once the step is done. */
  see?: string
  /** Something to act on before moving on. */
  note?: string
  /** The one option of the walkthrough's choice this step is for; every option when absent. */
  only?: string
}

export interface WalkthroughStage {
  id: string
  title: string
  steps: WalkthroughStep[]
}

export interface Walkthrough {
  intro: string
  /** One choice the reader makes, such as the database, which some steps depend on. */
  choice?: { name: string; options: string[] }
  stages: WalkthroughStage[]
}

export interface Placed {
  stage: number
  /** Its place within the stage, from 0, among the steps shown. */
  index: number
  /** How many steps the stage shows. */
  of: number
  /** Its place among every step, whatever the choice. */
  order: number
  step: WalkthroughStep
}

/** The steps shown for an option, in reading order, with where each sits. */
export function placed(walk: Walkthrough, option?: string): Placed[] {
  let order = 0
  return walk.stages.flatMap((stage, s) => {
    const shown = stage.steps
      .map((step) => ({ step, order: order++ }))
      .filter(({ step }) => !step.only || step.only === option)
    return shown.map(({ step, order }, index) => ({
      stage: s,
      index,
      of: shown.length,
      order,
      step,
    }))
  })
}

/** The option first shown: the first, unless the reader picked another. */
export function firstOption(walk: Walkthrough, picked?: string | null): string | undefined {
  const options = walk.choice?.options ?? []
  return picked && options.includes(picked) ? picked : options[0]
}

/**
 * Where an address's fragment points: a step, a stage's first step, or the
 * first of all. A step for another option picks that option.
 */
export function stepFor(
  walk: Walkthrough,
  hash: string,
  option?: string,
): { option?: string; at: number } {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  const named = walk.stages.flatMap((s) => s.steps).find((step) => step.id === id)
  const chosen = named?.only ?? option
  const steps = placed(walk, chosen)
  const step = steps.findIndex((p) => p.step.id === id)
  if (step >= 0) return { option: chosen, at: step }
  const stage = walk.stages.findIndex((s) => s.id === id)
  return { option: chosen, at: stage >= 0 ? steps.findIndex((p) => p.stage === stage) : 0 }
}

/** The step to show after a change of option: this one, or the next one shown. */
export function afterSwitch(walk: Walkthrough, from: Placed, option?: string): number {
  const steps = placed(walk, option)
  const at = steps.findIndex((p) => p.order >= from.order)
  return at >= 0 ? at : steps.length - 1
}

const REMEMBERED = 'crombolo.walkthrough.choice'

function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

function remember(option: string) {
  try {
    localStorage.setItem(REMEMBERED, option)
  } catch {
    // Not kept: the reader picks again next time.
  }
}

const LANGUAGES: Record<string, string> = { sh: 'Terminal', tsx: 'TypeScript', text: '' }

function Code({ code }: { code: WalkthroughCode }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard refused: the text is still there to select.
    }
  }
  return (
    <figure className="walk__code">
      <figcaption>
        <span>{code.file ?? LANGUAGES[code.lang] ?? code.lang}</span>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre>
        <code className={`language-${code.lang}`}>{code.text}</code>
      </pre>
    </figure>
  )
}

/** A walkthrough shown a step at a time, with Back and Next; `children` is the whole page, for before it mounts. */
export default function WalkthroughView({ walk }: { walk: Walkthrough; children?: ReactNode }) {
  const [option, setOption] = useState(firstOption(walk))
  const [at, setAt] = useState(0)
  const steps = placed(walk, option)
  const top = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  useEffect(() => {
    const show = (where: { option?: string; at: number }) => {
      setOption(where.option)
      setAt(where.at)
    }
    const follow = () => {
      moved.current = true
      show(stepFor(walk, location.hash, firstOption(walk, remembered())))
    }
    show(stepFor(walk, location.hash, firstOption(walk, remembered())))
    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
  }, [walk])

  useEffect(() => {
    if (!moved.current) return
    heading.current?.focus({ preventScroll: true })
    const box = top.current?.getBoundingClientRect()
    if (box && box.top < 0) top.current?.scrollIntoView({ block: 'start' })
  }, [at])

  const current = steps[at] as Placed
  const stage = walk.stages[current.stage] as WalkthroughStage
  const back = steps[at - 1]
  const next = steps[at + 1]
  const finish = current.index === current.of - 1 && current.step.code.length === 0
  const go = (to: number, list = steps) => {
    moved.current = true
    setAt(to)
    history.replaceState(null, '', `#${(list[to] as Placed).step.id}`)
  }
  const pick = (picked: string) => {
    remember(picked)
    setOption(picked)
    go(afterSwitch(walk, current, picked), placed(walk, picked))
  }

  return (
    <div className="walk" ref={top}>
      <div className="prose" dangerouslySetInnerHTML={{ __html: walk.intro }} />
      {walk.choice ? (
        <fieldset className="walk__choice">
          <legend>{walk.choice.name}</legend>
          {walk.choice.options.map((o) => (
            <label key={o}>
              <input
                type="radio"
                name="walk-choice"
                value={o}
                checked={o === option}
                onChange={() => pick(o)}
              />
              {o}
            </label>
          ))}
        </fieldset>
      ) : null}
      <ol className="walk__stages">
        {walk.stages.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              aria-current={i === current.stage ? 'step' : undefined}
              onClick={() => go(steps.findIndex((p) => p.stage === i))}
            >
              <span className="walk__number">{i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>
      <section className={finish ? 'walk__step walk__step--finish' : 'walk__step'}>
        <p className="walk__count">
          {stage.title} · step {current.index + 1} of {current.of}
        </p>
        <h3 id={current.step.id} ref={heading} tabIndex={-1}>
          {current.step.title}
        </h3>
        <div className="prose" dangerouslySetInnerHTML={{ __html: current.step.text }} />
        {current.step.code.map((code) => (
          <Code key={`${current.step.id}:${code.file ?? ''}:${code.text}`} code={code} />
        ))}
        {current.step.see ? (
          <div className="walk__see prose" dangerouslySetInnerHTML={{ __html: current.step.see }} />
        ) : null}
        {current.step.note ? (
          <div
            className="walk__note prose"
            role="note"
            dangerouslySetInnerHTML={{ __html: current.step.note }}
          />
        ) : null}
      </section>
      <nav className="walk__nav" aria-label="Steps">
        {back ? (
          <button type="button" className="walk__back" onClick={() => go(at - 1)}>
            ← Back<span>{back.step.title}</span>
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button type="button" className="walk__next" onClick={() => go(at + 1)}>
            {next.stage === current.stage
              ? 'Next'
              : `Continue to ${walk.stages[next.stage]?.title}`}{' '}
            →<span>{next.step.title}</span>
          </button>
        ) : null}
      </nav>
    </div>
  )
}
