"use client"

import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  sessionHoldsActiveTurns,
  useConversationRuntimeActions,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import type { DbConversationDetail } from "@/lib/types"

function isVirtualConversationId(conversationId: number): boolean {
  return !Number.isFinite(conversationId) || conversationId <= 0
}

export function useConversationDetail(
  conversationId: number,
  options?: {
    /**
     * Gate the built-in auto-fetch. Defaults to `true`. Pass `false` when the
     * caller drives fetching itself and must prevent a fetch from landing at
     * the wrong moment — e.g. the sub-agent session dialog, which must not load
     * the child's persisted detail while it is mid-stream (the parser surfaces
     * the in-progress turn as a normal turn, which would then duplicate the
     * live stream).
     *
     * Also pass `false` for a mounted-but-OFF-SCREEN view. The workspace keeps
     * every open tab mounted (that is what preserves a background session's
     * stream and scroll state), so an ungated hook fires one detail fetch per
     * open tab as soon as the tab set is restored — N concurrent
     * `get_folder_conversation` calls carrying tens of MB for a large tab set,
     * before the user has looked at any of them. Flipping `enabled` to `true`
     * (which is what a tab switch / group selection / tiling does) re-runs the
     * effect and fetches then.
     */
    enabled?: boolean
  }
): {
  detail: DbConversationDetail | null
  /**
   * True while the detail is being fetched — and ALSO on the render that is
   * about to start that fetch. The fetch is dispatched from an effect, i.e.
   * only after the render that decided it has committed, so without the second
   * half that render reads as "settled, nothing persisted": no detail, not
   * loading. A view kept mounted while hidden already has a runtime session
   * (its mount effects create one), so the render that first shows it is
   * exactly such a render — and the conversation panel's auto-connect gate,
   * which waits on `loading` for the stored session id, would let the connect
   * through with `sessionId: undefined` (backend `session/new`, history
   * orphaned on the next prompt).
   */
  loading: boolean
  error: string | null
  acpLoadError: string | null
} {
  const enabled = options?.enabled ?? true
  // Subscribe to ONLY the detail-related fields this hook exposes, not the whole
  // session object. The live-message sink replaces the session object on every
  // streaming batch (~60/s, via SET_LIVE_MESSAGE); a whole-session selector here
  // would re-render every consumer — notably the keep-alive conversation panel,
  // which calls this hook — on each streaming token. None of these fields change
  // mid-stream, so `useShallow` keeps the slice reference-stable across batches
  // and consumers re-render only on a real detail transition. (`hasSession`
  // preserves the "session exists yet?" signal the loading state depends on.)
  const {
    detail,
    detailLoading,
    detailError,
    acpLoadError,
    hasSession,
    needsFetch,
  } = useConversationRuntimeStore(
    useShallow((s) => {
      const session = s.byConversationId.get(conversationId)
      return {
        detail: session?.detail ?? null,
        detailLoading: session?.detailLoading ?? false,
        detailError: session?.detailError ?? null,
        acpLoadError: session?.acpLoadError ?? null,
        hasSession: session != null,
        // `fetchDetail`'s own admission rule, folded to one boolean: nothing
        // loaded, nothing in flight, no ongoing turn holding the session. A
        // streaming batch can't flip it — once a stream is under way (or a
        // detail exists) it is already false — so the slice stays stable.
        needsFetch:
          session == null ||
          (session.detail == null &&
            !session.detailLoading &&
            !sessionHoldsActiveTurns(session)),
      }
    })
  )
  const { fetchDetail } = useConversationRuntimeActions()
  const isVirtual = isVirtualConversationId(conversationId)
  const fetchPending = enabled && !isVirtual && needsFetch

  useEffect(() => {
    if (!fetchPending) return
    fetchDetail(conversationId)
  }, [fetchPending, conversationId, fetchDetail])

  return {
    detail,
    loading: hasSession ? detailLoading || fetchPending : !isVirtual,
    error: detailError,
    acpLoadError,
  }
}
