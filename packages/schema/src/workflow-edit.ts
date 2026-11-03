/**
 * Changes to an approval workflow (story 251): its rules and what it applies to,
 * and its stages. Pure, each returning the changed workflow or why not; whether
 * the graph still holds is the parser's to say when the change is checked.
 */
import {
  type SchemaWorkflow,
  SEND_BACK_TO_EDITOR,
  type StageRequirement,
  type WorkflowComments,
  type WorkflowOnChange,
  type WorkflowOnEdit,
  type WorkflowSelfApproval,
  type WorkflowStage,
} from '@crombolo/core'

export type WorkflowEditResult =
  | { ok: true; workflow: SchemaWorkflow }
  | { ok: false; reason: string }

const refuse = (reason: string): WorkflowEditResult => ({ ok: false, reason })

const added = (list: readonly string[], more: readonly string[] = []) => [
  ...list,
  ...more.filter((item) => !list.includes(item)),
]
const without = (list: readonly string[], less: readonly string[] = []) =>
  list.filter((item) => !less.includes(item))

export interface WorkflowChanges {
  name?: string
  addContentTypes?: readonly string[]
  removeContentTypes?: readonly string[]
  addBranches?: readonly string[]
  removeBranches?: readonly string[]
  publishersMaySkip?: boolean
  onEdit?: WorkflowOnEdit
  selfApproval?: WorkflowSelfApproval
  comments?: WorkflowComments
  unpublish?: boolean
  onChange?: WorkflowOnChange
  scheduling?: boolean
}

/** A workflow's name, rules and what it applies to. */
export function updateWorkflow(
  workflow: SchemaWorkflow,
  changes: WorkflowChanges,
): WorkflowEditResult {
  for (const type of changes.removeContentTypes ?? [])
    if (!workflow.appliesTo.contentTypes.includes(type))
      return refuse(`"${workflow.alias}" does not apply to the content type "${type}"`)
  for (const branch of changes.removeBranches ?? [])
    if (!workflow.appliesTo.branches.includes(branch))
      return refuse(`"${workflow.alias}" does not apply to the branch "${branch}"`)
  return {
    ok: true,
    workflow: {
      ...workflow,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      appliesTo: {
        contentTypes: without(
          added(workflow.appliesTo.contentTypes, changes.addContentTypes),
          changes.removeContentTypes,
        ),
        branches: without(
          added(workflow.appliesTo.branches, changes.addBranches),
          changes.removeBranches,
        ),
      },
      ...(changes.publishersMaySkip !== undefined
        ? { publishersMaySkip: changes.publishersMaySkip }
        : {}),
      ...(changes.onEdit !== undefined ? { onEdit: changes.onEdit } : {}),
      ...(changes.selfApproval !== undefined ? { selfApproval: changes.selfApproval } : {}),
      ...(changes.comments !== undefined ? { comments: changes.comments } : {}),
      ...(changes.unpublish !== undefined ? { unpublish: changes.unpublish } : {}),
      ...(changes.onChange !== undefined ? { onChange: changes.onChange } : {}),
      ...(changes.scheduling !== undefined ? { scheduling: changes.scheduling || undefined } : {}),
    },
  }
}

export interface NewStage {
  alias: string
  name?: string
  approvers: readonly string[]
  required?: StageRequirement
  /** The stages it follows; the last ones (those nothing follows) when absent. */
  after?: readonly string[]
  /** The stages that follow it; none, so it is a last stage, when absent. */
  next?: readonly string[]
  sendBack?: string
}

const stageNamed = (workflow: SchemaWorkflow, alias: string) =>
  workflow.stages.find((stage) => stage.alias.toLowerCase() === alias.toLowerCase())

/** A stage added: after the stages named, or after the last ones, so a line grows at its end. */
export function addStage(workflow: SchemaWorkflow, stage: NewStage): WorkflowEditResult {
  if (stageNamed(workflow, stage.alias))
    return refuse(`"${workflow.alias}" already has a stage "${stage.alias}"`)
  if (stage.approvers.length === 0) return refuse('a stage needs at least one approver group')
  for (const alias of [...(stage.after ?? []), ...(stage.next ?? [])])
    if (!stageNamed(workflow, alias)) return refuse(`"${workflow.alias}" has no stage "${alias}"`)
  const after =
    stage.after ?? workflow.stages.filter((s) => s.next.length === 0).map((s) => s.alias)
  const next: WorkflowStage = {
    alias: stage.alias,
    ...(stage.name ? { name: stage.name } : {}),
    approvers: [...stage.approvers],
    required: stage.required ?? 'one',
    next: [...(stage.next ?? [])],
    sendBack: stage.sendBack ?? SEND_BACK_TO_EDITOR,
  }
  return {
    ok: true,
    workflow: {
      ...workflow,
      stages: [
        ...workflow.stages.map((s) =>
          after.includes(s.alias)
            ? { ...s, next: added(without(s.next, stage.next), [stage.alias]) }
            : s,
        ),
        next,
      ],
    },
  }
}

export interface StageChanges {
  name?: string
  /** Its approver groups, all of them. */
  approvers?: readonly string[]
  addApprovers?: readonly string[]
  removeApprovers?: readonly string[]
  required?: StageRequirement
  /** What follows it, all of it; empty makes it a last stage. */
  next?: readonly string[]
  sendBack?: string
}

/** A stage's name, approvers, what it needs, what follows it and where it sends back to. */
export function updateStage(
  workflow: SchemaWorkflow,
  alias: string,
  changes: StageChanges,
): WorkflowEditResult {
  const stage = stageNamed(workflow, alias)
  if (!stage) return refuse(`"${workflow.alias}" has no stage "${alias}"`)
  for (const other of changes.next ?? [])
    if (!stageNamed(workflow, other)) return refuse(`"${workflow.alias}" has no stage "${other}"`)
  for (const group of changes.removeApprovers ?? [])
    if (!stage.approvers.includes(group))
      return refuse(`"${stage.alias}" is not approved by "${group}"`)
  const approvers = without(
    added(changes.approvers ?? stage.approvers, changes.addApprovers),
    changes.removeApprovers,
  )
  if (approvers.length === 0) return refuse('a stage needs at least one approver group')
  const next: WorkflowStage = {
    ...stage,
    ...(changes.name !== undefined ? { name: changes.name || undefined } : {}),
    approvers,
    ...(changes.required !== undefined ? { required: changes.required } : {}),
    ...(changes.next !== undefined ? { next: [...changes.next] } : {}),
    ...(changes.sendBack !== undefined ? { sendBack: changes.sendBack } : {}),
  }
  return {
    ok: true,
    workflow: { ...workflow, stages: workflow.stages.map((s) => (s === stage ? next : s)) },
  }
}

/** A stage taken out, the stages before it passing on to what came after it. */
export function removeStage(workflow: SchemaWorkflow, alias: string): WorkflowEditResult {
  const stage = stageNamed(workflow, alias)
  if (!stage) return refuse(`"${workflow.alias}" has no stage "${alias}"`)
  if (workflow.stages.length === 1)
    return refuse('a workflow keeps at least one stage: remove the workflow instead')
  const sendingBack = workflow.stages.filter((s) => s.sendBack === stage.alias).map((s) => s.alias)
  if (sendingBack.length > 0)
    return refuse(
      `${sendingBack.map((s) => `"${s}"`).join(', ')} send${sendingBack.length === 1 ? 's' : ''} back to "${stage.alias}"; change where ${sendingBack.length === 1 ? 'it sends' : 'they send'} back first`,
    )
  return {
    ok: true,
    workflow: {
      ...workflow,
      stages: workflow.stages
        .filter((s) => s !== stage)
        .map((s) =>
          s.next.includes(stage.alias)
            ? { ...s, next: added(without(s.next, [stage.alias]), stage.next) }
            : s,
        ),
    },
  }
}
