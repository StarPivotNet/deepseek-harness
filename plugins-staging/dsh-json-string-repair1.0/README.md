# dsh-json-string-repair

Host plugin. On `llm/stream`, raw U+0000–U+001F characters that appear inside a tool-call argument string are rewritten to JSON escapes (`\n`, `\r`, `\t`, `\b`, `\f`, or `\u00XX`) before the agent loop parses that string.

Whitespace outside strings is left alone. A string that already parses is not rewritten. Install manually with `dsh plugin add`; restart the profile after install. This package does not run that command.
