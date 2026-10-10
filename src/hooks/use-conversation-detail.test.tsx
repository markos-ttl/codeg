import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import type { DbConversationDetail } from "@/lib/types"
import {
  resetConversationRuntimeStore,
  TAIL_TURNS_DEFAULT,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import { useConversationDetail } from "./use-conversation-detail"

// The runtime store calls the transport directly; the visibility-gating tests
// below assert on the call itself, so the transport is stubbed out.
vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
  getFolderConversationTurns: vi.fn(),
}))

const { getFolderConversation } = await import("@/lib/api")
const mockGet = vi.mocked(getFolderConversation)

const CID = 77

function seedSession(detail: DbConversationDetail | null) {
  useConversationRuntimeStore.setState({
    byConversationId: new Map([
      [
        CID,
        {
          conversationId: CID,
          externalId: null,
          dbConversationId: null,
          detail,
          detailLoading: false,
          detailError: null,
          acpLoadError: null,
          localTurns: [],
          backgroundTurns: [],
          pendingBackgroundSettlements: [],
          optimisticTurns: [],
          liveMessage: null,
          syncState: "idle",
          activeTurnToken: null,
          lastTurnOwned: false,
          liveOwnsActiveTurn: false,
          delegationKickoffText: null,
          sessionStats: null,
          historyAssistantBaseline: null,
          batchBoundaryIndex: null,
          batchBoundaryPrefixHash: null,
          loadingOlderTurns: false,
          olderTurnsPrependEpoch: 0,
          pendingOutOfTurnContent: false,
          pendingCleanup: false,
        },
      ],
    ]),
  })
}

const makeDetail = (): DbConversationDetail =>
  ({ summary: {}, turns: [] }) as unknown as DbConversationDetail

const liveMsg = (id: string): LiveMessage => ({
  id,
  role: "assistant",
  content: [],
  startedAt: 0,
})

// `useConversationDetail` is one of the two runtime-store subscriptions the
// keep-alive conversation panel (`ConversationTabView`) makes for its own
// session. The live-message sink replaces the session object on every streaming
// batch (~60/s via SET_LIVE_MESSAGE), so a whole-session subscription here would
// re-render the panel on every token. The hook now subscribes to a narrow
// `useShallow` slice — these tests exercise the REAL render path (not just the
// store invariant) to prove it is decoupled from streaming yet still reacts to a
// genuine detail change. `enabled: false` isolates the subscription from the
// auto-fetch effect.
describe("useConversationDetail streaming decoupling", () => {
  // Reset can fire a store update while the hook is still mounted (before RTL
  // cleanup); wrap it in act to avoid an "update not wrapped in act" warning.
  afterEach(() => act(() => resetConversationRuntimeStore()))

  it("does NOT re-render when a streaming batch replaces the session object", () => {
    seedSession(makeDetail())
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useConversationDetail(CID, { enabled: false })
    })
    const mounted = renders
    const first = result.current

    act(() => {
      useConversationRuntimeStore
        .getState()
        .actions.setLiveMessage(CID, liveMsg("m1"), true)
    })

    // A streaming batch replaced the session object but touched only
    // liveMessage; none of the sliced detail fields changed → no re-render.
    expect(renders).toBe(mounted)
    expect(result.current).toBe(first)
  })

  it("re-renders and surfaces the new detail when detail actually changes", () => {
    seedSession(null)
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useConversationDetail(CID, { enabled: false })
    })
    const mounted = renders
    expect(result.current.detail).toBeNull()

    // A real detail transition (fetch success, etc.) must re-render consumers.
    const nextDetail = makeDetail()
    act(() => seedSession(nextDetail))

    expect(renders).toBe(mounted + 1)
    expect(result.current.detail).toBe(nextDetail)
  })
})

// The workspace keeps every open tab's view MOUNTED (that is what preserves a
// background session's stream and scroll state), so the auto-fetch has to be
// gated on visibility rather than on mount. Restoring a workspace with N open
// tabs used to issue N concurrent detail fetches — each a tail window of up to
// TAIL_TURNS_DEFAULT turns, i.e. tens of MB across a large tab set — before the
// user had looked at a single one of them. A hidden view must therefore hold
// its fetch, and fire it on the render that flips it visible.
describe("useConversationDetail visibility gating", () => {
  afterEach(() => {
    act(() => resetConversationRuntimeStore())
    mockGet.mockReset()
  })

  it("holds the fetch while the view is off screen", () => {
    const { result } = renderHook(() =>
      useConversationDetail(CID, { enabled: false })
    )

    expect(mockGet).not.toHaveBeenCalled()
    expect(result.current.detail).toBeNull()
  })

  it("fetches the default tail window once the view becomes visible", () => {
    // Never resolves on purpose: this test is about WHEN the request is
    // issued, and a pending promise keeps the resolution-driven store write
    // (which would need its own act scope) out of the picture.
    mockGet.mockReturnValue(new Promise<DbConversationDetail>(() => {}))

    const { rerender } = renderHook(
      ({ visible }: { visible: boolean }) =>
        useConversationDetail(CID, { enabled: visible }),
      { initialProps: { visible: false } }
    )
    expect(mockGet).not.toHaveBeenCalled()

    act(() => {
      rerender({ visible: true })
    })

    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet).toHaveBeenCalledWith(CID, { tailTurns: TAIL_TURNS_DEFAULT })
  })
})
