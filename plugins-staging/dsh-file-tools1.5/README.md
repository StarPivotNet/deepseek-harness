# dsh-file-tools

UTF-8 filesystem tools that can create files without the official `edit` read-first restriction.

- `file_read` reads multiple UTF-8 files concurrently in one call. Each file returns numbered lines and is capped at 2000 lines, 2000 characters per line, and 300 KB by default. Use `offset` and `limit` to continue.
- `file_write` creates a missing file, creates missing parent directories, or replaces an existing regular file. It is safe to run beside other file-tool calls: a replace carries the version read at the start of the call, and a stale version fails instead of overwriting. On a Windows volume that rejects the host hard-link create, it publishes a missing file with a no-replace move. A file created by someone else during that retry is left untouched.
- `file_edit` applies exact replacements to one or more existing files in one call. Files in that call are read and written concurrently. Replacements inside one file stay ordered. Set `replace_all` on an edit to replace every occurrence. CRLF and LF match each other, and the file's original newline style is preserved. Tabs, BOM, spaces, and other hidden characters remain exact. A file edited by this tool can be edited again immediately without `read`. A write uses the version read for that file, so a concurrent change fails with a stale version instead of being overwritten.

Relative paths resolve against the calling session workspace. Sandboxed filesystems use the same one-shot `sandbox_permissions` and `justification` approval flow as the official filesystem tools.

Install this bundle into a profile manually, then restart that profile. This package does not replace or unregister the official `write` and `edit` tools.
