// dsh-wsl — per-session WSL mode.
//
// The switch is a slash command (`/wsl on`, `/wsl off`, `/wsl` for status) and
// the effect is a system-prompt section registered into each agent's own scope.
// Its text is a provider evaluated on every prompt assembly, so toggling takes
// effect on the next step — no restart, no new turn, and no effect on other
// sessions.
//
// State lives in a small JSON file under DSH_HOME: only deviations from the
// default are stored, so a fresh session is already in WSL mode.

import { readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Prompt section name contributed per agent. */
export const SECTION_NAME = 'dsh-wsl-session-mode'

/** Slash command name, without the leading slash. */
export const COMMAND_NAME = 'wsl'

/** The prompt text that turns a session into a WSL-first session. */
export const INSTRUCTION = [
  '## WSL execution mode',
  '',
  'This session runs shell work inside WSL (Windows Subsystem for Linux) on the same machine.',
  '',
  '- Run every shell command through the `wsl` tool. Do not use the local Windows shell tool unless the user explicitly asks for Windows.',
  '- Each `wsl` call is a fresh shell: no state (cwd, variables, functions) persists between calls. Combine steps into one command or use absolute paths.',
  '- Files are shared by both sides: file tools take Windows paths (`C:\\dir\\file`, `D:\\dir\\file`), while commands take the same location in WSL form (`/mnt/c/dir/file`, lowercase drive letter under `/mnt`).',
  '- Keep project work under `/mnt/<drive>/...`. Files under the WSL home (`/home/...`) are not reachable by the file tools.',
  '- Commands run unsandboxed inside the WSL VM. If a call is refused by the sandbox gate, say so instead of silently falling back to Windows.',
  '- If the `wsl` tool is unavailable in this session, report that instead of substituting the Windows shell.',
].join('\n')

/** Diagnostics: off unless DSH_WSL_DEBUG=1. */
export function debug(line) {
  if (process.env.DSH_WSL_DEBUG !== '1') return
  try {
    appendFileSync(join(dshHomeDir(), 'dsh-wsl.debug.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // diagnostics must never break activation
  }
}

/** DSH_HOME, or `~/.dsh` when the variable is absent. */
export function dshHomeDir(env = process.env) {
  const value = env.DSH_HOME
  return value !== undefined && value.trim().length > 0 ? value.trim() : join(homedir(), '.dsh')
}

/** Absolute path of the switch file. */
export function modeStorePath(env = process.env) {
  return join(dshHomeDir(env), 'dsh-wsl-session.json')
}

/** The stored shape, tolerant of a missing or damaged file. */
export function readModeState(env = process.env) {
  try {
    const data = JSON.parse(readFileSync(modeStorePath(env), 'utf8'))
    if (data !== null && typeof data === 'object') {
      return { sessions: data.sessions !== null && typeof data.sessions === 'object' ? data.sessions : {} }
    }
  } catch {
    // absent or unparsable: no exceptions recorded yet
  }
  return { sessions: {} }
}

/** The session's mode: its own exception, else the deployment default. */
export function isOnFor(sessionKey, enabledByDefault = true, env = process.env) {
  const stored = readModeState(env).sessions[sessionKey]
  return typeof stored === 'boolean' ? stored : enabledByDefault
}

/** Record one session's mode and return it. */
export function setModeFor(sessionKey, on, env = process.env) {
  const state = readModeState(env)
  const next = { ...state, sessions: { ...state.sessions, [sessionKey]: on === true } }
  const path = modeStorePath(env)
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

/** Parse the command argument: `on`, `off`, or undefined for a status read. */
export function parseModeArg(rawInput) {
  const value = String(rawInput ?? '').trim().toLowerCase()
  if (value === 'on' || value === 'enable' || value === 'true') return true
  if (value === 'off' || value === 'disable' || value === 'false') return false
  return undefined
}

/** Human-readable status line for the command result. */
export function statusText(on) {
  return on
    ? 'WSL mode is ON for this session: shell commands run in WSL through the `wsl` tool.'
    : 'WSL mode is OFF for this session: shell commands stay on Windows.'
}

function definition(cfg) {
  return {
    name: COMMAND_NAME,
    description: 'Turn WSL execution mode on or off for this session (/wsl on, /wsl off, /wsl for status).',
    handler: ({ agent, rawInput }) => {
      const key = sessionKeyOf(agent)
      const requested = parseModeArg(rawInput)
      if (requested === undefined && String(rawInput ?? '').trim().length > 0) {
        return { kind: 'error', text: 'Usage: /wsl on | /wsl off | /wsl (status)' }
      }
      if (requested === undefined) {
        return { kind: 'success', text: statusText(isOnFor(key, cfg.enabledByDefault)) }
      }
      setModeFor(key, requested)
      return { kind: 'success', text: statusText(requested) }
    },
  }
}

/** Attach the prompt section to one agent; never fails session creation. */
function attachSection(agent, cfg) {
  debug(`attach: entered (sessionMode=${cfg.sessionMode})`)
  if (cfg.sessionMode !== true) return
  try {
    const ctx = agent?.ctx
    if (ctx === undefined) {
      debug('attach: agent has no ctx')
      return
    }
    const key = sessionKeyOf(agent)
    debug(`attach: agent ${key}`)
    let systemPrompt
    try {
      systemPrompt = ctx.systemPrompt
    } catch (error) {
      debug(`attach: property access failed: ${error?.message ?? error}`)
    }
    if (systemPrompt === undefined) {
      try {
        systemPrompt = ctx.get?.('systemPrompt')
      } catch (error) {
        debug(`attach: get() failed: ${error?.message ?? error}`)
      }
    }
    if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') {
      debug(`attach: systemPrompt ${systemPrompt === undefined ? 'undefined' : typeof systemPrompt}`)
      return
    }
    ctx.effect(() => systemPrompt.section({
      name: SECTION_NAME,
      order: cfg.order,
      interpolate: false,
      text: () => (isOnFor(key, cfg.enabledByDefault) ? INSTRUCTION : ''),
    }), 'dsh-wsl: session mode section')
    debug(`attach: section attached to ${key}`)
  } catch (error) {
    const message = String(error?.message ?? error)
    debug(`attach: error ${message}`)
    if (!/already/i.test(message)) console.error(`dsh-wsl: session mode section: ${message}`)
  }
}

/**
 * Wire the session mode: the `/wsl` command and the per-agent prompt section.
 *
 * The command is registered once per registry instance (host and a preset
 * realm may both mount this package), and the section is skipped when the
 * same scope already carries one.
 */
export function registerMode(ctx, cfg) {
  debug(`registerMode: sessionMode=${cfg.sessionMode}`)
  if (cfg.sessionMode !== true) return

  const commands = ctx.get?.('commands')
  if (commands !== undefined && typeof commands.register === 'function') {
    const seen = (registerMode.registries ??= new WeakSet())
    if (!seen.has(commands)) {
      try {
        ctx.effect(() => commands.register(definition(cfg)), 'dsh-wsl: /wsl command')
        seen.add(commands)
        debug('mode: /wsl command registered')
      } catch (error) {
        const message = String(error?.message ?? error)
        if (/registered|duplicate|already/i.test(message)) {
          seen.add(commands)
          debug('mode: /wsl command already present')
        } else {
          console.error(`dsh-wsl: /wsl command: ${message}`)
        }
      }
    }
  } else {
    debug('mode: commands service unavailable')
  }

  ctx.on('agent/created', ({ agent }) => {
    attachSection(agent, cfg)
  })

  // A resumed session can exist before this row finishes activating, because
  // the row waits for several services. Catch those live sessions up instead of
  // leaving them without a section until the next restart.
  const agents = ctx.get?.('agents')
  debug(`mode: agents service ${agents === undefined ? 'absent' : 'present'}, live=${agents?.list?.().length ?? 'n/a'}`)
  if (agents !== undefined && typeof agents.list === 'function') {
    try {
      const live = agents.list()
      for (const agent of live) attachSection(agent, cfg)
      if (live.length > 0) debug(`mode: caught up ${live.length} live session(s)`)
    } catch (error) {
      debug(`mode: live sessions unavailable: ${error?.message ?? error}`)
    }
  }
}

