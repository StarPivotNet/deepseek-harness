---
kind: upgrade-guide
description: "The organization dsh loads Purge by default and removes its separate upstream-update API."
---

# Built-in Purge changes profile defaults and update ownership

English | [中文](guide.zh.md)

## Change

The organization `web`, `desktop`, `headless`, `sdk`, and `acp` profiles now include `@deepseek-ai/dsh-purge` and enable automatic application of its Host compatibility patches. Existing profiles adopt the layer unless explicitly opted out. `/dsh-purge/update` is removed; `/redteam/api` version queries describe the bundled version, and separate package updates are rejected. Purge tools, prompts, settings, and red-team features are available by default and change existing Sessions' model-visible context and tool schemas.

## Migration

1. Keep the upgrade's default behavior, or add `!@deepseek-ai/dsh-purge` to the profile's `dsh.profile.bundles` list before starting it. To disable only activation, override the `dsh-purge` row with `config: { enabled: false }` in `cordis.patch.yml`.
2. Review the current Host's patch status in **Settings → Purge** and restart when requested. If patches remain pending, do not apply them to a different installation.
3. Remove automation that calls `/dsh-purge/update`. Upgrade the complete organization dsh release instead of downloading the external `dsh-purge` package. Existing `dsh-purge` settings and red-team data directories are preserved.
4. Verify the profile with `dsh --profile <name> --dump-config`; confirm the Purge row is present or the opt-out marker is retained, and confirm new Sessions use the intended prompt and tool set.
