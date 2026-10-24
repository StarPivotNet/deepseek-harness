/** Organization package root that uninstall cleanup must never delete. */
export function builtinPackageRoot(): string
/** Whether a directory is a removable profile-owned plugin copy. */
export function shouldDeletePluginTree(dir: string, dshHome?: string): boolean
