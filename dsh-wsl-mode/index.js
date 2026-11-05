// dsh-wsl-mode — per-session WSL execution mode.
//
// The switch is a slash command (`/wsl on`, `/wsl off`) and the effect is a
// system-prompt section registered into each agent's own scope, so it applies
// to that session only and is re-evaluated on every prompt assembly: toggling
// needs no restart and no new turn.
//
// The plugin imports nothing from the harness: it only consumes the `commands`
// service and each agent's `systemPrompt` through the Cordis context, which
// keeps it installable in any profile and testable in plain Node.

import { isOnFor, setModeFor, sessionKeyOf, dshHomeDir } from './lib/state.js'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

function debug(line) {
  if (process.env.DSH_WSL_MODE_DEBUG !== '1') return
  try {
    appendFileSync(join(dshHomeDir(), 'dsh-wsl-mode.debug.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // diagnostics must never break activation
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'wsl-mode'

/** The command registry and the prompt registry are services: declare both. */
export const inject = ['commands', 'systemPrompt']

const SECTION_NAME = 'dsh-wsl-mode'
const COMMAND_NAME = 'wsl'

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

/**
 * Register the `/wsl` command on the agent-visible command registry.
 */
function registerCommand(commands, effect, cfg) {
  if (commands === undefined || typeof commands.register !== 'function') return false
  effect(() => commands.register({
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
  }), 'dsh-wsl-mode: /wsl command')
  return true
}

/**
 * Attach the prompt section to one agent. The section's text is a provider, so
 * the current switch value is read at every assembly instead of being frozen
 * when the session started.
 */
function attachSection(agent, cfg) {
  try {
    const ctx = agent?.ctx
    if (ctx === undefined) return
    const systemPrompt = ctx.get?.('systemPrompt')
    if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') {
      debug('agent: systemPrompt unavailable')
      return
    }
    const key = sessionKeyOf(agent)
    ctx.effect(() => systemPrompt.section({
      name: SECTION_NAME,
      order: cfg.order,
      interpolate: false,
      text: () => (isOnFor(key, cfg.enabledByDefault) ? INSTRUCTION : ''),
    }), 'dsh-wsl-mode: prompt section')
    debug(`agent ${key}: section attached`)
  } catch (error) {
    // A prompt section must never prevent a session from being created.
    console.error(`dsh-wsl-mode: section not attached: ${error?.message ?? error}`)
  }
}

export function apply(ctx, config = {}) {
  const cfg = {
    enabledByDefault: config.enabledByDefault !== false,
    order: Number.isFinite(config.order) ? config.order : 900,
  }

  const commands = ctx.get('commands')
  if (commands === undefined || typeof commands.register !== 'function') {
    throw new Error('dsh-wsl-mode: the commands service is unavailable, so /wsl cannot be registered')
  }
  registerCommand(commands, ctx.effect.bind(ctx), cfg)
  debug('command registered')

  // Each session gets its own prompt section, so the switch never leaks.
  ctx.on('agent/created', ({ agent }) => {
    attachSection(agent, cfg)
  })
}
