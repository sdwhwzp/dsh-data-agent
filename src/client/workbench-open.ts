/**
 * Cross-surface hand-off for opening the session-scoped database workbench
 * from the alpha.2 New Session hero, where no Session scope exists yet.
 */
import type { SessionListLike } from './DataAgentWorkbench.tsx'

/** The preset this package installs and owns; always database-capable. */
export const DATA_AGENT_PRESET = 'data-agent'

/**
 * Preset ids whose sessions carry the database tools, as the Host reports them.
 *
 * The deployment may mount the tool half into further presets
 * (`additionalToolPresets`), so the browser cannot decide this from a constant.
 * One in-flight request per page: the answer is deployment-wide and stable for
 * the life of the Host process, and every session control asks the same
 * question. Before it resolves — and if it fails — only the owned preset counts,
 * which is the behavior this package had before the list existed.
 */
let presetRequest: Promise<ReadonlySet<string>> | undefined

/** Fetch the database-capable preset ids once per page load. */
export function databasePresets(): Promise<ReadonlySet<string>> {
  presetRequest ??= fetch('/plugins/data-agent/presets')
    .then(async (response) => {
      if (!response.ok) throw new Error(`presets: HTTP ${response.status}`)
      const body = await response.json() as { ok?: boolean; presets?: unknown }
      if (body.ok !== true || !Array.isArray(body.presets)) throw new Error('presets: malformed response')
      return new Set<string>([DATA_AGENT_PRESET, ...body.presets.filter((id): id is string => typeof id === 'string')])
    })
    .catch(() => new Set<string>([DATA_AGENT_PRESET]))
  return presetRequest
}

/** Drop the cached answer so the next caller re-asks. Tests only. */
export function resetDatabasePresets(): void {
  presetRequest = undefined
}

/** Minimal observable contract consumed by the slot renderer's Hook binder. */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/** One pending/ready request to open the workbench. */
export interface WorkbenchOpenSnapshot {
  pending: boolean
  revision: number
  sessionId?: string
}

/** Mutable observable kept private behind the compatibility bridge. */
interface MutableObservableSnapshot<T> extends ObservableSnapshot<T> {
  set(snapshot: T): void
}

function createObservable<T>(initial: T): MutableObservableSnapshot<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(next) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

/** The Session-list operations needed to bridge a root action into one Session. */
export interface SessionListSource extends ObservableSnapshot<SessionListLike> {}

export interface WorkbenchOpenBridge {
  store: ObservableSnapshot<WorkbenchOpenSnapshot>
  /** Start the host's New Session flow and open once data-agent is mounted. */
  requestFromHero(): void
  /** Clear a delivered request after the target workbench accepts it. */
  acknowledge(revision: number): void
  dispose(): void
}

/**
 * Create the one-way hero → Session workbench bridge.
 *
 * The host remains responsible for workspace inheritance, Session creation,
 * navigation, and applying the staged agent preset. This bridge only waits
 * for the resulting Session projection before publishing an open request.
 */
export function createWorkbenchOpenBridge(
  sessions: SessionListSource,
  startSession: () => void,
): WorkbenchOpenBridge {
  const store = createObservable<WorkbenchOpenSnapshot>({ pending: false, revision: 0 })

  const settle = (): void => {
    const current = store.getSnapshot()
    if (!current.pending) return
    const list = sessions.getSnapshot()
    const sessionId = mainSessionId(list)
    if (sessionId === undefined) return
    if (list.byId[sessionId]?.projectionValues?.agentPreset !== DATA_AGENT_PRESET) return
    store.set({ pending: false, revision: current.revision + 1, sessionId })
  }

  const unsubscribe = sessions.subscribe(settle)
  return {
    store,
    requestFromHero() {
      if (store.getSnapshot().pending) return
      const current = store.getSnapshot()
      store.set({ pending: true, revision: current.revision })
      try {
        startSession()
        settle()
      } catch (error) {
        store.set({ pending: false, revision: current.revision })
        throw error
      }
    },
    acknowledge(revision) {
      const current = store.getSnapshot()
      if (current.revision !== revision || current.sessionId === undefined) return
      store.set({ pending: false, revision: current.revision })
    },
    dispose() {
      unsubscribe()
    },
  }
}

/** Return the main-view Session across the legacy and retained-list formats. */
export function mainSessionId(list: { current?: string } & Partial<Pick<SessionListLike, 'byId'>>): string | undefined {
  return list.current ?? Object.entries(list.byId ?? {}).find(([, item]) => (item.retainedBy?.mainView ?? 0) > 0)?.[0]
}
