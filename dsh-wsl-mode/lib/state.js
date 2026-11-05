// dsh-wsl-mode — per-session switch state.
//
// One small JSON file under DSH_HOME holds the exceptions: a session that was
// explicitly switched off is stored as `false`, a session switched back on as
// `true`. Anything absent follows `enabledByDefault`, so WSL mode is ON out of
// the box and only deviations are on disk.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** DSH_HOME, or `~/.dsh` when the variable is absent. */
export function dshHomeDir(env = process.env) {
  const value = env.DSH_HOME
  return value !== undefined && value.trim().length > 0 ? value.trim() : join(homedir(), '.dsh')
}

/** Absolute path of the switch file. */
export function storePath(env = process.env) {
  return join(dshHomeDir(env), 'dsh-wsl-mode.json')
}

/** The stored shape, tolerant of a missing or damaged file. */
export function readState(env = process.env) {
  try {
    const data = JSON.parse(readFileSync(storePath(env), 'utf8'))
    if (data !== null && typeof data === 'object') {
      const sessions = data.sessions !== null && typeof data.sessions === 'object' ? data.sessions : {}
      return { sessions }
    }
  } catch {
    // absent or unparsable: no exceptions recorded yet
  }
  return { sessions: {} }
}

/** The session's mode: its own exception, else the deployment default. */
export function isOnFor(sessionKey, enabledByDefault = true, env = process.env) {
  const state = readState(env)
  const stored = state.sessions[sessionKey]
  return typeof stored === 'boolean' ? stored : enabledByDefault
}

/** Record one session's mode and return it. */
export function setModeFor(sessionKey, on, env = process.env) {
  const state = readState(env)
  const next = { ...state, sessions: { ...state.sessions, [sessionKey]: on === true } }
  const path = storePath(env)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
  return on === true
}

/**
 * The session identity used as the switch key. Sessions expose their id in a
 * few shapes across releases, so read them defensively; an agent without a
 * readable id shares the `default` bucket rather than failing the toggle.
 */
export function sessionKeyOf(agent) {
  const session = agent?.session
  const candidates = [session?.id, session?.header?.id, session?.header?.sessionId, agent?.sessionId]
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).length > 0) return String(candidate)
  }
  return 'default'
}
