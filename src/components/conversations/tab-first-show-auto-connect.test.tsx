/**
 * A tab restored behind another one stays mounted but hidden, and its detail
 * fetch waits until it is shown. It is not session-less meanwhile: its mount
 * effects create its runtime session. So the render that shows it — which is
 * also the render that makes it the active tab — sees a session with no detail
 * and no fetch in flight, and the auto-connect effect takes its gate from that
 * very render. If the gate reads "not loading" there, the connect goes out with
 * `sessionId: undefined`: the backend takes `session/new`, and the next prompt
 * re-points the conversation at that empty session.
 *
 * `ConversationTabView` is too heavy to render here, so `TabViewGate` repeats
 * its wiring of the pieces involved — the mount-time session claim, the
 * visibility-gated `useConversationDetail`, and the persisted-conversation gate
 * in front of the REAL `useConnectionLifecycle` — and the source checks at the
 * bottom keep that wiring pinned to the panel.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, cleanup, render } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useConnectionLifecycle } from "@/hooks/use-connection-lifecycle"
import { useConversationDetail } from "@/hooks/use-conversation-detail"
import type { DbConversationDetail } from "@/lib/types"
import {
  claimRuntimeSession,
  resetConversationRuntimeStore,
  useConversationRuntimeActions,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
  getFolderConversationTurns: vi.fn(),
}))

// Stable across renders: the lifecycle hook's unmount-cleanup effect depends
// on these, and fresh identities would tear the "connection" down every render.
const stubs = vi.hoisted(() => {
  const connect = vi.fn(() => Promise.resolve())
  return {
    connect,
    conn: {
      status: null,
      selectorsReady: false,
      connect,
      disconnect: vi.fn(() => Promise.resolve()),
      sendPrompt: vi.fn(),
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      cancel: vi.fn(),
      respondPermission: vi.fn(),
      modes: null,
      configOptions: null,
      hasCachedSelectors: false,
      isViewer: false,
      backgroundOutstanding: 0,
      sessionId: null,
    },
    acp: { setActiveKey: vi.fn(), touchActivity: vi.fn() },
    tasks: { addTask: vi.fn(), updateTask: vi.fn(), removeTask: vi.fn() },
    t: Object.assign((key: string) => key, { rich: (key: string) => key }),
  }
})
vi.mock("@/hooks/use-connection", () => ({ useConnection: () => stubs.conn }))
vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => stubs.acp,
}))
vi.mock("@/contexts/task-context", () => ({
  useTaskContext: () => stubs.tasks,
}))
vi.mock("next-intl", () => ({ useTranslations: () => stubs.t }))

const { getFolderConversation } = await import("@/lib/api")
const mockGet = vi.mocked(getFolderConversation)

const CID = 42
const STORED_SESSION = "sess-stored"

function TabViewGate({ shown }: { shown: boolean }) {
  // The panel's mount effect: claim the session and clear pendingCleanup —
  // which is what materializes a hidden tab's runtime session.
  const { setPendingCleanup } = useConversationRuntimeActions()
  useEffect(() => {
    claimRuntimeSession(CID)
    setPendingCleanup(CID, false)
  }, [setPendingCleanup])
  const { detail, loading: detailLoading } = useConversationDetail(CID, {
    enabled: shown,
  })
  const runtimeExternalId = useConversationRuntimeStore(
    (s) => s.byConversationId.get(CID)?.externalId ?? null
  )
  const externalId =
    runtimeExternalId ?? detail?.summary.external_id ?? undefined
  // A persisted, non-cline conversation: the gate is `detailLoading`.
  const awaitingHistoricalSessionId = detailLoading
  useConnectionLifecycle({
    contextKey: "tab-1",
    agentType: "claude_code",
    isActive: shown && !awaitingHistoricalSessionId,
    workingDir: "/repo",
    sessionId: externalId,
    conversationId: CID,
    preparing: shown && awaitingHistoricalSessionId,
  })
  return null
}

describe("a hidden tab's first show", () => {
  afterEach(() => {
    cleanup()
    act(() => resetConversationRuntimeStore())
    mockGet.mockReset()
    stubs.connect.mockClear()
  })

  it("auto-connects only once its stored session id has arrived", async () => {
    let land!: (detail: DbConversationDetail) => void
    mockGet.mockImplementation(
      () =>
        new Promise<DbConversationDetail>((resolveFetch) => {
          land = resolveFetch
        })
    )

    const { rerender } = render(<TabViewGate shown={false} />)
    await act(async () => {})
    expect(mockGet).not.toHaveBeenCalled()
    expect(stubs.connect).not.toHaveBeenCalled()

    await act(async () => {
      rerender(<TabViewGate shown />)
    })
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(stubs.connect).not.toHaveBeenCalled()

    await act(async () => {
      land({
        summary: { id: CID, external_id: STORED_SESSION },
        turns: [],
      } as unknown as DbConversationDetail)
    })
    expect(stubs.connect).toHaveBeenCalledTimes(1)
    expect(stubs.connect).toHaveBeenCalledWith(
      "claude_code",
      "/repo",
      STORED_SESSION,
      CID
    )
  })
})

describe("TabViewGate mirrors ConversationTabView", () => {
  const panel = readFileSync(
    resolve(
      process.cwd(),
      "src/components/conversations/conversation-detail-panel.tsx"
    ),
    "utf8"
  )

  it("creates the session on mount and gates the fetch on visibility", () => {
    expect(panel).toContain("setPendingCleanup(effectiveConversationId, false)")
    expect(panel).toContain(
      "useConversationDetail(effectiveConversationId, { enabled: isVisible })"
    )
    expect(panel).toContain("isVisible={visible}")
  })

  it("holds the auto-connect on detailLoading", () => {
    expect(panel).toMatch(
      /const awaitingHistoricalSessionId =\s+hasPersistedConversation && selectedAgent !== "cline" && detailLoading/
    )
    expect(panel).toContain("!awaitingHistoricalSessionId &&")
    expect(panel).toContain("isActive: isActive && canAutoConnect,")
  })
})
