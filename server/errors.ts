import type { ProtocolError, ProtocolErrorCode, SocketAck } from "../shared/protocol"

export class GameServerError extends Error {
  readonly code: ProtocolErrorCode
  readonly retryable: boolean

  constructor(code: ProtocolErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "GameServerError"
    this.code = code
    this.retryable = retryable
  }
}

export function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof GameServerError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The game server could not complete that request",
    retryable: true,
  }
}

export function successAck<T>(data: T, serverTime = Date.now()): SocketAck<T> {
  return { ok: true, data, serverTime }
}

export function failureAck<T = never>(error: unknown, serverTime = Date.now()): SocketAck<T> {
  return { ok: false, error: toProtocolError(error), serverTime }
}
