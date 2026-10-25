# 182 — Extensions can dock a panel beside the back office

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone building a back-office extension, I want to dock a panel beside
whatever view the editor has open, and keep it there as they move around,
so that a tool they work alongside (help, notes, an assistant, a checklist)
sits next to their work instead of covering it.

## Context

The vendored back office has no slot for this. `umb-backoffice` renders the
header, `umb-backoffice-main` and a bare slot in a column
(`dist/apps/backoffice/backoffice.element.js`), and main fixes its own height.
An extension today can add a header app, a modal, or Umbraco's `sidebar`
modal, which is an overlay. The only way to dock beside main is to draw a
fixed-position element and shrink main with CSS aimed at Umbraco's internal
markup. Each extension that does that breaks differently on an upgrade.

Patching a vendored class in one place, with a test that fails when upstream
changes it, has precedent: `plugin/edit-conflicts.js` (`watchLoads`) and the
query builder in `plugin/branding/`.

## Acceptance criteria

- [x] **A manifest type, `sidePanel`:**
      `{ alias, name, element, weight, conditions?, meta: { label, icon,
      defaultWidth?, minWidth?, maxWidth? } }`, with defaults of 400, 280 and
      720 px. Any bundle's client half may declare one.
- [x] **A docked column:** the back office lays out header, then main and the
      panel side by side. Main shrinks beside an open panel, and the
      panel's height is the space below the header. One panel is open at a
      time.
- [x] **It survives navigation.** The panel sits outside the router, so
      moving between sections, trees and workspaces keeps it open, with its
      element and state.
- [x] **A control context,** `Crombolo.Context.SidePanel`, consumed by its
      string alias so extensions import nothing internal: `open(alias)`,
      `close()`, `toggle(alias)`, `active`, `width`, and `setAvailable(alias,
      available)`.
- [x] **A toggle:** a header-app kind, `sidePanelToggle` (`meta: { panel,
      label, icon }`), opens and closes a panel, and hides while that panel
      is unavailable.
- [x] **Resizable:** a splitter between main and the panel, clamped to the
      panel's limits and to half the window.
- [x] **Remembered:** which panel is open and its width are kept per user in
      the browser and restored on the next load.
- [x] **Small screens:** below 768 px, or when main would drop under 480 px,
      the panel opens as a full-width sheet over the view (`role="dialog"`,
      `aria-modal`). Escape closes it in that mode.
- [x] **Accessible:**
  - the docked panel is an `<aside role="complementary">` named by its
    label;
  - the splitter is `role="separator"` with `aria-valuenow/min/max`, moved
    16 px by the arrows, with Home/End jumping to the limits;
  - the toggle carries `aria-expanded` and `aria-controls`;
  - focus moves into the panel when it is opened from the keyboard, and back
    to the toggle when it closes;
  - `prefers-reduced-motion` turns off the slide.
- [x] **Guarded against upgrades:** a test renders the vendored
      `umb-backoffice` and fails if the structure the patch relies on
      changes.
- [x] **Documented:** a "Side panels" section in `docs/bundles.md` and
      `docs/backoffice-hosting.md`, with a minimal example panel.
- [x] **Tests:**
  - the layout patch;
  - the context;
  - the width clamp;
  - a browser test that a panel stays open across navigation and a reload,
    and that it becomes a sheet on a narrow window.

## Findings (2026-10-25)

- **The shell is three children in a column.** `umb-backoffice` renders
  `<umb-backoffice-header>`, `<umb-backoffice-main>` and a bare `<slot>`, in a
  flex column (`dist/chunks/backoffice.element-*.js` is what is served; the
  unbundled `apps/backoffice/backoffice.element.js` reads the same).
  `umb-backoffice-main` is `display: block; width: 100%; height: calc(100% -
  60px)`. Umbraco hard-codes the 60 px header there too, with a TODO.
- **Our entry points run after the shell exists.** `UmbBackofficeElement`'s
  constructor starts the entry-point initialisers, so a patch to its
  `render` must call `requestUpdate()` on the live instance. Its static
  styles are already adopted, so new styles go into the shadow root's
  `adoptedStyleSheets` instead.
- **The pieces the registry already has:**
  - **A custom type:** `umbExtensionsRegistry` takes any type string, so
    `sidePanel` needs no registration; the host observes `byType('sidePanel')`.
  - **A header-app kind:** `{ type: 'kind', matchType: 'headerApp',
    matchKind: 'sidePanelToggle', manifest: { element } }`, as `kind:
    'button'` is used today.
  - **A context by string:** a `globalContext` manifest (as
    `Crombolo.GlobalContext.Icons` is) whose api extends `UmbContextBase`
    with the alias `Crombolo.Context.SidePanel`. `consumeContext` takes the
    bare string, so an extension imports nothing of ours.
- **Plugin tests are pure.** `tests/*-plugin.test.ts` import the plugin's
  logic without a DOM (`edit-conflicts-plugin.test.ts`). So the clamp, the
  dock-or-sheet rule and the stored state are pure functions in their own
  module, and the upgrade guard reads the served chunk's text rather than
  rendering it. The DOM behaviour is the browser test.

## Plan

### 1. Layout (decided 2026-10-25): patch `umb-backoffice`'s render

- New `plugin/side-panel/host.js`, a `backofficeEntryPoint`. It takes the
  class from `customElements.get('umb-backoffice')` and wraps its `render`.
  The result is the header, then a flex row of main and
  `<crombolo-side-panel-host>`, then the slot:

  ```html
  <umb-backoffice-header></umb-backoffice-header>
  <div id="crombolo-row">
    <umb-backoffice-main></umb-backoffice-main>
    <crombolo-side-panel-host></crombolo-side-panel-host>
  </div>
  <slot></slot>
  ```

  - **Styles:** a stylesheet goes into the live shadow root's
    `adoptedStyleSheets`. The row takes `flex: 1; min-height: 0`, main
    becomes `height: 100%; flex: 1; min-width: 0`, overriding Umbraco's
    `calc(100% - 60px)`, and the panel is sized by its width.
  - **Live instance:** the entry point runs after the shell has rendered, so
    it calls `requestUpdate()` on it.
  - **The wrapped render** keeps the original's output when the original no
    longer renders those three children, and logs that, so an upstream change
    leaves an unpatched back office rather than a broken one. The guard test
    fails first. The panel's element is created once per alias and kept, not
  re-created, so its state survives closing and reopening. It sits outside
  `umb-router-slot`, so navigation never touches it.

### 2. Logic, pure (`plugin/side-panel/layout.js`)

- `clampWidth(width, meta, windowWidth)`: the panel's min and max, and at most
  half the window.
- `modeFor(windowWidth, panelWidth)`: `sheet` below 768 px or when main
  would drop under 480 px, else `docked`.
- `stored(userKey)` and `store(userKey, { open, width })`: localStorage,
  keyed by user, wrapped in try/catch.
- Defaults: width 400, min 280, max 720.

### 3. Context and toggle

- `plugin/side-panel/context.js`, a `globalContext` api with the alias
  `Crombolo.Context.SidePanel`. It has `open`, `close`, `toggle`, `active` and
  `width` (observables), and `setAvailable(alias, available)`.
- `plugin/side-panel/toggle.js`, the `sidePanelToggle` header-app kind. It
  hides while its panel is unavailable, and carries `aria-expanded` and
  `aria-controls`.

### 4. The panel frame

- **Docked:** `<aside role="complementary" aria-label=…>` with a splitter
  (`role="separator"`, `aria-valuenow/min/max`, pointer drag, arrows ±16 px,
  Home/End to the limits).
- **Sheet:** `role="dialog" aria-modal="true"`, full width over main, and
  Escape closes it.
- Focus moves in when opened from the keyboard, and back to the toggle on
  close. `prefers-reduced-motion` turns off the slide.

### 5. Guard, docs, tests

- `tests/side-panel-plugin.test.ts`:
  - the clamp, the mode rule and the stored state;
  - the guard: the served chunk still renders header, main and slot, in that
    order, and main still fixes its height, which is what the layout assumes.
- `tests/browser/side-panel.browser.ts`: a test bundle declares a panel
  (registered from the browser site's own plugin). The panel stays open, with
  its state, across a section change and a reload, and becomes a sheet at
  700 px. I run it only to check this story, as the browser suite's rule
  says.
- `docs/bundles.md` and `docs/backoffice-hosting.md`: "Side panels", with a
  minimal example.

## Implementation (2026-10-25)

What differs from the plan and the criteria:

- **Docked into the live shell, not a patched `render`.** The plan wrapped
  `umb-backoffice`'s `render`. An entry point runs after the shell has drawn,
  so re-rendering it with a new template made Lit replace the live header and
  main. The browser test caught that: "Tree context is not set". So
  `dockInto` (`plugin/side-panel/host.js`) inserts
  `<crombolo-side-panel-host>` after main in the shell's shadow root, and adds
  a grid stylesheet to its `adoptedStyleSheets`. Nothing is re-rendered or
  moved. It is still a patch to the shell, in one place, guarded by the test.
- **No `sidePanelToggle` kind** (decided 2026-10-25). A `kind` manifest is
  Umbraco's own type and read as confusing. Instead a `sidePanel` with
  `meta.toggle: true` gets its header button, which the host registers.
  Extension authors write one manifest.
- **`aria-controls`** on the toggle names the panel's id. Ids do not resolve
  across shadow roots, so assistive technology may not follow it. The
  attribute is there as the criterion asks.
- **The browser test makes one section change, not two.** Two in quick
  succession trip the client's own "Tree context is not set" race. That race
  is independent of this story: it shows with the side-panel entry point
  removed altogether.
- **Tests:**
  - `tests/side-panel-plugin.test.ts`: the width clamp, the splitter keys,
    docked or sheet, the remembered state, and the guard on the served shell
    chunk;
  - `tests/dashboard.test.ts`: the new manifests;
  - `tests/browser/side-panel.browser.ts`: open, state kept across a section
    change, splitter keys, still open at its width after a reload, a sheet at
    700 px, and Escape. Its bundle is a test package the browser site
    installs (`tests/browser/serve.ts`).

## Out of scope

- More than one panel open at once, or panels on the left.
- Reading the open workspace from the panel. A bundle can already declare a
  `workspaceContext` that observes the workspace and shares what it sees
  with its own panel.
