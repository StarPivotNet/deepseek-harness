/**
 * Right-click a mind node: a secondary menu (edit / add child / delete)
 * sits next to it; Edit opens one exclusive edit panel.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const CLIENT_SRC = join(ROOT, 'src', 'client', 'index.ts')
const CLIENT_LIB = join(ROOT, 'lib', 'client.js')

function assertNodeMenu(src, label) {
  assert.match(src, /onContextMenu/, label + ': nodes handle right-click')
  assert.match(src, /pb-node-menu/, label + ': secondary menu class')
  assert.match(src, /[\u7f16\u8f91]/, label + ': menu has 编辑')
  assert.match(src, /[\u6dfb\u52a0\u5b50\u5206\u652f]/, label + ': menu has 添加子分支')
  assert.match(src, /[\u5220\u9664]/, label + ': menu has 删除')
  assert.match(src, /op:\s*['"]add_node['"]/, label + ': add child posts add_node')
  assert.match(src, /op:\s*['"]remove_node['"]/, label + ': delete posts remove_node')
  assert.match(src, /editingId/, label + ': exclusive editor tracks one id')
  assert.doesNotMatch(src, /editingIds/, label + ': editor is not a set of ids')
  assert.match(src, /pb-edit-panel/, label + ': edit opens a dedicated panel')
  assert.match(src, /setEditingId/, label + ': opening edit replaces the current panel')
  assert.match(src, /e\.button\s*!==\s*0|button\s*!==\s*0/, label + ': right-click does not start a drag')
  assert.match(src, /clientToOverlay/, label + ': menu uses overlay-local coords, not viewport clientXY')
  assert.match(src, /\.pb-node-menu\{position:absolute/, label + ': menu is absolute inside the transformed panel')
  assert.match(src, /\.pb-edit-panel\{position:absolute/, label + ': editor is absolute inside the transformed panel')
  assert.match(src, /onEditorPointerDown/, label + ': editor can be dragged from its header')
  assert.match(src, /overlayDragPosition/, label + ': editor drag keeps overlay-local coords')
  assert.doesNotMatch(src, /window\.confirm/, label + ': delete has no system confirm')
}

test('right-click mind node shows a secondary menu and exclusive edit panel', () => {
  assertNodeMenu(readFileSync(CLIENT_SRC, 'utf8'), 'src')
  assertNodeMenu(readFileSync(CLIENT_LIB, 'utf8'), 'lib')
})
