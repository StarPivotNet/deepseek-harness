/**
 * Locate the staged app and write a helper that replaces files after this process exits.
 * @module @deepseek-ai/dsh-desktop/update-apply
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** How the next process should replace this install. */
export interface ApplyPlan {
  command: string
  args: string[]
  script: string
  scriptPath: string
}

/**
 * Walk up from the running binary to the enclosing `.app` bundle.
 *
 * @param execPath - `process.execPath`.
 * @returns the `.app` directory, or `undefined`.
 */
export function macAppBundle(execPath: string): string | undefined {
  let current = execPath
  for (let depth = 0; depth < 6; depth += 1) {
    if (current.endsWith('.app')) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

/**
 * Find `DeepSeekHarness.exe` in a Windows zip extraction.
 *
 * @param stagingDir - unzip destination.
 * @returns the exe path, or `undefined`.
 */
export function findStagedWindowsExe(stagingDir: string): string | undefined {
  const direct = join(stagingDir, 'DeepSeekHarness.exe')
  if (existsSync(direct)) return direct
  if (!existsSync(stagingDir)) return undefined
  for (const entry of readdirSync(stagingDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = join(stagingDir, entry.name, 'DeepSeekHarness.exe')
    if (existsSync(nested)) return nested
  }
  return undefined
}

/**
 * Find the `.app` bundle in a macOS zip extraction.
 *
 * @param stagingDir - unzip destination.
 * @returns the `.app` path, or `undefined`.
 */
export function findStagedMacApp(stagingDir: string): string | undefined {
  if (!existsSync(stagingDir)) return undefined
  for (const entry of readdirSync(stagingDir, { withFileTypes: true })) {
    if (entry.name.endsWith('.app') && (entry.isDirectory() || entry.isFile())) {
      return join(stagingDir, entry.name)
    }
    if (!entry.isDirectory()) continue
    const nestedDir = join(stagingDir, entry.name)
    for (const nested of readdirSync(nestedDir, { withFileTypes: true })) {
      if (nested.name.endsWith('.app') && (nested.isDirectory() || nested.isFile())) {
        return join(nestedDir, nested.name)
      }
    }
  }
  return undefined
}

/**
 * Windows helper: wait for PID, robocopy staged files over the running directory, relaunch.
 *
 * @param options - pid, staged app directory, running app directory, exe, helper path.
 * @returns spawn plan.
 */
export function planWindowsApply(options: {
  pid: number
  sourceDir: string
  destDir: string
  exePath: string
  scriptPath: string
}): ApplyPlan {
  const script = [
    '@echo off',
    'setlocal EnableExtensions',
    'set "PID=%~1"',
    'set "SRC=%~2"',
    'set "DST=%~3"',
    'set "EXE=%~4"',
    ':wait',
    'tasklist /FI "PID eq %PID%" | findstr /I /C:" %PID% " >nul',
    'if not errorlevel 1 (',
    '  ping -n 2 127.0.0.1 >nul',
    '  goto wait',
    ')',
    'robocopy "%SRC%" "%DST%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS',
    'if %ERRORLEVEL% GEQ 8 exit /b 1',
    'start "" "%EXE%"',
    '',
  ].join('\r\n')
  return {
    command: 'cmd.exe',
    args: ['/d', '/c', options.scriptPath, String(options.pid), options.sourceDir, options.destDir, options.exePath],
    script,
    scriptPath: options.scriptPath,
  }
}

/**
 * macOS helper: wait for PID, replace the `.app` bundle, open it.
 *
 * @param options - pid, staged `.app`, running `.app`, helper path.
 * @returns spawn plan.
 */
export function planMacApply(options: {
  pid: number
  sourceApp: string
  destApp: string
  scriptPath: string
}): ApplyPlan {
  const script = [
    '#!/bin/sh',
    'set -eu',
    'PID="$1"',
    'SRC="$2"',
    'DST="$3"',
    'while kill -0 "$PID" 2>/dev/null; do sleep 1; done',
    'rm -rf "$DST"',
    'mv "$SRC" "$DST"',
    'open "$DST"',
    '',
  ].join('\n')
  return {
    command: '/bin/sh',
    args: [options.scriptPath, String(options.pid), options.sourceApp, options.destApp],
    script,
    scriptPath: options.scriptPath,
  }
}

/**
 * Linux helper: wait for PID, replace the AppImage, exec it.
 *
 * @param options - pid, staged AppImage, running AppImage, helper path.
 * @returns spawn plan.
 */
export function planLinuxApply(options: {
  pid: number
  sourceFile: string
  destFile: string
  scriptPath: string
}): ApplyPlan {
  const script = [
    '#!/bin/sh',
    'set -eu',
    'PID="$1"',
    'SRC="$2"',
    'DST="$3"',
    'while kill -0 "$PID" 2>/dev/null; do sleep 1; done',
    'mv -f "$SRC" "$DST"',
    'chmod 755 "$DST"',
    'exec "$DST"',
    '',
  ].join('\n')
  return {
    command: '/bin/sh',
    args: [options.scriptPath, String(options.pid), options.sourceFile, options.destFile],
    script,
    scriptPath: options.scriptPath,
  }
}

/**
 * Build the platform helper for a staged install.
 *
 * @param options - platform, pid, staging, running paths, helper directory.
 * @returns spawn plan, or `undefined` when the staged tree is incomplete.
 */
export function planApply(options: {
  platform: NodeJS.Platform
  pid: number
  stagingDir: string
  execPath: string
  appImage?: string
  helperDir: string
}): ApplyPlan | undefined {
  if (options.platform === 'win32') {
    const exe = findStagedWindowsExe(options.stagingDir)
    if (exe === undefined) return undefined
    return planWindowsApply({
      pid: options.pid,
      sourceDir: dirname(exe),
      destDir: dirname(options.execPath),
      exePath: join(dirname(options.execPath), 'DeepSeekHarness.exe'),
      scriptPath: join(options.helperDir, 'apply.bat'),
    })
  }
  if (options.platform === 'darwin') {
    const dest = macAppBundle(options.execPath)
    const source = findStagedMacApp(options.stagingDir)
    if (dest === undefined || source === undefined) return undefined
    return planMacApply({
      pid: options.pid,
      sourceApp: source,
      destApp: dest,
      scriptPath: join(options.helperDir, 'apply.sh'),
    })
  }
  if (options.platform === 'linux') {
    const dest = options.appImage
    const source = join(options.stagingDir, 'DeepSeekHarness.AppImage')
    if (dest === undefined || dest === '' || !existsSync(source)) return undefined
    return planLinuxApply({
      pid: options.pid,
      sourceFile: source,
      destFile: dest,
      scriptPath: join(options.helperDir, 'apply.sh'),
    })
  }
  return undefined
}
