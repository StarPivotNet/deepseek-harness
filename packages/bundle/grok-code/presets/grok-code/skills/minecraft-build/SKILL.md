---
name: minecraft-build
description: "Use when building a Minecraft structure in Python: a house, terrain, object, or scene that exports a structure dictionary, or when previewing that structure in the React viewer. The SDK and runner live in this skill. Copy frontend/ into the current workspace, npm install there, then start it. Not a .schem or .litematic exporter, and not Blockbench."
---

# Minecraft build

Write one Python script with the SDK in `minecraft/` in this skill directory. Do not copy that SDK tree, and do not start the FastAPI app. The build result is the structure JSON the runner prints. It is not a `.schem`, `.litematic`, or NBT file. A `.bbmodel` is `blockbench`, not this skill. The React viewer source stays in this skill's `frontend/`. Before previewing, copy that directory into the current workspace and install it there. Do not run `npm install` or `npm run dev` inside the skill directory.

The SDK tree and the viewer source are GPLv3, including `minecraft/LICENSE`. Keep that license with both copies. Python 3.11 and `numpy` are required. On this machine `python` is Python 3.11.0 and NumPy is installed. If `python --version` is older, use `py -3.11`.

Set the import root to this skill's `minecraft` directory before running the script. The skill tool reports that directory as its base directory. `pwsh -Command` leaves PSScriptRoot empty, so join `$env:DSH_HOME`:

```powershell
$env:PYTHONPATH = Join-Path $env:DSH_HOME ".agent-presets\dsh-grok-agi\skills\minecraft-build\minecraft"
python -m app.services.code_runner <script.py>
```

The runner executes the script, reads the top-level `structure`, and prints one JSON object. Success is `"ok": true` plus `structure`. Failure is `"ok": false`, `error`, and `error_line`. A timeout or a missing `structure` is a failure. Name the exit code and the output path.

## Write

Read `minecraft/app/agent/minecraft/docs/` before choosing block ids or terrain calls. `04-block-list.md` is the block-id list. `05-terrain-guide.md` is only for terrain.

Start from `minecraft/app/agent/minecraft/scaffold.py`. The script imports `Scene`, `Block`, `Object3D`, `Vector3`, and `BlockCatalog` from `app.agent.minecraft`. Terrain imports come from `app.agent.minecraft.terrain`. Build the scene, then assign the export:

```python
structure = scene.to_structure(padding=0)
```

`structure` must exist at module level. `code_runner.py` rejects a script that does not define it, and it rejects a value that is not a JSON object. Each block entry has inclusive `start`, exclusive `end`, a `minecraft:` block id, string `properties`, and `fill`.

`BlockCatalog` checks the id and the required properties against `static/assets.json`. A stair needs `facing`, `half`, and `shape`. A slab needs `type`. A log needs `axis`. Unknown ids and missing required properties raise `ValueError`.

Save the runner's `structure` object as UTF-8 JSON. Do not treat a printed log line as the structure.

## Preview

After the structure JSON is saved, copy this skill's `frontend/` into the current workspace, install it there, and start that copy. Hand the user one URL that already loads the saved file. The viewer is the GPLv3 React + Vite preview: one full screen, orbit and first-person cameras, Lodestone block models, and `public/assets/atlas.png`. The chat panel, project list, and session API are gone. Do not start the FastAPI app.

The skill directory is the source. Never `npm install` there, and never start Vite from there. Copy into `<workspace>/minecraft-viewer`, excluding `node_modules` and `dist`. If that directory already exists from an earlier preview in this workspace, refresh the source files and keep its `node_modules`.

```powershell
$source = Join-Path $env:DSH_HOME ".agent-presets\dsh-grok-agi\skills\minecraft-build\frontend"
$dest = Join-Path (Get-Location) "minecraft-viewer"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# /E refreshes source files. /XD leaves an existing node_modules and dist in place.
robocopy $source $dest /E /XD node_modules dist /NFL /NDL /NJH /NJS /nc /ns /np
if ($LASTEXITCODE -ge 8) { throw "frontend copy failed: $LASTEXITCODE" }
$global:LASTEXITCODE = 0
npm install --prefix $dest
if ($LASTEXITCODE -ne 0) { throw "npm install failed: $LASTEXITCODE" }
```

Start the dev server as its own background command. Its working directory is `$dest`, not the skill directory and not the workspace root:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

The skill directory is `$env:DSH_HOME\.agent-presets\dsh-grok-agi\skills\minecraft-build`. Run the copy and `npm install` with the workspace as the working directory. `robocopy` exit codes 0 through 7 mean the copy worked; 8 or higher is a failure. Do not treat a successful `robocopy` code as a failed shell command. `npm install` runs in `<workspace>/minecraft-viewer` on every preview, including when `node_modules` is already there, so the copy matches the lockfile. Start `npm run dev` in the background with `workdir` set to `<workspace>/minecraft-viewer`. The shell tool does not keep the working directory across calls, so do not rely on `Set-Location`.

If port 5173 is already serving this workspace's `minecraft-viewer`, keep that server and use its port. If 5173 is serving the skill directory or another project, pick the next free port and start the workspace copy there. Wait until its output contains `Local:`. If that server then exits, read its output before starting another. Leave the server running.

`<workspace>/minecraft-viewer/vite.config.js` allows `/@fs/` reads from the user profile and every present fixed-drive root. A structure JSON outside those roots will not load. Do not narrow `server.fs.allow` back to a relative walk from `frontend/`: that walk stops at the user profile and rejects `D:/...`.

Build the URL as `http://127.0.0.1:<port>/?file=<absolute JSON path>`. Use forward slashes in the path and encode it. On Windows that is `C:/.../structure.json`, not a backslash path. The page rewrites a disk path to Vite's `/@fs/` route, so the browser loads the JSON without a file picker. A Windows drive letter is not a URL scheme: `C:/...` must become `/@fs/C:/...`, and a POSIX path must become `/@fs/...` with a single slash after `fs`. Only `scheme://` is fetched as-is. Fetching the raw `C:/...` string throws `Failed to fetch`.

Confirm the page returns 200 and that `/@fs/<absolute JSON path>` returns the saved JSON, then put the page URL in the reply. The page reads `structure.blocks`; each block has inclusive `start`, exclusive `end`, `type`, `properties`, and `fill`. A runner result shaped `{ "ok": true, "structure": { ... } }` is accepted too. The URL must point at the workspace copy's port, not at a Vite process started inside the skill directory.

## Check

Run the skill's runner on the script. The check passes only when the process exits 0 and the printed JSON has `"ok": true`. Record `block_count` from `structure.blocks`, and record `width`, `height`, and `depth`. If `ok` is false, change the script and run the same command again. Do not claim the build exists without that output.
