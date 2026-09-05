import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findStagedMacApp,
  findStagedWindowsExe,
  macAppBundle,
  planApply,
  planLinuxApply,
  planMacApply,
  planWindowsApply,
} from '../src/update-apply.ts'

describe('macAppBundle', () => {
  it('walks up from Contents/MacOS to the .app bundle', () => {
    const execPath = join('/Applications', 'DeepSeek Harness.app', 'Contents', 'MacOS', 'DeepSeekHarness')
    expect(macAppBundle(execPath)).toBe(join('/Applications', 'DeepSeek Harness.app'))
    expect(macAppBundle(join('/Applications', 'DeepSeek Harness.app'))).toBe(join('/Applications', 'DeepSeek Harness.app'))
    expect(macAppBundle(join('/usr', 'bin', 'electron'))).toBeUndefined()
    expect(macAppBundle(join('/a', 'b', 'c', 'd', 'e', 'f', 'g'))).toBeUndefined()
  })
})

describe('findStagedWindowsExe', () => {
  it('finds the exe at the zip root or one directory down', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-stage-win-'))
    expect(findStagedWindowsExe(dir)).toBeUndefined()
    expect(findStagedWindowsExe(join(dir, 'missing'))).toBeUndefined()
    writeFileSync(join(dir, 'notes.txt'), 'skip')
    expect(findStagedWindowsExe(dir)).toBeUndefined()
    writeFileSync(join(dir, 'DeepSeekHarness.exe'), 'exe')
    expect(findStagedWindowsExe(dir)).toBe(join(dir, 'DeepSeekHarness.exe'))
    const nested = mkdtempSync(join(tmpdir(), 'dsh-stage-win-nested-'))
    mkdirSync(join(nested, 'wrap'))
    writeFileSync(join(nested, 'wrap', 'DeepSeekHarness.exe'), 'exe')
    expect(findStagedWindowsExe(nested)).toBe(join(nested, 'wrap', 'DeepSeekHarness.exe'))
  })
})

describe('findStagedMacApp', () => {
  it('finds a .app at the zip root or one directory down', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-stage-mac-'))
    expect(findStagedMacApp(dir)).toBeUndefined()
    expect(findStagedMacApp(join(dir, 'missing'))).toBeUndefined()
    writeFileSync(join(dir, 'notes.txt'), 'skip')
    expect(findStagedMacApp(dir)).toBeUndefined()
    writeFileSync(join(dir, 'DeepSeek Harness.app'), 'file-bundle')
    expect(findStagedMacApp(dir)).toBe(join(dir, 'DeepSeek Harness.app'))
    const nested = mkdtempSync(join(tmpdir(), 'dsh-stage-mac-nested-'))
    mkdirSync(join(nested, 'wrap', 'DeepSeek Harness.app'), { recursive: true })
    expect(findStagedMacApp(nested)).toBe(join(nested, 'wrap', 'DeepSeek Harness.app'))
    const nestedFile = mkdtempSync(join(tmpdir(), 'dsh-stage-mac-file-'))
    mkdirSync(join(nestedFile, 'wrap'))
    writeFileSync(join(nestedFile, 'wrap', 'DeepSeek Harness.app'), 'file-bundle')
    expect(findStagedMacApp(nestedFile)).toBe(join(nestedFile, 'wrap', 'DeepSeek Harness.app'))
  })
})

describe('planApply', () => {
  it('writes a Windows robocopy helper', () => {
    const plan = planWindowsApply({
      pid: 9,
      sourceDir: 'C:\\src',
      destDir: 'C:\\dst',
      exePath: 'C:\\dst\\DeepSeekHarness.exe',
      scriptPath: 'C:\\helper\\apply.bat',
    })
    expect(plan.command).toBe('cmd.exe')
    expect(plan.args).toEqual(['/d', '/c', 'C:\\helper\\apply.bat', '9', 'C:\\src', 'C:\\dst', 'C:\\dst\\DeepSeekHarness.exe'])
    expect(plan.script).toContain('robocopy')
  })

  it('writes macOS and Linux helpers', () => {
    const mac = planMacApply({
      pid: 9,
      sourceApp: '/tmp/new.app',
      destApp: '/Applications/DeepSeek Harness.app',
      scriptPath: '/tmp/apply.sh',
    })
    expect(mac.command).toBe('/bin/sh')
    expect(mac.script).toContain('open "$DST"')
    const linux = planLinuxApply({
      pid: 9,
      sourceFile: '/tmp/new.AppImage',
      destFile: '/home/me/current.AppImage',
      scriptPath: '/tmp/apply.sh',
    })
    expect(linux.script).toContain('chmod 755')
  })

  it('returns undefined when the staged tree is incomplete', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-stage-empty-'))
    expect(planApply({
      platform: 'win32',
      pid: 1,
      stagingDir: empty,
      execPath: join(empty, 'DeepSeekHarness.exe'),
      helperDir: empty,
    })).toBeUndefined()
    expect(planApply({
      platform: 'linux',
      pid: 1,
      stagingDir: empty,
      execPath: '/usr/bin/DeepSeekHarness',
      helperDir: empty,
    })).toBeUndefined()
    expect(planApply({
      platform: 'linux',
      pid: 1,
      stagingDir: empty,
      execPath: '/usr/bin/DeepSeekHarness',
      appImage: '',
      helperDir: empty,
    })).toBeUndefined()
    expect(planApply({
      platform: 'darwin',
      pid: 1,
      stagingDir: empty,
      execPath: join(empty, 'DeepSeekHarness'),
      helperDir: empty,
    })).toBeUndefined()
    expect(planApply({
      platform: 'freebsd' as NodeJS.Platform,
      pid: 1,
      stagingDir: empty,
      execPath: join(empty, 'DeepSeekHarness'),
      helperDir: empty,
    })).toBeUndefined()
  })

  it('plans a Windows apply from a staged exe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-plan-win-'))
    const app = join(dir, 'app')
    const staging = join(dir, 'staging')
    mkdirSync(app)
    mkdirSync(staging)
    writeFileSync(join(app, 'DeepSeekHarness.exe'), 'old')
    writeFileSync(join(staging, 'DeepSeekHarness.exe'), 'new')
    const plan = planApply({
      platform: 'win32',
      pid: 3,
      stagingDir: staging,
      execPath: join(app, 'DeepSeekHarness.exe'),
      helperDir: dir,
    })
    expect(plan?.scriptPath).toBe(join(dir, 'apply.bat'))
    expect(plan?.args[4]).toBe(staging)
  })

  it('plans macOS and Linux apply from staged trees', () => {
    const macDir = mkdtempSync(join(tmpdir(), 'dsh-plan-mac-'))
    const destApp = join(macDir, 'DeepSeek Harness.app')
    mkdirSync(join(destApp, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(destApp, 'Contents', 'MacOS', 'DeepSeekHarness'), 'old')
    const macStaging = join(macDir, 'staging')
    mkdirSync(join(macStaging, 'DeepSeek Harness.app'), { recursive: true })
    const mac = planApply({
      platform: 'darwin',
      pid: 3,
      stagingDir: macStaging,
      execPath: join(destApp, 'Contents', 'MacOS', 'DeepSeekHarness'),
      helperDir: macDir,
    })
    expect(mac?.scriptPath).toBe(join(macDir, 'apply.sh'))
    expect(mac?.args[2]).toBe(join(macStaging, 'DeepSeek Harness.app'))
    expect(mac?.args[3]).toBe(destApp)

    const linuxDir = mkdtempSync(join(tmpdir(), 'dsh-plan-linux-'))
    const linuxStaging = join(linuxDir, 'staging')
    mkdirSync(linuxStaging)
    writeFileSync(join(linuxStaging, 'DeepSeekHarness.AppImage'), 'new')
    const destImage = join(linuxDir, 'current.AppImage')
    const linux = planApply({
      platform: 'linux',
      pid: 4,
      stagingDir: linuxStaging,
      execPath: join(linuxDir, 'DeepSeekHarness'),
      appImage: destImage,
      helperDir: linuxDir,
    })
    expect(linux?.scriptPath).toBe(join(linuxDir, 'apply.sh'))
    expect(linux?.args[2]).toBe(join(linuxStaging, 'DeepSeekHarness.AppImage'))
    expect(linux?.args[3]).toBe(destImage)
  })
})
