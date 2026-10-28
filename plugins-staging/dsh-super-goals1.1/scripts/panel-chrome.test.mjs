/**
 * Panel chrome contract: mind-map fills the overlay, no persistent editor card,
 * no save/confirm/reject/pending-approval banners, no status bar,
 * overlay-only launcher, collapsed badge only when a board exists.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const CLIENT_SRC = join(ROOT, 'src', 'client', 'index.ts')
const CLIENT_LIB = join(ROOT, 'lib', 'client.js')

function assertChrome(src, label) {
  assert.doesNotMatch(src, /window\.confirm/, label + ': no system confirm dialog')
  assert.doesNotMatch(src, /data-confirm/, label + ': no overlay delete confirm')
  assert.doesNotMatch(src, /pb-confirm/, label + ': no confirm banner')
  assert.doesNotMatch(src, /\u786e\u8ba4\u751f\u6548/, label + ': no confirm-apply control')
  assert.doesNotMatch(src, /\u786e\u8ba4\u5220\u9664/, label + ': no delete confirm')
  assert.doesNotMatch(src, /\u4fdd\u5b58\u66f4\u6539/)
  assert.doesNotMatch(src, /\u9a73\u56de/, label + ': no reject control')
  assert.doesNotMatch(src, /\u4efb\u52a1\u601d\u7ef4\u5bfc\u56fe/, label + ': no map caption chrome')
  assert.doesNotMatch(src, /pendingRemove/, label + ': no deferred delete')
  assert.doesNotMatch(src, /editorCard/, label + ': no persistent editor card')
  assert.doesNotMatch(src, /className:\s*['"]pb-form['"]/, label + ': no editor form')
  assert.doesNotMatch(src, /pendingApprovals/, label + ': no pending-approval field')
  assert.doesNotMatch(src, /decision:\s*['"]approve['"]/, label + ': no approve button')
  assert.doesNotMatch(src, /statusBarPath/, label + ': no status bar path')
  assert.doesNotMatch(src, /MAP_STATUS_BAR/, label + ': no status-bar inset')
  assert.match(src, /statusPaint/, label + ': status uses fill vs stroke')
  assert.match(src, /statusLabel/, label + ': status has a text label')
  assert.match(src, /h\('title'|createElement\)\(["']title["']/, label + ': nodes expose SVG title hover text')
  assert.doesNotMatch(src, /L7 \u8d8a\u754c\u62e6\u622a/, label + ': no L7 intercept banner')
  assert.doesNotMatch(src, /\u6682\u505c\u62e6\u622a/, label + ': no pause-intercept control')
  assert.match(src, /nodeCardWidth/, label + ': node width follows label')
  assert.match(src, /\.pb-map\{[^}]*flex:1/, label + ': map grows to fill the pane')
  assert.match(src, /\.pb-map\{[^}]*height:100%/, label + ': map fills the body height')
  assert.match(src, /width:\s*['"]100%['"][\s\S]{0,80}height:\s*['"]100%['"]/, label + ': svg fills the map')
  assert.doesNotMatch(src, /height: autoHeight \? 'auto' : geometry\.height/, label + ': docked overlay uses a definite height')
  assert.doesNotMatch(src, /\u4e8b\u4ef6\u65f6\u95f4\u7ebf/)
  assert.doesNotMatch(src, /className:\s*['"]pb-ev['"]/)
  assert.doesNotMatch(src, /conversation\.session\.header\.utilities/)
  assert.doesNotMatch(src, /function PaneSidebarButton/)
  assert.doesNotMatch(src, /\u672a\u9009\u4e2d\u4f1a\u8bdd['"]\s*:\s*sessionId/)
  assert.match(src, /shell\.overlay/)
  assert.match(src, /data-super-goals-collapsed/)
  assert.doesNotMatch(src, /if \(!wasActive\) return null/)
  assert.match(src, /if \(data == null\)[\s\S]{0,80}return null/, label + ': missing board never mounts pane or badge')
  assert.match(src, /if \(!open\)[\s\S]{0,400}data-super-goals-collapsed/, label + ': collapsed badge only after a board exists')
  assert.match(src, /prevSessionRef/, label + ': remember previous session')
  assert.match(src, /prevSessionRef[\s\S]{0,900}openState = false/, label + ': switching session closes the panel')
  assert.doesNotMatch(src, /\u5f53\u524d\u4f1a\u8bdd\u8fd8\u6ca1\u6709\u677f\u5b50/, label + ': no empty-board pane')
  assert.doesNotMatch(src, /\u62d6\u62fd\u4f4d\u7f6e\/\u5185\u5bb9\/\u4f9d\u8d56\/\u589e\u5220\uff0c\u4fdd\u5b58\u540e\u624d\u751f\u6548/)
  assert.match(src, /onNodeDragEnd/, label + ': node drag has an end handler')
  assert.match(src, /panel:drag-pos/, label + ': node drag persists immediately')
  assert.doesNotMatch(src, /\u5185\u5bb9\/\u4f9d\u8d56\/\u589e\u5220\uff0c\u786e\u8ba4\u540e\u624d\u751f\u6548/, label + ': no confirm-gated content edits')
}

test('panel chrome: map fills pane, no editor or approval chrome', () => {
  assertChrome(readFileSync(CLIENT_SRC, 'utf8'), 'src')
  assertChrome(readFileSync(CLIENT_LIB, 'utf8'), 'lib')
})

