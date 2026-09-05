/**
 * Isolated preload: window chrome and the macOS dock badge reach the page.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dshDesktop', {
  minimize: () => { ipcRenderer.send('dsh-desktop:minimize') },
  maximize: () => { ipcRenderer.send('dsh-desktop:maximize') },
  close: () => { ipcRenderer.send('dsh-desktop:close') },
  setCompletedUnread: (count: number) => { ipcRenderer.send('dsh-desktop:set-completed-unread', count) },
  canInstall: () => ipcRenderer.sendSync('dsh-desktop:update-can-install') === true,
  installUpdate: (payload: unknown) => ipcRenderer.invoke('dsh-desktop:update-install', payload),
  cancelUpdate: () => { ipcRenderer.send('dsh-desktop:update-cancel') },
  onUpdateProgress: (cb: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown): void => { cb(payload) }
    ipcRenderer.on('dsh-desktop:update-progress', listener)
    return () => { ipcRenderer.removeListener('dsh-desktop:update-progress', listener) }
  },
  relaunchToUpdate: () => { ipcRenderer.send('dsh-desktop:update-relaunch') },
})
