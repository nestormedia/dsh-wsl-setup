// Unit tests: no harness packages, no WSL, no network — a fake Cordis context.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, INSTRUCTION, parseModeArg } from '../index.js'
import { isOnFor, readState, setModeFor } from '../lib/state.js'

let home
beforeEach(() => {
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = mkdtempSync(join(tmpdir(), 'dsh-wsl-mode-'))
  process.env.DSH_HOME = home
})

/** A minimal Cordis-shaped context that records what the plugin registers. */
function fakeContext() {
  const registered = { commands: [], sections: [], agents: [] }
  const listeners = new Map()
  const ctx = {
    on(event, callback) {
      listeners.set(event, callback)
      return () => listeners.delete(event)
    },
    inject(_deps, callback) {
      callback(ctx)
    },
    effect(fn) {
      fn()
      return () => {}
    },
    get(name) {
      if (name === 'commands') return ctx.commands
      return undefined
    },
    commands: {
      register(definition) {
        registered.commands.push(definition)
        return () => {}
      },
    },
    emit(event, payload) {
      return listeners.get(event)?.(payload)
    },
  }
  return { ctx, registered }
}

/** A fake agent whose systemPrompt service records section registrations. */
function fakeAgent(id) {
  const sections = []
  return {
    sections,
    agent: {
      session: { id },
      ctx: {
        get: (name) => (name === 'systemPrompt'
          ? {
            section(section) {
              sections.push(section)
              return () => {}
            },
          }
          : undefined),
        effect: (fn) => {
          fn()
          return () => {}
        },
      },
    },
  }
}

test('registers the /wsl command and defaults to ON', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, {})
  assert.equal(registered.commands.length, 1)
  const command = registered.commands[0]
  assert.equal(command.name, 'wsl')

  const { agent, sections } = fakeAgent('session-a')
  ctx.emit('agent/created', { agent, source: 'fresh' })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'dsh-wsl-mode')
  assert.equal(sections[0].text(), INSTRUCTION)

  const status = command.handler({ agent, rawInput: '' })
  assert.equal(status.kind, 'success')
  assert.match(status.text, /ON/)
})

test('/wsl off silences the section for that session only', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, {})
  const command = registered.commands[0]
  const first = fakeAgent('session-a')
  const second = fakeAgent('session-b')
  ctx.emit('agent/created', { agent: first.agent, source: 'fresh' })
  ctx.emit('agent/created', { agent: second.agent, source: 'fresh' })

  const off = command.handler({ agent: first.agent, rawInput: 'off' })
  assert.equal(off.kind, 'success')
  assert.match(off.text, /OFF/)

  assert.equal(first.sections[0].text(), '')
  assert.equal(second.sections[0].text(), INSTRUCTION)
})

test('/wsl on restores the section and survives a re-read', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, {})
  const command = registered.commands[0]
  const { agent, sections } = fakeAgent('session-c')
  ctx.emit('agent/created', { agent, source: 'fresh' })

  command.handler({ agent, rawInput: 'off' })
  assert.equal(isOnFor('session-c', true), false)
  command.handler({ agent, rawInput: 'on' })
  assert.equal(isOnFor('session-c', true), true)
  assert.equal(sections[0].text(), INSTRUCTION)
})

test('unknown argument is rejected without changing state', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, {})
  const command = registered.commands[0]
  const { agent } = fakeAgent('session-d')
  ctx.emit('agent/created', { agent, source: 'fresh' })

  const result = command.handler({ agent, rawInput: 'maybe' })
  assert.equal(result.kind, 'error')
  assert.equal(isOnFor('session-d', true), true)
})

test('enabledByDefault: false flips the default without touching stored sessions', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, { enabledByDefault: false })
  const command = registered.commands[0]
  const { agent, sections } = fakeAgent('session-e')
  ctx.emit('agent/created', { agent, source: 'fresh' })
  assert.equal(sections[0].text(), '')

  command.handler({ agent, rawInput: 'on' })
  assert.equal(sections[0].text(), INSTRUCTION)
})

test('state file keeps one entry per session', () => {
  setModeFor('session-x', false)
  setModeFor('session-y', true)
  const state = readState()
  assert.deepEqual(state.sessions, { 'session-x': false, 'session-y': true })
})

test('parseModeArg accepts the documented spellings', () => {
  assert.equal(parseModeArg('on'), true)
  assert.equal(parseModeArg(' OFF '), false)
  assert.equal(parseModeArg(''), undefined)
  assert.equal(parseModeArg('status'), undefined)
})
