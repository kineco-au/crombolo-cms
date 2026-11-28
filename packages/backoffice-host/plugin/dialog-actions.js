/**
 * The buttons at the foot of every dialog, modal and page the plugin draws, so each looks
 * and is ordered the same. An action is `{ kind, label, onClick?, disabled?, state?,
 * href?, title?, type?, form? }`, and its kind says how it looks:
 *
 * - `primary`: the action itself (Create, Save, OK, Merge, Send…): positive, filled;
 * - `secondary`: leaving without it (Cancel, Close, Back…): outlined;
 * - `danger`: one that destroys (Delete, Remove…): outlined, in the danger colour.
 *
 * A dialog that only shows something closes with Close; one that makes or changes
 * something offers Cancel and its action. Secondary and danger come first, primary last.
 */
import { html, ifDefined } from '@umbraco-cms/backoffice/external/lit'

export const KINDS = {
  primary: { look: 'primary', color: 'positive' },
  secondary: { look: 'secondary' },
  danger: { look: 'secondary', color: 'danger' },
}

/** The `uui-button` attributes an action is drawn with. */
export function actionAttributes(action) {
  const look = KINDS[action.kind]
  if (!look) throw new Error(`No such kind of action: ${action.kind}`)
  return { slot: 'actions', ...look, label: action.label }
}

/** The actions to draw, in the one order: the falsy ones left out, primary last. */
export function orderActions(actions) {
  const shown = actions.filter(Boolean)
  return [
    ...shown.filter((action) => action.kind !== 'primary'),
    ...shown.filter((action) => action.kind === 'primary'),
  ]
}

/** One action as a Lit template, for a modal's or page's footer. */
export function actionButton(action) {
  const { look, color, label } = actionAttributes(action)
  return html`<uui-button
    slot="actions"
    look=${look}
    color=${ifDefined(color)}
    label=${label}
    title=${ifDefined(action.title)}
    href=${ifDefined(action.href)}
    type=${ifDefined(action.type)}
    form=${ifDefined(action.form)}
    ?disabled=${Boolean(action.disabled)}
    .state=${action.state}
    @click=${ifDefined(action.onClick)}
  ></uui-button>`
}

/** A footer's actions as Lit templates, in order. */
export const actionButtons = (...actions) => orderActions(actions).map(actionButton)

/** One action as an element, for a dialog opened on the page itself. */
export function actionElement(action, doc = document) {
  const button = doc.createElement('uui-button')
  for (const [name, value] of Object.entries(actionAttributes(action)))
    if (value !== undefined) button.setAttribute(name, value)
  for (const name of ['title', 'href', 'type', 'form'])
    if (action[name]) button.setAttribute(name, action[name])
  if (action.disabled) button.setAttribute('disabled', '')
  if (action.onClick) button.addEventListener('click', action.onClick)
  return button
}

/** A dialog's actions as elements, in order. */
export const actionElements = (actions, doc = document) =>
  orderActions(actions).map((action) => actionElement(action, doc))
