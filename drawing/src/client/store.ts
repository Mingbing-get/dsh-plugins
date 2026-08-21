import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

export type DrawingToolName =
  'create_image' | 'query_image' | 'edit_image' | 'undo_image' | 'redo_image'

export interface DrawingCall {
  id: string
  name: DrawingToolName
  argsRaw: string
  time: number
}

export interface DrawingWindowState {
  seenCallIds: readonly string[]
  hasImage: boolean
  open: boolean
  ownerCallId: string | null
}

type DrawingWindowActions = {
  syncCall: (draft: DrawingWindowState, call: Pick<DrawingCall, 'id' | 'name'>) => void
  reveal: (draft: DrawingWindowState) => void
  close: (draft: DrawingWindowState) => void
}

export type DrawingStore = EngineStoreHandle<DrawingWindowState, DrawingWindowActions>

export function createDrawingStore(): DrawingStore {
  return defineStore({
    init: (): DrawingWindowState => ({
      seenCallIds: [],
      hasImage: false,
      open: false,
      ownerCallId: null,
    }),
    actions: {
      syncCall(draft, call) {
        if (draft.seenCallIds.includes(call.id)) return
        draft.seenCallIds = [...draft.seenCallIds, call.id]
        if (call.name === 'create_image') draft.hasImage = true
        if (call.name !== 'query_image' && draft.hasImage) {
          draft.ownerCallId = call.id
          draft.open = true
        }
      },
      reveal(draft) {
        if (draft.hasImage) draft.open = true
      },
      close(draft) {
        draft.open = false
      },
    },
  })
}
