# 455 — Code that reads as it does in a developer's editor

**Epic:** O — Building a site · **Priority:** could · **Size:** M
**Depends on:** 452

## Story

As someone editing a site's views and components in the back office, I want the code
coloured as richly as in my own editor, so that I can tell a type from a value, a
component from a tag, and one kind of Tailwind class from another at a glance.

## Context

The back office's code editors are Monaco. The plugin adds JSX to Monaco's TypeScript
grammar (`tsx-highlighting.js`), so views, partials and components show keywords,
strings, tags, attributes and comments in colour. Everything else (identifiers, types,
function names, components, numbers, punctuation) is plain, because the editors use the
plain themes Umbraco's code editor defines (`umb-light` and `umb-dark`, chosen by the
back office's theme). Story 452 gave the editor Tailwind's class list for completion and
hover; class names in a string are still coloured as plain string.

## Decided (2026-11-28)

All three in one story:

1. **A fuller theme.** A palette in the style of VS Code's, tuned to the back office's
   colours, in light and dark:
   - distinct colours for types, functions, variables, constants and parameters;
   - components, `<Layout>`, distinct from HTML tags, `<div>`;
   - attribute names, attribute values and the braces around an expression;
   - numbers, regular expressions, template strings and their `${…}`;
   - punctuation and operators.
2. **Highlighting by meaning.** Monaco's TypeScript service classifies each name: a type,
   an interface, a class, a function, a parameter, a property, a read-only constant, a
   value imported from a module. The editor colours by that classification on top of the
   grammar, as VS Code's semantic highlighting does, so `PageProps` and `props` differ
   even where the grammar can't tell.
3. **Tailwind classes in strings.** Inside `class`/`className` values and `clsx`/`cn`
   calls, each class is coloured by its kind: layout (`flex`, `grid`, spacing, sizing),
   colour (`bg-*`, `text-*` colours), type, effects, and the site's own `@utility` and
   `@theme` classes. Variants (`md:`, `hover:`, `dark:`) are coloured apart from the
   class. A colour class has a small swatch beside it. An unknown class keeps the string's
   colour.

## The design

- **The theme:** the plugin defines its own themes through Monaco's
  `editor.defineTheme` (Monaco's own API, not a runtime patch of Umbraco). It applies
  them where the editor follows the back office's light or dark theme, so a theme switch
  changes the editor too. If Umbraco's code editor doesn't let the plugin choose the
  theme, that is a small seam in the fork (`umbCromboloHooks`), like the others.
- **By meaning:** a semantic tokens provider on the `typescript` language, registered by
  `tsx-editors.js` through the `viewEditor` seam. It asks Monaco's TypeScript worker for
  its encoded semantic classifications (`getEncodedSemanticClassifications`) and maps
  them to token types and modifiers the theme colours. `'semanticHighlighting.enabled':
  true` is set on view editors only.
- **Tailwind classes:** decorations (`deltaDecorations`) rather than grammar, because
  only the class list knows what a class is. The pure "where are the classes in this
  text" function from 452 finds them; each is classed by the CSS properties it sets, from
  452's class list. Colour classes get an inline swatch (`before` content). Decorations are
  refreshed as the text changes, debounced, and only for what is visible.
- **Off with Tailwind:** with `styles.tailwind: false`, part 3 does nothing.

## Acceptance criteria

- [ ] **The theme:** in a view, types, functions, variables, constants, parameters,
      components, HTML tags, attribute names and values, numbers, template strings and
      punctuation each have their own colour, in light and dark. Switching the back
      office's theme switches the editor's.
- [ ] **By meaning:** a type, a value of that type, a function, a parameter and a
      read-only constant with the same spelling style are coloured differently, as the
      TypeScript service classifies them. A file with an error still highlights.
- [ ] **Tailwind classes:** in `className` values and `clsx`/`cn` calls, layout, colour,
      type and the site's own utilities are coloured by kind, variants apart, colour
      classes with a swatch; an unknown class keeps the string's colour; none of it with
      Tailwind off.
- [ ] **Speed:** typing in a 1,000-line view stays smooth (decorations debounced, visible
      range only).
- [ ] **Tests:** the mapping from TypeScript's classifications to token types, and the
      classing of a Tailwind class by kind, as pure functions; a browser journey: a view
      opened in the template editor shows a type, a component and a colour class each
      with its colour, and the swatch.
- [ ] **Docs:** `docs/writing-components.md` (editing in the back office), and the
      release notes.
