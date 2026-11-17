/** Restore vendored packages that pnpm deploy omits from a Host tree. */

import { lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  VENDORED_HOST_DIRECTORIES,
  deployedPackageName,
  deployedPackagePath,
  materializeWorkspaceLinks,
  restoreVendoredHostPackages,
  vendoredPackageName,
} from './restore-vendored-host.ts'

const root = join(import.meta.dirname, '../..')

describe('restoreVendoredHostPackages', () => {
  it('names every vendored Host package from vendor/*/package.json', () => {
    expect(VENDORED_HOST_DIRECTORIES).toContain('cosmokit')
    expect(VENDORED_HOST_DIRECTORIES).toContain('group')
    expect(vendoredPackageName(join(root, 'vendor', 'cosmokit'))).toBe('@deepseek-ai/cosmokit')
    expect(vendoredPackageName(join(root, 'vendor', 'group'))).toBe('@deepseek-ai/cordis-plugin-group')
    expect(deployedPackagePath('/out/dsh', '@deepseek-ai/cosmokit')).toBe(
      join('/out/dsh', 'node_modules', '@deepseek-ai', 'cosmokit'),
    )
  })

  it('copies omitted vendored packages into a deployed Host and leaves existing copies', () => {
    const deployed = mkdtempSync(join(tmpdir(), 'dsh-restore-vendored-'))
    mkdirSync(join(deployed, 'node_modules', '@deepseek-ai', 'cordis'), { recursive: true })
    writeFileSync(join(deployed, 'node_modules', '@deepseek-ai', 'cordis', 'package.json'), '{"name":"@deepseek-ai/cordis"}\n')
    writeFileSync(join(deployed, 'node_modules', '@deepseek-ai', 'cordis', 'marker'), 'keep\n')
    const copied = restoreVendoredHostPackages(deployed, root)
    expect(copied).toContain('@deepseek-ai/cosmokit')
    expect(copied).toContain('@deepseek-ai/cordis-plugin-group')
    expect(copied).not.toContain('@deepseek-ai/cordis')
    expect(existsSync(join(deployed, 'node_modules', '@deepseek-ai', 'cosmokit', 'package.json'))).toBe(true)
    expect(existsSync(join(deployed, 'node_modules', '@deepseek-ai', 'cordis', 'marker'))).toBe(true)
  })

  it('replaces a workspace symlink with a material vendored copy', () => {
    const deployed = mkdtempSync(join(tmpdir(), 'dsh-restore-symlink-'))
    const dest = join(deployed, 'node_modules', '@deepseek-ai', 'schemastery')
    mkdirSync(join(deployed, 'node_modules', '@deepseek-ai'), { recursive: true })
    symlinkSync(join(root, 'vendor', 'schemastery'), dest)
    expect(lstatSync(dest).isSymbolicLink()).toBe(true)
    const copied = restoreVendoredHostPackages(deployed, root)
    expect(copied).toContain('@deepseek-ai/schemastery')
    expect(lstatSync(dest).isSymbolicLink()).toBe(false)
    const manifest = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as { name: string }
    expect(manifest.name).toBe('@deepseek-ai/schemastery')
  })
})

describe('materializeWorkspaceLinks', () => {
  /** Deployed tree whose manifest names the application package. */
  function deployedTree(): string {
    const deployed = mkdtempSync(join(tmpdir(), 'dsh-deploy-links-'))
    writeFileSync(join(deployed, 'package.json'), '{"name":"@deepseek-ai/dsh"}\n')
    mkdirSync(join(deployed, 'node_modules', '@deepseek-ai'), { recursive: true })
    return deployed
  }

  /** Workspace package a deploy left linked, with build output and ignored directories. */
  function workspacePackage(): string {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-workspace-pkg-'))
    writeFileSync(join(workspace, 'package.json'), '{"name":"@deepseek-ai/dsh-error","main":"lib/index.js"}\n')
    mkdirSync(join(workspace, 'lib'), { recursive: true })
    writeFileSync(join(workspace, 'lib', 'index.js'), 'export {}\n')
    mkdirSync(join(workspace, 'tests'), { recursive: true })
    writeFileSync(join(workspace, 'tests', 'index.spec.ts'), 'test\n')
    mkdirSync(join(workspace, 'node_modules', 'left-pad'), { recursive: true })
    writeFileSync(join(workspace, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')
    return workspace
  }

  it('replaces a linked workspace package with a material copy', () => {
    const deployed = deployedTree()
    const workspace = workspacePackage()
    const link = join(deployed, 'node_modules', '@deepseek-ai', 'dsh-error')
    symlinkSync(workspace, link)
    expect(materializeWorkspaceLinks(deployed)).toEqual(['@deepseek-ai/dsh-error'])
    expect(lstatSync(link).isSymbolicLink()).toBe(false)
    expect(existsSync(join(link, 'lib', 'index.js'))).toBe(true)
    expect(existsSync(join(link, 'tests'))).toBe(false)
    expect(existsSync(join(link, 'node_modules'))).toBe(false)
  })

  it('leaves material packages and drops the deployed package\'s own link', () => {
    const deployed = deployedTree()
    const scope = join(deployed, 'node_modules', '@deepseek-ai')
    mkdirSync(join(scope, 'cosmokit'), { recursive: true })
    writeFileSync(join(scope, 'cosmokit', 'package.json'), '{"name":"@deepseek-ai/cosmokit"}\n')
    symlinkSync(join(root, 'apps', 'cli'), join(scope, 'dsh'))
    expect(materializeWorkspaceLinks(deployed)).toEqual(['@deepseek-ai/dsh'])
    expect(existsSync(join(scope, 'dsh'))).toBe(false)
    expect(existsSync(join(scope, 'cosmokit', 'package.json'))).toBe(true)
  })

  it('names the deployed package from its manifest', () => {
    expect(deployedPackageName(deployedTree())).toBe('@deepseek-ai/dsh')
  })

  it('reports a dangling workspace link instead of copying nothing', () => {
    const deployed = deployedTree()
    symlinkSync(join(deployed, 'missing-workspace-package'), join(deployed, 'node_modules', '@deepseek-ai', 'dsh-error'))
    expect(() => materializeWorkspaceLinks(deployed)).toThrow(/dsh-error is a dangling symlink/u)
  })
})
