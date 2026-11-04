/** @jsxImportSource react */
/**
 * The product site's walkthrough island: a docs page's steps shown one at a
 * time, with Back and Next, and the step an address's fragment names.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import WalkthroughView, {
  afterSwitch,
  firstOption,
  placed,
  stepFor,
  type Walkthrough,
} from '../sites/crombolo/components/shared/walkthrough.tsx'

const WALK: Walkthrough = {
  intro: '<p>Why we are here.</p>',
  stages: [
    {
      id: 'up-and-running',
      title: 'Up and running',
      steps: [
        {
          id: 'make-the-site',
          title: 'Make the site',
          text: '<p>Make it.</p>',
          code: [{ lang: 'sh', text: 'bunx crombolo init' }],
          see: '<p>You&#39;ll see a site.</p>',
        },
        { id: 'welcome', title: 'Welcome', text: '<p>Welcome.</p>', code: [] },
      ],
    },
    {
      id: 'advanced',
      title: 'Advanced',
      steps: [
        {
          id: 'a-view',
          title: 'A view',
          text: '<p>Write it.</p>',
          code: [{ lang: 'tsx', file: 'components/page.tsx', text: 'export default 1' }],
          note: '<p><strong>Note it.</strong></p>',
        },
      ],
    },
  ],
}

describe('the walkthrough', () => {
  test('starts at its first step, with the stages, the code to copy and what to expect', () => {
    const html = renderToStaticMarkup(<WalkthroughView walk={WALK} />)
    expect(html).toContain('<p>Why we are here.</p>')
    expect(html).toContain('Up and running · step 1 of 2')
    expect(html).toContain('<h3 id="make-the-site" tabindex="-1">Make the site</h3>')
    expect(html).toContain('<span>Terminal</span><button type="button">Copy</button>')
    expect(html).toContain('<code class="language-sh">bunx crombolo init</code>')
    expect(html).toContain('<div class="walk__see prose"><p>You&#39;ll see a site.</p></div>')
    expect(html).toContain('<button type="button" aria-current="step">')
    // Nothing to go back to, and Next names the step it leads to
    expect(html).not.toContain('walk__back')
    expect(html).toContain('Next →<span>Welcome</span>')
    // One step at a time
    expect(html).not.toContain('Welcome.</p>')
  })

  test('opens at the step or stage an address names', () => {
    expect(stepFor(WALK, '#welcome').at).toBe(1)
    expect(stepFor(WALK, '#advanced').at).toBe(2)
    expect(stepFor(WALK, '').at).toBe(0)
    expect(stepFor(WALK, '#no-such-step').at).toBe(0)
  })

  test('places every step in reading order, within its stage', () => {
    expect(placed(WALK).map((p) => [p.stage, p.index, p.of, p.step.id])).toEqual([
      [0, 0, 2, 'make-the-site'],
      [0, 1, 2, 'welcome'],
      [1, 0, 1, 'a-view'],
    ])
  })
})

describe('a walkthrough with a choice', () => {
  const step = (id: string, only?: string) => ({
    id,
    title: id,
    text: `<p>${id}.</p>`,
    code: [],
    ...(only ? { only } : {}),
  })
  const CHOICE: Walkthrough = {
    intro: '',
    choice: { name: 'Database', options: ['SQLite', 'Postgres'] },
    stages: [
      {
        id: 'start',
        title: 'Start',
        steps: [
          step('start-postgres', 'Postgres'),
          step('make-sqlite', 'SQLite'),
          step('make-postgres', 'Postgres'),
          step('run'),
        ],
      },
    ],
  }
  const ids = (option: string) => placed(CHOICE, option).map((p) => p.step.id)

  test('shows the steps for the option picked, and the rest for every option', () => {
    expect(ids('SQLite')).toEqual(['make-sqlite', 'run'])
    expect(ids('Postgres')).toEqual(['start-postgres', 'make-postgres', 'run'])
    expect(placed(CHOICE, 'Postgres').map((p) => p.of)).toEqual([3, 3, 3])
  })

  test('starts on the first option, or the one the reader picked before', () => {
    expect(firstOption(CHOICE)).toBe('SQLite')
    expect(firstOption(CHOICE, 'Postgres')).toBe('Postgres')
    expect(firstOption(CHOICE, 'MySQL')).toBe('SQLite')
    expect(firstOption(WALK)).toBeUndefined()
  })

  test('an address naming another option’s step picks that option', () => {
    expect(stepFor(CHOICE, '#make-postgres', 'SQLite')).toEqual({ option: 'Postgres', at: 1 })
    expect(stepFor(CHOICE, '#run', 'SQLite')).toEqual({ option: 'SQLite', at: 1 })
  })

  test('switching keeps the reader where they were, or moves on to the next step shown', () => {
    const [make] = placed(CHOICE, 'SQLite')
    expect(ids('Postgres')[afterSwitch(CHOICE, make as never, 'Postgres')]).toBe('make-postgres')
    const [, run] = placed(CHOICE, 'SQLite')
    expect(ids('Postgres')[afterSwitch(CHOICE, run as never, 'Postgres')]).toBe('run')
  })

  test('offers the choice above the steps, with the first option picked', () => {
    const html = renderToStaticMarkup(<WalkthroughView walk={CHOICE} />)
    expect(html).toContain('<legend>Database</legend>')
    expect(html).toContain('<input type="radio" name="walk-choice" checked="" value="SQLite"/>')
    expect(html).toContain('make-sqlite.')
    expect(html).not.toContain('start-postgres.')
  })
})
