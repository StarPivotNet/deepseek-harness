/** Desktop release tag, artifact names, and Host staging helpers. */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  builderTarget,
  clampDesktopReleaseNotes,
  desktopElectronBuilderConfig,
  desktopReleaseNotes,
  desktopReleaseTag,
  desktopVersion,
  DESKTOP_RELEASE_NOTES_MAX_CHARS,
  expectedArtifacts,
  GITHUB_RELEASE_BODY_MAX_CHARS,
  parsePlatform,
  installedElectronVersion,
  pinStagedElectronVersion,
  pnpmBin,
  verifyDesktopTag,
} from './pack.ts'

describe('desktop release naming', () => {
  it('names the GitHub Release tag from the desktop package version', () => {
    expect(desktopReleaseTag('0.1.0-rc.5')).toBe('desktop-v0.1.0-rc.5')
    expect(desktopVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('reads the version from a desktop-shaped manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-manifest-'))
    const manifest = join(dir, 'package.json')
    writeFileSync(manifest, `${JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '1.2.3' })}\n`)
    expect(desktopVersion(manifest)).toBe('1.2.3')
  })

  it('pins the staged Electron version to the installed release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-electron-pin-'))
    const manifest = join(dir, 'package.json')
    writeFileSync(manifest, `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop',
      version: '0.1.3-alpha.2.4',
      devDependencies: { electron: '^44.0.0' },
    })}\n`)
    pinStagedElectronVersion(manifest)
    const pinned = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name: string
      version: string
      main: string
      dependencies?: unknown
      devDependencies?: unknown
    }
    expect(pinned).toMatchObject({
      name: 'dsh-desktop',
      version: '0.1.3-alpha.2.4',
      main: 'lib/main.js',
    })
    expect(pinned.dependencies).toBeUndefined()
    expect(pinned.devDependencies).toBeUndefined()
    expect(installedElectronVersion()).toBe('44.0.0')
  })

  it('writes a dependency-free staged manifest so Windows electron-builder skips pnpm list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-leaf-manifest-'))
    const manifest = join(dir, 'package.json')
    writeFileSync(manifest, `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop',
      version: '0.1.3-alpha.2.7',
      main: 'lib/main.js',
      dependencies: { 'electron-updater': '^6.8.9' },
      devDependencies: { electron: '^44.0.0' },
    })}\n`)
    pinStagedElectronVersion(manifest)
    const staged = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name: string
      dependencies?: unknown
      devDependencies?: unknown
    }
    expect(staged.name).toBe('dsh-desktop')
    expect(staged.dependencies).toBeUndefined()
    expect(staged.devDependencies).toBeUndefined()
  })

  it('rejects a missing or empty version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-bad-manifest-'))
    const manifest = join(dir, 'package.json')
    writeFileSync(manifest, '{}\n')
    expect(() => desktopVersion(manifest)).toThrow(/must declare a string version/)
  })

  it('accepts only the matching desktop-v tag when publishing', () => {
    verifyDesktopTag('0.1.0-rc.5', 'refs/tags/desktop-v0.1.0-rc.5')
    expect(() => verifyDesktopTag('0.1.0-rc.5', 'refs/heads/master')).toThrow(/publishing requires/)
    expect(() => verifyDesktopTag('0.1.0-rc.5', 'refs/tags/dsh-v0.1.0-rc.5')).toThrow(/desktop-v0\.1\.0-rc\.5/)
  })

  it('groups user-visible commits into Chinese product notes', () => {
    const notes = desktopReleaseNotes('0.1.2-rc.1', [
      'chore(desktop): 发布 0.1.2-rc.1',
      'feat(web): 内置插件目录源与插件市场',
      '将 StarPivot catalog.json 作为 Host 具名路由随 web profile 交付。',
      'feat(net): route every outbound request through the configured proxy',
      'fix(llm): expand model listing discovery',
      'test(llm): archive recorded provider model listings',
      'docs(http-proxy): state the shipped library, not the retired plugin',
      'release(dsh): 0.1.2-rc.1',
    ].join('\n'))
    expect(notes).toContain('DeepSeek Harness 桌面版 0.1.2-rc.1。')
    expect(notes).toContain('## 本版本更新')
    expect(notes).toContain('### 模型与凭据')
    expect(notes).toContain('### 网络与代理')
    expect(notes).toContain('### 会话与协作')
    expect(notes).toContain('- 内置插件目录源与插件市场')
    expect(notes).toContain('- 所有出站请求都走用户配置的代理策略')
    expect(notes).toContain('- 模型列表能识别更多网关字段和 Anthropic 原生目录')
    expect(notes).not.toContain('chore(desktop): 发布')
    expect(notes).not.toContain('test(llm):')
    expect(notes).not.toContain('docs(http-proxy):')
    expect(notes).not.toContain('release(dsh):')
    expect(notes).not.toContain('## Changes since the previous desktop release')
  })

  it('omits a feature that the same range later reverts', () => {
    const notes = desktopReleaseNotes('0.1.2-rc.1', [
      'Revert "feat(session, agent, web): support same-session message editing"',
      'feat(session, agent, web): support same-session message editing',
      'feat(net): route every outbound request through the configured proxy',
    ].join('\n'))
    expect(notes).toContain('所有出站请求都走用户配置的代理策略')
    expect(notes).not.toContain('支持在同一会话里编辑用户消息')
    expect(notes).not.toContain('message editing')
  })

  it('says so when the previous desktop tag has no later product commits', () => {
    expect(desktopReleaseNotes('0.1.0-rc.5.1', 'chore(desktop): 发布 0.1.0-rc.5.1\n')).toContain(
      '相对上一桌面标签，没有面向用户的产品改动。',
    )
  })

  it('keeps GitHub Release notes under the API body cap', () => {
    const huge = desktopReleaseNotes('0.1.2-alpha.1', `feat(web): ${'x'.repeat(DESKTOP_RELEASE_NOTES_MAX_CHARS + 50_000)}`)
    expect(huge.length).toBeLessThanOrEqual(GITHUB_RELEASE_BODY_MAX_CHARS)
    expect(huge).toContain('已截断：GitHub Release 正文上限为 125000 个字符。')
    expect(clampDesktopReleaseNotes('short').length).toBeLessThan(100)
  })
})

describe('desktop builder targets', () => {
  it('maps each platform to one electron-builder target', () => {
    expect(builderTarget('darwin')).toEqual({ flag: '--mac', target: 'zip' })
    expect(builderTarget('linux')).toEqual({ flag: '--linux', target: 'AppImage' })
    expect(builderTarget('win32')).toEqual({ flag: '--win', target: 'zip' })
  })

  it('names the artifacts the workflow uploads', () => {
    expect(expectedArtifacts('1.0.0', 'darwin')).toEqual(['DeepSeek Harness-1.0.0-mac.zip'])
    expect(expectedArtifacts('1.0.0', 'linux')).toEqual(['DeepSeek Harness-1.0.0.AppImage'])
    expect(expectedArtifacts('1.0.0', 'win32')).toEqual(['DeepSeek Harness-1.0.0-win.zip'])
  })

  it('defaults --platform to the host and rejects an unknown name', () => {
    expect(parsePlatform(undefined)).toBe(process.platform)
    expect(parsePlatform('linux')).toBe('linux')
    expect(() => parsePlatform('android')).toThrow(/--platform must be one of/)
  })

  it('spawns pnpm.cmd on Windows so pack does not look for pnpm.exe', () => {
    expect(pnpmBin()).toBe(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  })

  it('allows unused Electron signer patches when deploying the Host', () => {
    const source = readFileSync(join(import.meta.dirname, 'pack.ts'), 'utf8')
    expect(source).toContain('--config.allow-unused-patches=true')
  })

  it('writes Electron fuses into the GitHub packer electron-builder JSON', () => {
    const written = JSON.parse(JSON.stringify(desktopElectronBuilderConfig('1.0.0', 'darwin', '39.0.0'))) as {
      electronFuses: unknown
    }
    expect(written.electronFuses).toEqual({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    })
  })
})
