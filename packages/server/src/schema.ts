/**
 * Schema-as-code at runtime: the boot sync, the development watcher that
 * re-syncs on file changes, and the cache-instruction poll that keeps this
 * node's caches coherent with the others. docs/schema-as-code.md.
 */

import { existsSync, watch } from 'node:fs'
import {
  CACHE_INSTRUCTION_CHANNEL,
  type CacheInstructionKind,
  cacheInstructionsAfter,
  compareStates,
  contractsLedgeredAfter,
  currentSchemaState,
  type Db,
  ensureSystemContentTypes,
  ensureSystemMemberTypes,
  type Finding,
  instructionEffects,
  instructionsBetween,
  Locks,
  latestCacheInstructionId,
  latestCheckpoint,
  latestLedgerId,
  type NodeSchemaState,
  readWritesPaused,
  touchServer,
  updateSchemaStateHash,
  type WritesPaused,
  writeReport,
} from '@crombolo/data'
import {
  type ChangeClass,
  type CheckReport,
  hashSchemaSet,
  loadSchemaDirectory,
  loadValueMigrations,
  runCheck,
  type SyncOptions,
  type SyncReport,
  syncSchema,
  writeKeysBack,
} from '@crombolo/schema'
import { listComponents } from './components.ts'
import { type CromboloConfig, VERSION } from './config.ts'
import { formTypesFor } from './form-types.ts'
import { logger } from './logging.ts'
import { useSchemaStore } from './schema-store.ts'

export interface SchemaBoot {
  /** The state this node runs at: the files' version, the deploy's revision. */
  nodeState: NodeSchemaState
  nodeId: string
  /** Undefined when there is no schema directory. */
  report: SyncReport | undefined
  /** True when the database is ahead of the files: reads only, 409 on writes. */
  compatibilityMode: boolean
  /** The pre-upgrade check run at boot (development), written to `change_report`. */
  check?: CheckReport
}

/** Production boot found the site diff needs data work: that is `upgrade check`'s job, not boot's. */
export class UpgradeRequiredError extends Error {
  constructor(readonly check: CheckReport) {
    super(
      `schema/ changes need data work before they can apply (${check.outstanding.length} finding(s), ${check.classification}): ` +
        'run `crombolo upgrade check`, then `crombolo upgrade check --fix`, then `crombolo upgrade`.',
    )
  }
}

/** The check over the site's diff, with its value migrations loaded. */
export async function checkSchemaDirectory(
  db: Db,
  config: CromboloConfig,
  node: { nodeId: string; revision: string },
  options: { set?: Record<string, unknown> } = {},
): Promise<CheckReport> {
  const loaded = loadSchemaDirectory(config.schemaDir, { formTypes: formTypesFor(config) })
  return runCheck(
    db,
    loaded,
    { nodeId: node.nodeId, version: loaded.set.version, revision: node.revision },
    {
      ...syncOptionsFor(config),
      set: options.set,
      migrations: await loadValueMigrations(config.schemaDir),
      backOfficePath: config.backOfficePath,
    },
  )
}

export class SchemaBootError extends Error {
  constructor(readonly report: SyncReport) {
    super(
      report.problems.length > 0
        ? `schema/ has problems:\n${report.problems.map((p) => `  ${p.file}: ${p.path ? `${p.path}: ` : ''}${p.message}`).join('\n')}`
        : `schema sync refused: ${report.reason ?? 'unknown reason'}`,
    )
  }
}

/**
 * The components a schema may name as templates: every one of them, at any
 * depth, keyed by the path that is its alias.
 */
export function componentAliasesIn(componentsDir: string): Set<string> {
  return new Set(listComponents(componentsDir).map((component) => component.alias))
}

export function syncOptionsFor(config: CromboloConfig): SyncOptions {
  return {
    mode: config.development ? 'development' : 'production',
    componentAliases: componentAliasesIn(config.componentsDir),
    formTypes: formTypesFor(config),
  }
}

/** One sync of the directory, with key write-back in development. */
export async function syncSchemaDirectory(
  db: Db,
  config: CromboloConfig,
  node: { nodeId: string; version?: string; revision: string },
  options: Partial<SyncOptions> = {},
): Promise<SyncReport> {
  // The files are read under the lock the backoffice's schema writes hold, so a
  // sync never applies a snapshot that a later backoffice change has overtaken.
  return db.locks.withLock(Locks.Schema, async () => {
    const loaded = loadSchemaDirectory(config.schemaDir, { formTypes: formTypesFor(config) })
    const report = await syncSchema(
      db,
      loaded,
      { nodeId: node.nodeId, version: loaded.set.version, revision: node.revision },
      { ...syncOptionsFor(config), ...options },
    )
    if (
      report.action === 'applied' &&
      config.schemaWritable &&
      report.assignedKeys.length > 0 &&
      report.state
    ) {
      writeKeysBack(loaded, report.assignedKeys)
      await updateSchemaStateHash(db, report.state.id, hashSchemaSet(loaded.set))
    }
    return report
  })
}

export async function bootSchema(db: Db, config: CromboloConfig): Promise<SchemaBoot> {
  const nodeId = config.nodeId
  if (!existsSync(config.schemaDir)) {
    const nodeState = { version: '0', revision: config.schemaRevision }
    await touchServer(db, { nodeId, ...nodeState, role: config.role, cromboloVersion: VERSION })
    await ensureSystemMemberTypes(db)
    await ensureSystemContentTypes(db)
    return { nodeState, nodeId, report: undefined, compatibilityMode: false }
  }
  const loaded = loadSchemaDirectory(config.schemaDir, { formTypes: formTypesFor(config) })
  const nodeState = { version: loaded.set.version, revision: config.schemaRevision }
  await touchServer(db, { nodeId, ...nodeState, role: config.role, cromboloVersion: VERSION })
  if (!config.syncSchemaAtBoot)
    return { nodeState, nodeId, report: undefined, compatibilityMode: false }

  const node = { nodeId, revision: config.schemaRevision }
  if (!config.development) {
    // A rolling deploy expands; anything needing data refuses and names the command.
    const check = await checkSchemaDirectory(db, config, node)
    if (check.sync.action === 'would-apply' && check.outstanding.length > 0)
      throw new UpgradeRequiredError(check)
  }
  const report = await syncSchemaDirectory(db, config, node)
  if (report.action === 'refused') throw new SchemaBootError(report)
  await ensureSystemMemberTypes(db)
  await ensureSystemContentTypes(db)
  const boot: SchemaBoot = {
    nodeState,
    nodeId,
    report,
    compatibilityMode: report.action === 'skipped-older',
  }
  if (config.development) {
    // pending-allowed: the findings go to the dashboard, and boot continues.
    boot.check = await checkSchemaDirectory(db, config, node)
    await writeReport(db, boot.check.findings, { source: 'upgrade' })
  }
  return boot
}

export interface SchemaWatcher {
  close(): void
}

/** Re-syncs on every change under `schema/`; development only. */
export function watchSchema(
  db: Db,
  config: CromboloConfig,
  node: { nodeId: string; revision: string },
  onReport: (report: SyncReport) => void,
): SchemaWatcher | undefined {
  if (!existsSync(config.schemaDir)) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false
  let closed = false
  const run = async () => {
    if (closed) return
    if (running) {
      again = true
      return
    }
    running = true
    try {
      onReport(await syncSchemaDirectory(db, config, node))
    } catch (error) {
      if (!closed) logger('schema').error('Watching the schema files failed', { error })
    } finally {
      running = false
      if (again) {
        again = false
        void run()
      }
    }
  }
  const watcher = watch(config.schemaDir, { recursive: true }, (_event, file) => {
    if (file && !String(file).endsWith('.toml')) return
    clearTimeout(timer)
    timer = setTimeout(() => void run(), 150)
  })
  watcher.unref()
  return {
    close() {
      closed = true
      clearTimeout(timer)
      watcher.close()
    },
  }
}

export interface CachePollerOptions {
  db: Db
  nodeId: string
  nodeState: NodeSchemaState
  /** Recorded in `server` on each poll, so the cluster can be read back by role. */
  role?: string
  /** Called for instructions other nodes appended. */
  onInstruction(kind: CacheInstructionKind, payload: Record<string, unknown>): void
  /**
   * The published cache's freshness (story 174). With it, content and schema
   * instructions only wake the poll: the node compares the latest committed
   * checkpoint with the one it serves, and is told it is behind. Being ordered
   * by commit, the checkpoint cannot skip a change that committed late.
   */
  content?: {
    served(): { checkpoint: number | undefined; builtAt: Date } | undefined
    /** Resolves once the rebuild it starts has finished, so a poll ends caught up. */
    behind(latest: number): Promise<void> | void
    /**
     * Told that every change from the one it serves up to `checkpoint` left the
     * pages alone — media only (story 197) — so its snapshot holds them too.
     */
    covered?(checkpoint: number): void
  }
  /**
   * The media cache (story 197). Every change, this node's own included, is
   * read in checkpoint order: a media change drops the items it names, and a
   * change that empties caches empties it. A gap in the checkpoints, or being
   * further behind than `MEDIA_REPLAY_LIMIT`, empties it too.
   */
  media?: {
    apply(change: { keys: string[]; moved: string[] }): void
    clear(): void
  }
}

/** A rebuild asked for and not yet served is asked for again after this long. */
const REASK_AFTER_MS = 30_000

/** Further behind than this many changes, the media cache is emptied rather than replayed. */
export const MEDIA_REPLAY_LIMIT = 5_000

/**
 * Polls `cache_instruction` from where this node came in; own instructions are
 * skipped. Where the database can notify, a write wakes it at once and the
 * timer is only the fallback.
 */
/** How far behind its cursor the poller looks for a views instruction that committed late. */
const CURSOR_WINDOW = 100

export class CacheInstructionPoller {
  #options: CachePollerOptions
  #cursor = 0
  /** Where this node started: history before it was never this node's to apply. */
  #origin = 0
  /** Ids applied within the window behind the cursor. */
  #seen = new Set<number>()
  #timer: ReturnType<typeof setInterval> | undefined
  #unlisten: (() => Promise<void>) | undefined
  #running: Promise<number> | undefined
  #queued: Promise<number> | undefined
  #behind = false
  #bootLedgerId = 0
  #readsUnsafe = false
  #paused: WritesPaused | undefined
  /** The checkpoint this node last asked its cache to catch up to, and when. */
  #asked: { checkpoint: number; at: number } | undefined
  #catchingUp: Promise<void> | void = undefined
  #latest: number | undefined
  /** The checkpoint whose changes have all been read for the caches; undefined before the start. */
  #followed: number | undefined
  /** Checkpoints read whose changes left the pages alone. */
  #pagesFree = new Set<number>()

  /** The latest committed content checkpoint, as of the last poll. */
  get latestCheckpoint(): number | undefined {
    return this.#latest
  }

  /** True once an upgrade has moved the database past this node: reads only. */
  get behind(): boolean {
    return this.#behind
  }

  /**
   * True once the node is behind and a contract — a framework contract or a
   * site purge — has run since it booted. Expand-only changes leave an old
   * node's reads correct, as-of its own state; a contract removes something it
   * may still read, so only then must it stop serving.
   */
  get readsUnsafe(): boolean {
    return this.#readsUnsafe
  }

  /** Set while an operator has paused editing cluster-wide. */
  get paused(): WritesPaused | undefined {
    return this.#paused
  }

  constructor(options: CachePollerOptions) {
    this.#options = options
  }

  async start(intervalMs: number): Promise<void> {
    this.#bootLedgerId = await latestLedgerId(this.#options.db)
    this.#paused = await readWritesPaused(this.#options.db)
    this.#cursor = await latestCacheInstructionId(this.#options.db)
    this.#origin = this.#cursor
    // An empty media cache is current with whatever has committed so far.
    this.#followed = await latestCheckpoint(this.#options.db)
    if (intervalMs > 0) {
      this.#timer = setInterval(() => void this.poll().catch(() => {}), intervalMs)
      this.#timer.unref()
      // Without it the timer still delivers everything, only later.
      this.#unlisten = await this.#options.db
        .listen?.(CACHE_INSTRUCTION_CHANNEL, () => void this.poll().catch(() => {}))
        .catch(() => undefined)
    }
  }

  /**
   * Returns how many foreign instructions were applied. One poll at a time: a
   * call while one runs waits for a single follow-up, so a burst of wake-ups
   * reads the table twice, not once each.
   */
  poll(): Promise<number> {
    if (this.#queued) return this.#queued
    if (!this.#running) return this.#start()
    this.#queued = this.#running
      .catch(() => 0)
      .then(() => {
        this.#queued = undefined
        return this.#start()
      })
    return this.#queued
  }

  #start(): Promise<number> {
    const run = this.#pollOnce().finally(() => {
      if (this.#running === run) this.#running = undefined
    })
    this.#running = run
    return run
  }

  async #pollOnce(): Promise<number> {
    const { db, nodeId, nodeState, onInstruction } = this.#options
    // Read first: every instruction numbered up to it has committed, and is visible below.
    const latest = await latestCheckpoint(db)
    // A row can commit after one with a higher id (Postgres hands ids out
    // before commit), so a short window behind the cursor is read again and
    // the ids already seen are skipped.
    const instructions = await cacheInstructionsAfter(db, Math.max(0, this.#cursor - CURSOR_WINDOW))
    let applied = 0
    for (const instruction of instructions) {
      if (this.#seen.has(instruction.id) || instruction.id <= this.#origin) continue
      this.#seen.add(instruction.id)
      this.#cursor = Math.max(this.#cursor, instruction.id)
      if (instruction.createdBy === nodeId) continue
      applied += 1
      // The checkpoint below decides; an instruction about content only woke us.
      if (this.#options.content && instruction.checkpoint !== null) continue
      onInstruction(instruction.kind, instruction.payload)
    }
    for (const id of this.#seen) if (id <= this.#cursor - CURSOR_WINDOW) this.#seen.delete(id)
    await this.#follow(latest)
    this.#catchUp(latest)
    await this.#catchingUp
    this.#catchingUp = undefined
    const served = this.#options.content?.served()
    await touchServer(db, {
      nodeId,
      ...nodeState,
      role: this.#options.role,
      cromboloVersion: VERSION,
      served:
        served?.checkpoint === undefined
          ? undefined
          : { checkpoint: served.checkpoint, at: served.builtAt },
    })
    const current = await currentSchemaState(db)
    const behind = compareStates(nodeState, current) < 0
    if (behind && !this.#behind) onInstruction('schema', { stateId: current.id })
    this.#behind = behind
    // Sticky: once a contract has passed this node, no later poll makes its
    // reads trustworthy again — only a replacement node does.
    if (behind && !this.#readsUnsafe)
      this.#readsUnsafe = (await contractsLedgeredAfter(db, this.#bootLedgerId)) > 0
    this.#paused = await readWritesPaused(db)
    return applied
  }

  /**
   * Reads every change since the last checkpoint followed, in order: for the
   * media cache, and to know which left the pages alone. Checkpoints count up
   * by one per change, so a number with no instruction was pruned before this
   * node read it, and the media cache cannot know what it missed.
   */
  async #follow(latest: number): Promise<void> {
    const from = this.#followed
    if (from === undefined || latest === from) return
    const media = this.#options.media
    this.#followed = latest
    // Behind a reset count, or too far behind to replay: start the media again.
    if (latest < from || latest - from > MEDIA_REPLAY_LIMIT) {
      media?.clear()
      this.#pagesFree.clear()
      return
    }
    const missed = await instructionsBetween(this.#options.db, from, latest)
    const numbered = new Set(missed.map((instruction) => instruction.checkpoint))
    let gap = false
    for (let checkpoint = from + 1; checkpoint <= latest && !gap; checkpoint++)
      gap = !numbered.has(checkpoint)
    if (gap) media?.clear()
    for (const instruction of missed) {
      const effects = instructionEffects(instruction.kind, instruction.payload)
      if (!effects.pages && instruction.checkpoint !== null)
        this.#pagesFree.add(instruction.checkpoint)
      if (gap || !media || effects.media === 'keep') continue
      if (effects.media === 'clear') media.clear()
      else media.apply(effects.media)
    }
  }

  /**
   * Tells the cache it is behind when the latest committed checkpoint is past
   * the one it serves, and any changes between left pages alone. A cache that
   * has not been built yet is left to build on its first read. A request not
   * served within a while is made again, so a failed rebuild is retried.
   */
  #catchUp(latest: number) {
    const content = this.#options.content
    if (!content) return undefined
    this.#latest = latest
    let served = content.served()
    if (served?.checkpoint === undefined) return served
    let covered = served.checkpoint
    while (this.#pagesFree.has(covered + 1)) covered += 1
    for (const checkpoint of this.#pagesFree)
      if (checkpoint <= covered) this.#pagesFree.delete(checkpoint)
    if (covered > served.checkpoint) {
      content.covered?.(covered)
      served = content.served() ?? served
    }
    if (covered >= latest) return served
    const asked = this.#asked
    if (!asked || asked.checkpoint < latest || Date.now() - asked.at > REASK_AFTER_MS) {
      this.#asked = { checkpoint: latest, at: Date.now() }
      this.#catchingUp = content.behind(latest)
    }
    return served
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
    void this.#unlisten?.().catch(() => {})
    this.#unlisten = undefined
  }
}

export interface SchemaImportResult {
  /** Files copied down from the store; undefined when the schema is a directory. */
  materialised: number | undefined
  /** How the files compare with the live database, from the same check that gates an upgrade. */
  classification: ChangeClass
  /** Findings a person should see before this is applied. */
  findings: Finding[]
  /** Undefined for a dry run, which asks what would happen without doing it. */
  report: SyncReport | undefined
}

/**
 * Applies the schema files to the database at runtime, rather than only at boot.
 *
 * This is what makes the files the source of truth rather than a projection of
 * the database: a TOML edited in a commit, published by another node, or written
 * by the backoffice arrives here and is imported the same way, through one path.
 *
 * Deliberately never automatic. It runs when someone asks, or when an operation
 * needs it — publishing type changes, say — because
 * importing a half-finished schema underneath an editor mid-save is worse than
 * importing a minute later.
 *
 * `nodeState` is refreshed in place on success: the poller, `/health` and the
 * published-content source all hold that one object, and without it a node that
 * has just imported its own change would immediately judge itself behind and
 * drain.
 */
export async function importSchema(
  db: Db,
  config: CromboloConfig,
  boot: { nodeId: string; nodeState: NodeSchemaState },
  options: { dryRun?: boolean; materialise?: boolean } = {},
): Promise<SchemaImportResult> {
  // A caller that has just written into the directory says not to, or the store's
  // older copy would be laid over its write.
  const materialised = options.materialise === false ? undefined : await useSchemaStore(config)
  if (!existsSync(config.schemaDir)) {
    return { materialised, classification: 'none', findings: [], report: undefined }
  }

  const node = { nodeId: boot.nodeId, revision: config.schemaRevision }
  const check = await checkSchemaDirectory(db, config, node)
  if (options.dryRun) {
    return {
      materialised,
      classification: check.classification,
      findings: check.outstanding,
      report: undefined,
    }
  }

  const report = await syncSchemaDirectory(db, config, node)
  if (report.action === 'applied') {
    boot.nodeState.version = loadSchemaDirectory(config.schemaDir, {
      formTypes: formTypesFor(config),
    }).set.version
    boot.nodeState.revision = config.schemaRevision
  }
  return {
    materialised,
    classification: check.classification,
    findings: check.outstanding,
    report,
  }
}
