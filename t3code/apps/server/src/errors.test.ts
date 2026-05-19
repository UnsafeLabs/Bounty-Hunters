import { describe, it, expect } from 'vitest'
import { ServerError, errorToResponse, errorToLog } from './errors.ts'

describe('ServerError', () => {
  it('maps AuthError to 401', () => {
    const err = ServerError.AuthError({ message: "msg", timestamp: Date.now() })
    expect(errorToResponse(err).status).toBe(401)
  })

  it('maps ValidationError to 400', () => {
    const err = ServerError.ValidationError({ message: "msg", timestamp: Date.now() })
    expect(errorToResponse(err).status).toBe(400)
  })

  it('maps DatabaseError to 500', () => {
    const err = ServerError.DatabaseError({ message: "msg", timestamp: Date.now() })
    expect(errorToResponse(err).status).toBe(500)
  })

  it('maps NetworkError to 502', () => {
    const err = ServerError.NetworkError({ message: "msg", timestamp: Date.now() })
    expect(errorToResponse(err).status).toBe(502)
  })

  it('maps ConfigError to 500', () => {
    const err = ServerError.ConfigError({ message: "msg", timestamp: Date.now() })
    expect(errorToResponse(err).status).toBe(500)
  })

  it('maps GitError to 422', () => {
    const err = ServerError.GitError({ message: "msg", timestamp: Date.now() })
    expect(errorToResponse(err).status).toBe(422)
  })

  it('formats to log correctly', () => {
    const err = ServerError.AuthError({ message: "msg", timestamp: 1234 })
    const log = JSON.parse(errorToLog(err))
    expect(log.tag).toBe("AuthError")
    expect(log.message).toBe("msg")
    expect(log.timestamp).toBe(1234)
  })
})
