// dsh-wsl — persisted distro choice.
//
// 0.2.x replaced the namespace-based settings service with `SettingsForms`
// (keyed by profile entry id, no `register`/`get` namespace API), so the
// plugin keeps its single user preference in a small JSON file under DSH_HOME.
// The host half, the terminal backend and the preset executor all read the
// same file, which keeps the Web card's distro picker live without a restart.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** DSH_HOME, or `~/.dsh` when the variable is absent. */
export function dshHomeDir(env = process.env) {
  const value = env.DSH_HOME
  return value !== undefined && value.trim().length > 0 ? value.trim() : join(homedir(), '.dsh')
}

/** Absolute path of the preference file. */
export function distroStorePath(env = process.env) {
  return join(dshHomeDir(env), 'dsh-wsl.json')
}

/** The saved distro, or undefined when nothing usable is stored. */
export function readDistroChoice(env = process.env) {
  try {
    const data = JSON.parse(readFileSync(distroStorePath(env), 'utf8'))
    if (data !== null && typeof data === 'object'
      && typeof data.distro === 'string' && data.distro.trim().length > 0) {
      return data.distro.trim()
    }
  } catch {
    // missing or unparsable store: the row config stays the fallback
  }
  return undefined
}

/** Persist the distro choice atomically (write-then-rename). */
export function writeDistroChoice(distro, env = process.env) {
  const path = distroStorePath(env)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ distro: String(distro ?? '').trim() }, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}
