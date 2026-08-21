import type { Context } from '@deepseek-ai/cordis'
import type { Drawing } from '../shared/index.ts'
import { validateImageResult } from '../shared/index.ts'

interface PendingResult {
  resolve: (value: Drawing.ImageResult) => void
  reject: (reason: Error) => void
}

type QueryResponse = { ok: true; value: Drawing.ImageResult } | { ok: false; error: string }

/** Browser-to-Host, session-scoped transport for automatically computed canvas metadata. */
export class ImageMetadataBridge {
  private readonly results = new Map<string, Drawing.ImageResult>()
  private readonly errors = new Map<string, Error>()
  private readonly pending = new Map<string, PendingResult>()

  publish(sessionId: string, callId: string, value: unknown): void {
    const key = this.key(sessionId, callId)
    const response = normalizeResponse(value)
    if (response.ok === false) {
      const error = new Error(response.error)
      this.errors.set(key, error)
      const pending = this.pending.get(key)
      if (pending !== undefined) {
        this.pending.delete(key)
        pending.reject(error)
      }
      return
    }
    const result = response.value
    this.results.set(key, result)
    const pending = this.pending.get(key)
    if (pending !== undefined) {
      this.pending.delete(key)
      pending.resolve(result)
    }
  }

  wait(sessionId: string, callId: string, signal: AbortSignal): Promise<Drawing.ImageResult> {
    const key = this.key(sessionId, callId)
    const cached = this.results.get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const error = this.errors.get(key)
    if (error !== undefined) return Promise.reject(error)
    if (signal.aborted) return Promise.reject(new Error('query_image was cancelled'))

    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(key)
        reject(new Error('query_image was cancelled'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(key, {
        resolve: (result) => {
          signal.removeEventListener('abort', abort)
          resolve(result)
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        },
      })
    })
  }

  private key(sessionId: string, callId: string): string {
    return `${sessionId}:${callId}`
  }
}

function normalizeResponse(value: unknown): QueryResponse {
  if (isQueryFailure(value)) return value
  if (isQuerySuccess(value)) return value
  const validation = validateImageResult(value)
  if (validation.isError) throw new Error(validation.msg)
  return { ok: true, value: value as Drawing.ImageResult }
}

function isQuerySuccess(value: unknown): value is { ok: true; value: Drawing.ImageResult } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return response.ok === true && !validateImageResult(response.value).isError
}

function isQueryFailure(value: unknown): value is { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return response.ok === false && typeof response.error === 'string'
}

function isPublishRequest(value: unknown): value is {
  sessionId: string
  callId: string
  result: QueryResponse | Drawing.ImageResult
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return (
    typeof request.sessionId === 'string' &&
    typeof request.callId === 'string' &&
    (isQuerySuccess(request.result) ||
      isQueryFailure(request.result) ||
      !validateImageResult(request.result).isError)
  )
}

export function installImageMetadataBridge(ctx: Context): ImageMetadataBridge {
  const bridge = new ImageMetadataBridge()
  ctx.connection.rpc.handle(
    '/drawing',
    async (endpoint, payload) => {
      if (endpoint !== 'image-metadata' || !isPublishRequest(payload)) {
        return {
          ok: false,
          error: {
            code: 'bad-request',
            message: 'invalid drawing metadata request',
            details: { issues: [] },
          },
        }
      }
      bridge.publish(payload.sessionId, payload.callId, payload.result)
      return { ok: true, value: { ok: true } }
    },
    { authority: 'trusted-host' },
  )
  return bridge
}
