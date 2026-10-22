import { appendCacheInstruction, latestCacheInstructionId, liveNodes } from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { siteConfig } from '../../support/site.ts'

/**
 * Each node keeps its own published cache, so this asks all of them, the way an
 * editor's save does: a cache instruction every node acts on at its next poll.
 * Each node then reports the change it serves (story 174), so this can say
 * which have rebuilt rather than guess.
 */
export default class CacheRebuild extends BaseCommand {
  static override summary = 'rebuild the published cache on every node of the site'
  static override description =
    'Each node rebuilds at its next poll, within a few seconds, and this waits until every node seen in the last minute says it has. Nothing has to be reachable from here but the database.'
  static override flags = {
    wait: Flags.integer({
      summary: 'seconds to wait for every node to rebuild; 0 does not wait',
      default: 30,
      min: 0,
    }),
  }
  static override audit = {
    category: 'system',
    action: 'RebuildCache',
    entityType: 'Cache',
  } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'instruction', type: 'integer' },
      { name: 'checkpoint', type: 'integer', nullable: true },
      {
        name: 'nodes',
        type: 'array',
        items: { type: 'string' },
        description: 'the nodes seen in the last minute',
      },
      {
        name: 'behind',
        type: 'array',
        items: { type: 'string' },
        description: 'the nodes that had not rebuilt when the wait ran out',
      },
    ],
  } as const

  async run() {
    const { flags } = await this.parse(CacheRebuild)
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      // Stamped as the command line, never as a node: a node skips its own.
      const checkpoint = await appendCacheInstruction(db, {
        kind: 'content',
        payload: { all: true, reason: 'crombolo cache rebuild' },
        by: `cli:${config.nodeId}`,
      })
      const instruction = await latestCacheInstructionId(db)
      const nodes = (await liveNodes(db, { seenWithinMs: 60_000 })).map((node) => node.nodeId)
      if (nodes.length === 0) {
        this.say('  asked    every node to rebuild; none has been seen in the last minute')
        return { instruction, checkpoint, nodes, behind: [] }
      }
      this.say(`  asked    ${nodes.length} node(s) to rebuild: ${nodes.join(', ')}`)
      const behind = await this.#waitFor(db, checkpoint ?? 0, nodes, flags.wait)
      if (flags.wait > 0)
        this.say(
          behind.length === 0
            ? `  rebuilt  every node serves change ${checkpoint} or later`
            : `  waiting  ${behind.join(', ')} had not rebuilt after ${flags.wait}s; \`crombolo health\` shows each node's state`,
        )
      return { instruction, checkpoint, nodes, behind }
    } finally {
      await db.close()
    }
  }

  /**
   * The nodes that still serve older content once the wait is up. A node that
   * has not built its cache yet builds the latest on its first read, so it is
   * not waited for.
   */
  async #waitFor(
    db: Awaited<ReturnType<typeof bootstrapDatabase>>['db'],
    checkpoint: number,
    nodes: string[],
    seconds: number,
  ): Promise<string[]> {
    const deadline = Date.now() + seconds * 1000
    for (;;) {
      const live = await liveNodes(db, { seenWithinMs: 60_000 })
      const behind = nodes.filter((id) => {
        const node = live.find((candidate) => candidate.nodeId === id)
        return node?.servedCheckpoint != null && node.servedCheckpoint < checkpoint
      })
      if (behind.length === 0 || Date.now() >= deadline) return behind
      await Bun.sleep(500)
    }
  }
}
