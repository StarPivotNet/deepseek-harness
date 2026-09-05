/** `settings.productUpdate` namespace dictionaries (the Settings row and overlay toast). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '产品更新',
  description: '向 GitHub Releases 查询是否有更新的 dsh 或桌面端版本。查询本身不下载。打包后的桌面端可以安装匹配的归档，再重启完成替换。',
  currentVersion: '当前版本：{version}',
  lastChecked: '上次检查：{time}',
  neverChecked: '尚未检查',
  checkNow: '立即检查',
  checking: '正在检查…',
  upToDate: '已是最新版本。',
  available: '有可用更新：{version}',
  dismissed: '已忽略此版本。',
  openRelease: '打开发行说明',
  dismiss: '忽略',
  checkFailed: '无法检查更新。',
  install: '安装',
  installing: '正在下载更新…',
  installProgress: '正在下载… {percent}%',
  installReady: '更新已下载。重启以应用。',
  restart: '重启',
  cancelInstall: '取消',
  installFailed: '无法安装更新。',
  toastTitle: '有可用更新',
  toastBody: '版本 {version} 可用。',
  toastOpen: '发行说明',
  toastDismiss: '忽略',
  toastInstall: '安装',
  toastRestart: '重启',
} satisfies Record<string, string>

/** The settings.productUpdate namespace key union. */
export type ProductUpdateLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  title: 'Product updates',
  description: 'Checks GitHub Releases for a newer dsh or desktop build. Checking itself does not download. Packaged desktop can Install the matching archive and Restart to apply it.',
  currentVersion: 'Installed version: {version}',
  lastChecked: 'Last checked: {time}',
  neverChecked: 'Not checked yet',
  checkNow: 'Check now',
  checking: 'Checking…',
  upToDate: 'You are on the latest release.',
  available: 'Update available: {version}',
  dismissed: 'This release was dismissed.',
  openRelease: 'Open release notes',
  dismiss: 'Dismiss',
  checkFailed: 'Could not check for updates.',
  install: 'Install',
  installing: 'Downloading the update…',
  installProgress: 'Downloading… {percent}%',
  installReady: 'Update downloaded. Restart to apply it.',
  restart: 'Restart',
  cancelInstall: 'Cancel',
  installFailed: 'Could not install the update.',
  toastTitle: 'Update available',
  toastBody: 'Version {version} is available.',
  toastOpen: 'Release notes',
  toastDismiss: 'Dismiss',
  toastInstall: 'Install',
  toastRestart: 'Restart',
} satisfies Record<ProductUpdateLocaleKey, string>
