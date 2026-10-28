# Bundle and Profile

The install unit of a published plugin is a **bundle**: one npm package plus the `cordis.patch.yml` pointed to by `dsh.bundle.patch`. A profile is a different application face on the same DSH install (`web` / `headless` / `acp` / `sdk` / `sdk-minimal`).

## Bundle declaration on the package

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

`DshManifest` from `@deepseek-ai/dsh-package-manifest` also describes `profile`, `client`, `configTrees`, and `sessionFormatMigration`. `moduleFallback` is launcher-generated metadata; authors must not write it by hand.

**Published plugins are installed manually by the user**. The user themselves runs `dsh plugin --profile <name> add <package path or name>`: pnpm the package into that profile and reconcile it into the `dsh.profile.bundles` layer. The agent **does not run `dsh plugin add` on the user's behalf**. **Restart that profile after plugin add** — package manifest / bundles-layer and client package metadata are cached in-process by name. The user's own `cordis.patch.yml` on a `patchReload: live` profile can be reread transactionally by boot HMR.

## cordis.patch.yml

A top-level YAML array. `insert` appends composition rows:

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
      config:
        stateDir: .my-plugin
```

- `id`: row id, globally unique.
- `name`: must equal the npm `package.json` `name` (client-modules uses `require.resolve('<name>/package.json')`). Quote scoped names in YAML because `@` is a reserved indicator.
- `config`: object passed into the plugin `Config`, validated by Schemastery.

Comparisons:

- OC2DSH: `id: oc2dsh`, `name: OC2DSH`, `config: {}`, no isolate, no client.
- exFAT: `id`/`name` both `dsh-exfat-workspace`.
- AgentTeams: `name: '@nanmicoder/dsh-agent-teams'`, with business config.

Do not write `isolate` on these outward rows. isolate belongs only to a published service and only to group rows read inside a preset.

## Profile stacking

Location: `$DSH_HOME/profiles/<name>`. One layer is an installable bundle, the profile's own `cordis.patch.yml`, and `patchReload: live | startup`. Custom profiles that omit a reload policy historically default to `live`. The shipped `web` template reloads live; other shipped templates apply the patch only at startup.

The user tweak layer sits **after every composed package layer**:

1. that profile's `cordis.patch.yml`
2. harness-home `cordis.patch.yml` (higher priority)

You may replace an entry's entire `config` (restate fields you want to keep), insert new entries, or interpolate `!!js` at startup on **plugin `config` leaves**. stderr warns when a patch names an entry that does not exist. **An empty file or a comment-only patch fails startup**; disable that layer with `[]`.

`!!js` is only for plugin `config`. Loader metadata (`id`, `name`, `group`, `disabled`, `inject`, `intercept`, `isolate`) must be literals. `disabled: !!js ...` becomes a truthy object and the row is permanently disabled.

Inserted entry plugin names may be absolute paths, file URLs, or package identifiers. The loader turns absolute paths in `insert` and nested groups, plus `./` `../` relative to the patch file, into file URLs.

## Startup and failure

`dsh-app-boot` loads environment layers, composes bundles and patches, and starts each plugin. Failure is one labeled line plus a non-zero exit: it names the failing plugin and the phase (`host preparation failed` vs `plugin tree failed to load`). A missing bundle or a bundle that does not declare a patch fails startup explicitly.

Environment layers: the calling directory `.env` beats harness-home `.env`; both lose to the inherited environment. Variables that decide how the process starts (`PATH` / `DSH_*` / `XDG_*` and similar) are refused from files. Proxy variables are accepted only from harness-home `.env`.

## When not to make a bundle

Internal packages used only by the current checkout can mount the way that repo aggregates them. Once the user must install them into their own profile, they must be a bundle: `dsh.bundle.patch` + a resolvable `name` + `cordis.patch.yml` and `lib` listed in `files`. The user runs the install command; the agent **does not run `dsh plugin add` on the user's behalf**.
