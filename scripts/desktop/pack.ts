/**
 * Stage a packaged desktop runtime and run electron-builder for one platform.
 * The window stays an Electron shell; resources carry the Desktop-managed
 * `runtime/` (Node + pnpm) and `dsh/` (Host package set) prepared by
 * `apps/desktop` `package:<target> -- --prepare-only`
 * ([rationale](../../.agents/notes/implemented/process/2026-08-17-desktop-github-release.md)).
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry } from '../release/process.ts'

const root = resolve(import.meta.dirname, '../..')
const desktopRoot = join(root, 'apps', 'desktop')
const stagingRoot = join(root, 'dist-desktop', 'staging')
const appRoot = join(stagingRoot, 'app')
const outDir = join(root, 'dist-desktop', 'release')
const desktopBuildTargets = join(desktopRoot, '.desktop-build', 'targets')

/** electron-builder pin used by both local and CI packaging. */
export const ELECTRON_BUILDER_SPEC = 'electron-builder@26.15.3'

/** Platforms this script can package. */
export const DESKTOP_PLATFORMS = ['darwin', 'linux', 'win32'] as const

/** One supported electron-builder target. */
export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number]

/**
 * Read the desktop package version that names the GitHub Release tag.
 * @param manifestPath - desktop `package.json`.
 * @returns the version string.
 */
export function desktopVersion(manifestPath: string = join(desktopRoot, 'package.json')): string {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`desktop pack: ${manifestPath} is not a JSON object`)
  }
  const version = (parsed as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') {
    throw new Error(`desktop pack: ${manifestPath} must declare a string version`)
  }
  return version
}

/**
 * Tag a desktop GitHub Release publishes from.
 * @param version - desktop package version.
 * @returns `desktop-v<version>`.
 */
export function desktopReleaseTag(version: string): string {
  return `desktop-v${version}`
}

/**
 * electron-builder target triple for one platform.
 * @param platform - Node platform of the runner that owns the Node binary.
 * @returns the `--mac` / `--linux` / `--win` argument plus its target.
 */
export function builderTarget(platform: DesktopPlatform): { flag: '--mac' | '--linux' | '--win'; target: string } {
  switch (platform) {
    case 'darwin':
      return { flag: '--mac', target: 'zip' }
    case 'linux':
      return { flag: '--linux', target: 'AppImage' }
    case 'win32':
      return { flag: '--win', target: 'zip' }
    default: {
      const exhaustive: never = platform
      throw new Error(`desktop pack: unsupported platform ${String(exhaustive)}`)
    }
  }
}

/**
 * Artifact names electron-builder writes for one version and platform.
 * @param version - desktop package version.
 * @param platform - packaged platform.
 * @returns expected filenames under `dist-desktop/release`.
 */
export function expectedArtifacts(version: string, platform: DesktopPlatform): readonly string[] {
  switch (platform) {
    case 'darwin':
      return [`DeepSeek Harness-${version}-mac.zip`]
    case 'linux':
      return [`DeepSeek Harness-${version}.AppImage`]
    case 'win32':
      return [`DeepSeek Harness-${version}-win.zip`]
    default: {
      const exhaustive: never = platform
      throw new Error(`desktop pack: unsupported platform ${String(exhaustive)}`)
    }
  }
}

/**
 * Assert the workflow runs from the desktop tag that names this version.
 * @param version - desktop package version.
 * @param ref - `GITHUB_REF`.
 */
export function verifyDesktopTag(version: string, ref: string): void {
  const expected = `refs/tags/${desktopReleaseTag(version)}`
  if (ref !== expected) {
    throw new Error(`desktop pack: publishing requires ${expected}, got ${ref || '(no ref)'}`)
  }
}

/** GitHub rejects a Release body longer than this many characters. */
export const GITHUB_RELEASE_BODY_MAX_CHARS = 125_000

/** Leave a buffer under GitHub's body cap for the truncation notice. */
export const DESKTOP_RELEASE_NOTES_MAX_CHARS = 120_000

/** One product-facing changelog group in the published Release body. */
type DesktopReleaseSectionId =
  | 'desktop'
  | 'models'
  | 'network'
  | 'sessions'
  | 'host'
  | 'other'

/** Display order and Chinese headings for the published changelog. */
const DESKTOP_RELEASE_SECTIONS: readonly { id: DesktopReleaseSectionId; heading: string }[] = [
  { id: 'desktop', heading: '桌面与安装' },
  { id: 'models', heading: '模型与凭据' },
  { id: 'network', heading: '网络与代理' },
  { id: 'sessions', heading: '会话与协作' },
  { id: 'host', heading: 'Host 与运行时' },
  { id: 'other', heading: '其他' },
]

/**
 * Conventional-commit scopes that belong to one published heading.
 * Unlisted scopes fall through to `other` unless the subject is dropped.
 */
const DESKTOP_RELEASE_SCOPE_SECTIONS: Readonly<Record<string, DesktopReleaseSectionId>> = {
  desktop: 'desktop',
  electron: 'desktop',
  installer: 'desktop',
  pack: 'desktop',
  llm: 'models',
  'llm-pi-ai': 'models',
  'llm-deepseek': 'models',
  models: 'models',
  credentials: 'models',
  'http-proxy': 'network',
  net: 'network',
  proxy: 'network',
  webworker: 'network',
  session: 'sessions',
  agent: 'sessions',
  web: 'sessions',
  'agent-loop': 'sessions',
  'agent-team': 'sessions',
  'session-control': 'sessions',
  python: 'host',
  'app-boot': 'host',
  runtime: 'host',
  cli: 'host',
}

/**
 * Keep GitHub Release notes under the API body cap.
 * @param notes - assembled markdown.
 * @returns notes, truncated at a line boundary when over the cap.
 */
export function clampDesktopReleaseNotes(notes: string): string {
  if (notes.length <= DESKTOP_RELEASE_NOTES_MAX_CHARS) return notes
  const notice = '\n\n……已截断：GitHub Release 正文上限为 125000 个字符。\n'
  const budget = DESKTOP_RELEASE_NOTES_MAX_CHARS - notice.length
  let cut = notes.slice(0, budget)
  const lastNl = cut.lastIndexOf('\n')
  if (lastNl > Math.floor(budget / 2)) cut = cut.slice(0, lastNl)
  const clamped = `${cut}${notice}`
  return clamped.length <= GITHUB_RELEASE_BODY_MAX_CHARS
    ? clamped
    : clamped.slice(0, GITHUB_RELEASE_BODY_MAX_CHARS)
}

/** Parsed conventional-commit subject used by the published notes. */
interface ParsedDesktopSubject {
  readonly type: string
  readonly scope: string | undefined
  readonly rest: string
  readonly reverted: boolean
}

/**
 * Split a conventional-commit subject into type, optional scope, and rest.
 * A GitHub-style `Revert "type(scope): rest"` line is the inner commit with
 * `reverted: true`, so later grouping can drop a change that did not ship.
 * @param subject - one git log `%s` line.
 * @returns parsed fields, or `undefined` when the line is not conventional.
 */
function parseConventionalSubject(subject: string): ParsedDesktopSubject | undefined {
  const reverted = /^Revert\s+"/u.test(subject)
  const inner = reverted ? subject.replace(/^Revert\s+"/u, '').replace(/"$/u, '') : subject
  const match = /^([a-z]+)(?:\(([^)]+)\))?!?:\s+(.+)$/iu.exec(inner)
  if (match === null) return undefined
  const type = match[1]
  const rest = match[3]
  if (type === undefined || rest === undefined) return undefined
  return { type: type.toLowerCase(), scope: match[2], rest, reverted }
}

/**
 * Subjects that are packaging noise, not a user-visible product change.
 * @param subject - one git log `%s` line.
 * @returns whether the line stays out of the published notes.
 */
export function isDesktopReleaseInternalSubject(subject: string): boolean {
  const parsed = parseConventionalSubject(subject)
  if (parsed === undefined) return /^(?:ci|chore|test|docs|perf|style|refactor)\b/iu.test(subject)
  if (parsed.type === 'release' || parsed.type === 'revert') return true
  if (parsed.reverted) return true
  if (parsed.type === 'chore') return true
  if (parsed.type === 'refactor') return true
  if (parsed.scope === 'session-telemetry-otel') return true
  if (/\b(?:match|follow) the (?:workspace )?version\b/iu.test(parsed.rest)) return true
  if (/\bsettle what the master merge broke\b/iu.test(parsed.rest)) return true
  if (/\baddress (?:model discovery )?review\b/iu.test(parsed.rest)) return true
  return parsed.type === 'ci' || parsed.type === 'test' || parsed.type === 'docs'
    || parsed.type === 'perf' || parsed.type === 'style'
}

/**
 * Known English remainders rewritten as a complete Chinese product sentence.
 * Unlisted remainders keep a typed Chinese prefix and the original rest.
 */
const DESKTOP_RELEASE_ENGLISH_BULLETS: Readonly<Record<string, string>> = {
  'expand model listing discovery': '模型列表能识别更多网关字段和 Anthropic 原生目录',
  'scope Anthropic /v1 handling to model discovery': 'Anthropic 模型发现改走原生 /v1/models，不再误用 Chat Completions 路径',
  'route every outbound request through the configured proxy': '所有出站请求都走用户配置的代理策略',
  'withhold NODE_USE_ENV_PROXY when the child receives a refused proxy value': '子进程拿到被拒绝的代理值时，不再强制启用 NODE_USE_ENV_PROXY',
  'give children the user\'s environment under a layered direct policy': '直连策略下，子进程仍继承用户环境而不是空环境',
  'keep this machine off the proxy, and refuse a literal the checks reject': '本机直连策略会拒绝检查不接受的代理字面量',
  'route by the policy, and give a child the routing its parent has': '子进程沿用父进程的代理路由策略',
  'register a node:https placeholder for the proxy agent factory': 'WebWorker 里补上 node:https 占位，代理工厂可以加载',
  'stop the packaged runtime from hijacking spawned node commands': '打包运行时不再劫持子进程里的 node 命令',
  'accept the proxy names from the Harness-home .env alone': 'Harness 主目录 .env 里的代理变量名足以生效',
  'complete policy token guards': 'Issue 策略补齐 Project 令牌权限检查',
  'grant policy Project read access': 'Issue 策略可以读取 GitHub Project',
  'use Project-local Priority': 'Issue 优先级改用 Project 本地字段',
  'support same-session message editing': '支持在同一会话里编辑用户消息',
  'keep gzip on the fetch transport': '遥测 fetch 传输继续使用 gzip',
}

/**
 * One published bullet: keep a Chinese subject, otherwise a short Chinese
 * paraphrase of the conventional type and remainder.
 * @param subject - one git log `%s` line.
 * @returns a bullet without the leading `- `.
 */
export function desktopReleaseBullet(subject: string): string {
  const parsed = parseConventionalSubject(subject)
  const body = (parsed?.rest ?? subject).replace(/[.。]+$/u, '')
  if (/[\u4e00-\u9fff]/u.test(body)) return body
  const known = DESKTOP_RELEASE_ENGLISH_BULLETS[body]
  if (known !== undefined) return known
  const typeLabel: Record<string, string> = {
    feat: '新增',
    fix: '修复',
    revert: '撤回',
    refactor: '整理',
    chore: '维护',
  }
  const prefix = parsed === undefined ? '更新' : (typeLabel[parsed.type] ?? '更新')
  return `${prefix}：${body}`
}

/**
 * Choose the published heading for one remaining subject.
 * @param subject - one git log `%s` line already known to be product-facing.
 * @returns the section that should list it.
 */
function desktopReleaseSection(subject: string): DesktopReleaseSectionId {
  const parsed = parseConventionalSubject(subject)
  if (parsed?.scope !== undefined) {
    const mapped = DESKTOP_RELEASE_SCOPE_SECTIONS[parsed.scope]
    if (mapped !== undefined) return mapped
  }
  if (/\b(?:proxy|http-proxy|NODE_USE_ENV_PROXY)\b/iu.test(subject)) return 'network'
  if (/\b(?:model|llm|anthropic|listing)\b/iu.test(subject)) return 'models'
  if (/\b(?:session|message edit|agent team)\b/iu.test(subject)) return 'sessions'
  if (/\b(?:python|pkg |runtime|app-boot)\b/iu.test(subject)) return 'host'
  return 'other'
}

/**
 * GitHub Release notes for one desktop tag: Chinese product copy, grouped
 * user-visible changes since the previous `desktop-v*` tag.
 * @param version - desktop package version being published.
 * @param gitLog - raw `git log` lines, already formatted as subjects or `subject\n\nbody`.
 * @returns markdown notes, never longer than GitHub's Release body cap.
 */
export function desktopReleaseNotes(version: string, gitLog: string): string {
  const intro = [
    `DeepSeek Harness 桌面版 ${version}。每个归档都带 Electron 窗口、随包 Node 24，以及本仓库构建的 @deepseek-ai/dsh Host。`,
    '',
    '下载 macOS zip、Linux AppImage 或 Windows zip，解压后直接打开。首次启动可能被系统拦截，因为当前发布尚未代码签名。',
    '',
    '## 本版本更新',
    '',
  ]
  const lines = gitLog.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0)
  const revertedKeys = new Set(
    lines.map(parseConventionalSubject)
      .filter((parsed): parsed is ParsedDesktopSubject => parsed !== undefined && parsed.reverted)
      .map(parsed => `${parsed.type}\0${parsed.scope ?? ''}\0${parsed.rest}`),
  )
  const subjects = lines.filter((line) => {
    if (isDesktopReleaseInternalSubject(line)) return false
    const parsed = parseConventionalSubject(line)
    if (parsed === undefined) return true
    return !revertedKeys.has(`${parsed.type}\0${parsed.scope ?? ''}\0${parsed.rest}`)
  })
  const unique: string[] = []
  const seen = new Set<string>()
  for (const subject of subjects) {
    const bullet = desktopReleaseBullet(subject)
    if (seen.has(bullet)) continue
    seen.add(bullet)
    unique.push(subject)
  }
  if (unique.length === 0) {
    return clampDesktopReleaseNotes([...intro, '相对上一桌面标签，没有面向用户的产品改动。', ''].join('\n'))
  }
  const grouped = new Map<DesktopReleaseSectionId, string[]>()
  for (const subject of unique) {
    const id = desktopReleaseSection(subject)
    const bullets = grouped.get(id) ?? []
    bullets.push(`- ${desktopReleaseBullet(subject)}`)
    grouped.set(id, bullets)
  }
  const sections: string[] = []
  for (const section of DESKTOP_RELEASE_SECTIONS) {
    const bullets = grouped.get(section.id)
    if (bullets === undefined || bullets.length === 0) continue
    sections.push(`### ${section.heading}`, '', ...bullets, '')
  }
  return clampDesktopReleaseNotes([...intro, ...sections].join('\n'))
}

/**
 * Parse one platform name from `--platform`.
 * @param value - raw CLI value.
 * @returns the platform.
 */
export function parsePlatform(value: string | undefined): DesktopPlatform {
  if (value === undefined) {
    if (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32') {
      return process.platform
    }
    throw new Error(`desktop pack: unsupported host platform ${process.platform}; pass --platform`)
  }
  if (value === 'darwin' || value === 'linux' || value === 'win32') return value
  throw new Error(`desktop pack: --platform must be one of ${DESKTOP_PLATFORMS.join(', ')}`)
}

/**
 * Run a command with inherited streams and fail on a non-zero exit.
 * @param command - executable.
 * @param args - arguments.
 * @param cwd - working directory.
 * @param environment - extra variables layered over the packer environment.
 */
function run(command: string, args: readonly string[], cwd: string = root, environment: Record<string, string> = {}): void {
  const result = spawnSync(command, [...args], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', ...environment },
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`desktop pack: ${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/**
 * pnpm executable the packer can spawn.
 * Windows GitHub runners put `pnpm.cmd` on PATH; `spawnSync('pnpm')` without a
 * shell looks for `pnpm.exe` and fails with ENOENT.
 * @returns `pnpm.cmd` on Windows, otherwise `pnpm`.
 */
export function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/** Prepared resource directories the packaged app loads at runtime. */
interface PreparedDesktopRuntime {
  readonly runtime: string
  readonly dsh: string
}

/**
 * Map a packaging platform to the `apps/desktop` prepare target that owns its runtime tree.
 * @param platform - packaged platform.
 * @returns the `package:<name>` target name.
 */
function prepareTargetName(platform: DesktopPlatform): 'mac-arm64' | 'win-x64' | 'linux-x64' {
  switch (platform) {
    case 'darwin': return 'mac-arm64'
    case 'win32': return 'win-x64'
    case 'linux': return 'linux-x64'
    default: {
      const exhaustive: never = platform
      throw new Error(`desktop pack: unsupported platform ${String(exhaustive)}`)
    }
  }
}

/**
 * Run the `apps/desktop` preparation chain into `.desktop-build/targets/<target>`
 * and return the resource roots electron-builder must ship.
 * @param platform - packaged platform.
 * @returns verified `runtime/` and `dsh/` roots.
 */
function prepareDesktopRuntime(platform: DesktopPlatform): PreparedDesktopRuntime {
  const target = prepareTargetName(platform)
  // Fork releases publish without Apple credentials; the enclosing unsigned
  // app is the trust root and native files keep linker ad-hoc signatures.
  // `run` (not `exec`) keeps npm_execpath set to pnpm for the prepare chain's
  // nested package commands; pnpm 11 passes unknown boolean flags through.
  run(pnpmBin(), [
    '--filter',
    '@deepseek-ai/dsh-desktop',
    'run',
    `package:${target}`,
    '--prepare-only',
  ], root, { DSH_DESKTOP_UNSIGNED_RUNTIME: '1' })
  const targetRoot = join(desktopBuildTargets, target)
  const runtime = join(targetRoot, 'runtime')
  const dsh = join(targetRoot, 'dsh')
  const nodeEntry = join(runtime, 'node', platform === 'win32' ? 'node.exe' : 'node')
  for (const [label, path] of [['runtime node', nodeEntry], ['runtime pnpm', join(runtime, 'pnpm', 'bin', 'pnpm.mjs')], ['dsh node_modules', join(dsh, 'node_modules')]] as const) {
    if (!existsSync(path)) throw new Error(`desktop pack: prepared ${label} is missing at ${path}`)
  }
  return { runtime, dsh }
}

/**
 * Adopt the previous prepare output for a local re-pack without rebuilding.
 * @param platform - packaged platform.
 * @returns verified `runtime/` and `dsh/` roots.
 */
function reusePreparedRuntime(platform: DesktopPlatform): PreparedDesktopRuntime {
  const target = prepareTargetName(platform)
  const targetRoot = join(desktopBuildTargets, target)
  const runtime = join(targetRoot, 'runtime')
  const dsh = join(targetRoot, 'dsh')
  const nodeEntry = join(runtime, 'node', platform === 'win32' ? 'node.exe' : 'node')
  for (const [label, path] of [['runtime node', nodeEntry], ['runtime pnpm', join(runtime, 'pnpm', 'bin', 'pnpm.mjs')], ['dsh node_modules', join(dsh, 'node_modules')]] as const) {
    if (!existsSync(path)) {
      throw new Error(`desktop pack: --skip-build needs a prepared ${label} at ${path}; run without --skip-build`)
    }
  }
  return { runtime, dsh }
}

/**
 * Write the electron-builder config that ships the prepared runtime resources.
 * @param version - desktop package version.
 * @param platform - packaged platform.
 * @param prepared - verified resource roots from the prepare chain.
 * @returns the config path.
 */
function writeBuilderConfig(version: string, platform: DesktopPlatform, prepared: PreparedDesktopRuntime): string {
  mkdirSync(stagingRoot, { recursive: true })
  const configPath = join(stagingRoot, 'electron-builder.json')
  const config = {
    appId: 'ai.deepseek.dsh.desktop',
    productName: 'DeepSeek Harness',
    copyright: 'Copyright © DeepSeek',
    directories: {
      app: appRoot,
      output: outDir,
    },
    extraMetadata: {
      name: 'dsh-desktop',
      version,
    },
    electronVersion: installedElectronVersion(),
    nodeGypRebuild: false,
    npmRebuild: false,
    executableName: 'DeepSeekHarness',
    files: [
      'lib/**/*',
      'renderer/**/*',
      'assets/**/*',
      'package.json',
    ],
    extraResources: [
      { from: prepared.runtime, to: 'runtime' },
      { from: prepared.dsh, to: 'dsh' },
      // electron-builder drops a source directory's root node_modules; stage it explicitly.
      { from: join(prepared.dsh, 'node_modules'), to: 'dsh/node_modules' },
    ],
    asar: true,
    artifactName: platform === 'darwin'
      ? 'DeepSeek Harness-${version}-mac.${ext}'
      : platform === 'win32'
        ? 'DeepSeek Harness-${version}-win.${ext}'
        : 'DeepSeek Harness-${version}.${ext}',
    mac: {
      category: 'public.app-category.developer-tools',
      icon: join(desktopRoot, 'assets', 'icon-512.png'),
      identity: null,
      target: ['zip'],
    },
    linux: {
      category: 'Development',
      executableName: 'DeepSeekHarness',
      icon: join(desktopRoot, 'assets', 'icon-512.png'),
      target: ['AppImage'],
    },
    win: {
      icon: join(desktopRoot, 'assets', 'icon.ico'),
      target: ['zip'],
    },
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return configPath
}

/**
 * Read the Electron release installed next to the desktop package.
 * @returns the exact version string electron-builder should download.
 */
export function installedElectronVersion(): string {
  const installedPath = join(desktopRoot, 'node_modules', 'electron', 'package.json')
  if (!existsSync(installedPath)) {
    throw new Error('desktop pack: apps/desktop/node_modules/electron is missing; run pnpm install')
  }
  const installed = JSON.parse(readFileSync(installedPath, 'utf8')) as { version?: unknown }
  if (typeof installed.version !== 'string' || installed.version === '') {
    throw new Error('desktop pack: installed electron has no version')
  }
  return installed.version
}

/**
 * Write a dependency-free staged desktop manifest. The bundle inlines every
 * runtime dependency; electron-builder must not scan pnpm workspaces from this leaf.
 * @param manifestPath - staged `apps/desktop` package.json copy.
 */
export function pinStagedElectronVersion(manifestPath: string): void {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  writeFileSync(manifestPath, `${JSON.stringify({
    name: 'dsh-desktop',
    description: typeof manifest.description === 'string' ? manifest.description : 'DeepSeek Harness desktop',
    version: typeof manifest.version === 'string' ? manifest.version : desktopVersion(),
    private: true,
    license: typeof manifest.license === 'string' ? manifest.license : 'MIT',
    type: 'module',
    main: typeof manifest.main === 'string' ? manifest.main : 'lib/main.js',
  }, null, 2)}\n`)
}

/**
 * Copy the compiled desktop shell into a leaf app directory electron-builder
 * can treat as the application root without walking the workspace.
 */
function stageApp(): void {
  run(pnpmBin(), ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'build'])
  const compiled = join(desktopRoot, 'lib', 'main.js')
  if (!existsSync(compiled)) {
    throw new Error('desktop pack: apps/desktop/lib/main.js is missing after the desktop build')
  }
  rmSync(appRoot, { recursive: true, force: true })
  mkdirSync(appRoot, { recursive: true })
  for (const name of ['lib', 'renderer', 'assets', 'package.json'] as const) {
    cpSync(join(desktopRoot, name), join(appRoot, name), { recursive: true })
  }
  pinStagedElectronVersion(join(appRoot, 'package.json'))
  // Windows electron-builder still runs `pnpm list --json` in appDir even
  // when the staged shell has no dependencies. An empty lockfile makes that
  // command return JSON instead of failing the pack, and keeps the collector
  // from walking the repository workspace.
  writeFileSync(join(appRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
}

/**
 * Package the prepared runtime with electron-builder.
 * @param platform - packaged platform.
 * @param skipBuild - reuse an existing prepared runtime tree instead of re-running the prepare chain.
 */
function packDesktop(platform: DesktopPlatform, skipBuild = false): void {
  const version = desktopVersion()
  const prepared = skipBuild ? reusePreparedRuntime(platform) : prepareDesktopRuntime(platform)
  stageApp()
  const configPath = writeBuilderConfig(version, platform, prepared)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const target = builderTarget(platform)
  run(pnpmBin(), [
    'dlx',
    ELECTRON_BUILDER_SPEC,
    '--config',
    configPath,
    '--publish',
    'never',
    target.flag,
    target.target,
  ], appRoot)
  for (const name of expectedArtifacts(version, platform)) {
    const path = join(outDir, name)
    if (!existsSync(path)) throw new Error(`desktop pack: missing artifact ${path}`)
  }
}

/** CLI entry: `pnpm exec tsx scripts/desktop/pack.ts [--platform <p>] [--skip-build]`. */
function main(): void {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      'skip-build': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  packDesktop(parsePlatform(values.platform), values['skip-build'] === true)
}

if (isEntry(import.meta.url)) main()
