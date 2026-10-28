---
name: blockbench
description: "Use when writing a .bbmodel: a cube model, an armor piece, a voxel rig, bone keyframes, a render, a gate, or a GeckoLib export. One Python library. Writes format_version 4.10 only. Not a website, not a remote model API, and not MCP."
---

# Blockbench

Write the `.bbmodel` in Python with `bbmodel-maker`. Do not fill an intermediate spec, do not call a remote model, and do not start Blockbench MCP. Do not use `minecraft-ai-generate-bbmodel-main`, `bbmodel-generation-main`, or `bbmodel-ai-generator-master`.

The library is `bbmodel-maker` in this skill directory. It needs Python 3.11 or newer, `numpy`, and `pillow`. Do not use a copy under `Desktop\test`.

```powershell
$env:PYTHONPATH = Join-Path $env:DSH_HOME ".agent-presets\dsh-grok-agi\skills\blockbench\bbmodel-maker\src"
```

The import root is the skill directory the skill tool reports as its base directory, plus `bbmodel-maker\src`. `pwsh -Command` leaves PSScriptRoot empty, so the example joins `$env:DSH_HOME`. Set it before importing `bbmodel_maker` or running `python -m`. On this machine `python` and `py -3.11` are both Python 3.11.0. If `python --version` is older than 3.11, use `py -3.11`.

Project root resolves in this order: an explicit `Workspace` argument, `$env:BBMODEL_PROJECT_ROOT`, a `bbmodel.toml`, a `.git` directory, then the working directory. `bbmodel.toml` names `lib` (output directory) and `namespace`.

Sixteen Blockbench units are one Minecraft block. On a vanilla-density texture, one texel is one unit. Do not draw a one-pixel outline and expect it to read as a line. Two cubes whose outer faces share a plane and overlap in projection flicker; offset one face. `disconnected` joins cubes within 0.05, so an offset larger than that needs a peg back to the body, or the name goes in `detached`. A horizontal surface (arm top, foot sole) is invisible in an orthographic front view, and a part hidden behind a wider neighbour is invisible in a three-quarter view too. Make it wider than what hides it, and check a yaw near -55, not only the six `views_for` views.

## Build

```python
from bbmodel_maker import Workspace
ws = Workspace.discover()
```

Write models under `ws.models`. Create the directory before saving.

`bbmodel_maker.rig.voxel_rig` builds a generic free model (`model_format` `"free"`, `format_version` `"4.10"`).

- `Palette(colors)` maps a material name to one swatch. `uv()` insets one pixel so neighboring swatches do not bleed.
- `Rig(palette)` then `bone(name, pivot, parent=None)`. Define the parent first. Do not name a bone `root`.
- `cube(bone, name, frm, to, mat=...)` or `shaft(bone, name, a, b, rx, mat=...)`.
- `unfold(element, u, v)` lays that cube's six faces out at 1 unit = 1 pixel. Each edge rounds to the nearest pixel and stays at least 1, and all six edges share that rounding, so a 0.2 edge and a 1.4 edge both land on 1 pixel. A strap thinner than 1 unit then fails `uv_density`. Make the strap 1 unit. The integer box-UV unfold stays `box_uv_rects` and is only for Bedrock box UV. `cube` keeps the material name on the element as `_mat`; `bbmodel()` drops every key that starts with `_`, because `color` only holds 0–7 and the ninth material collides with the first.
- `paint(shader_of)` unfolds every cube onto one sheet, paints each face with `paint_face` under the name `shader_of` returns, and replaces the swatch sheet. A name it does not know paints as `flat`. The palette swatch is only a flat color. A cross, an inscription, or moss on one side goes on the rectangles `unfold` returns.
- `save(path, model_name)` writes the file.

A group origin is the pivot. Cube `from` / `to` stay in rest space and are axis-aligned. `origin` is the pivot. `rotation` is degrees. Cubes use per-face UV (`box_uv` false). A bend is two cubes overlapped at the joint, because this library writes rigid cubes, not skinned vertices. Java block models do not play bone animation.

Box UV lays faces out from the cube size. Per-face UV is the rectangle in `faces`. Bedrock box UV cannot drop a face. Minecraft face UVs do not tile; split the face or map each tile to the full swatch. Hytale quads cannot use box UV, and each texture side must be a multiple of 32.

`rigkit.Rig` is the other cube builder (`bone`, `cube`, `shaft`, `unfold`, `paint`, `taper`, then `bbmodel(name)`). It keeps `_mat` and drops it on export the same way. Its ground is `y=0` and it faces -z.

### Armor

`bbmodel_maker.model.armor_model_common` is the armor builder, not a general cube API.

- `Cube` and `ArmorPart`. `validate_part(part)` before building.
- `build_bbmodel(material, part, texture, namespace=None)` returns a 4.10 document. The texture must be the module's `TEXTURE_SIZE` square.
- `write_material_assets(...)` writes the model, the texture, and a preview.

### Animation

Static group rotation and animation channels do not share a sign. `bbmodel_maker.rig.bb_anim_axes` is the only conversion. Do not branch on `format_version`.

- Writing an animation channel negates every axis: `WRITE_LAYERS` is `bb.x = -pitch`, `bb.y = -yaw`, `bb.z = -roll`. Call `rotation_to_bb`. Do not leave X positive.
- Rendering does not negate. `render_bbmodel` and a preview turn the degrees stored in the file.
- Reading a channel back to MC angles uses `READ_LAYERS`: `pitch = -bb.x`, `yaw = +bb.y`, `roll = -bb.z`. That read is not the inverse of the write.
- A static `group.rotation` uses the read-side signs. Do not apply `WRITE_LAYERS` to it.

`bbmodel_maker.rig.animcore.stable_uuid(seed)` keeps a uuid stable across runs. `voxel_rig` uses `uuid.uuid4()`, so a byte compare of those files always fails. `keyframe`, `animators_of`, and `animation_entry` build the animation object. `animkit.write_animated_bbmodel` and `rigkit` both stamp `format_version` `"4.10"` on the way out. There is no version conversion.

The renderer reads `elements`, not the bone tree. A cube that only looks right after a bone rotation must be baked before a preview, or the picture hides the error.

Coplanar flicker is a rest-geometry check. `coplanar_faces` only compares axis-aligned cubes in `elements`. It does not sample an animation, and `AnimGates` does not include it. A pose that swings one part onto another is not that check. A non-zero cube `rotation` makes the check skip that cube, so `0.001` hides the report and does not separate the faces. Offset the outer face.

The file is written when it exists, opens as 4.10, every cube names a bone that exists, and every UV sits inside the texture.

## Check

Run the command from the library directory. Name its exit code and the output path.

`bbmodel-render FILE` writes a shaded PNG (`--yaw` default `-35`, `--pitch` default `22`, `--size` default `600`, `--three-view`). Without the console script: `python -m bbmodel_maker.render.render_bbmodel`. `--all` only composites the four coffin models shipped with the library. This is a z-buffer sample of the embedded texture, not a flat preview. `shading="mc"` is closer to the game. The default Lambert shade stretches light about 2.5x and can look like stripes.

Name a view with `bbmodel_maker.render.framing.views_for`. Do not hand-write a yaw table. `yaw=180` shows the −z face. Pass `framing.focus_for` when two renders must share a frame; the default frames each file on its own bounds. Count a material by hue direction, not by brightness.

`bbmodel_maker.model.cube_audit` checks a finished free model. `uv_overlaps` compares each sampled face, not the bounding box around a cube's six faces, so one cube's face may sit in the gap of another's unfold. `uv_outside` names a face past `resolution`. `disconnected` names a cube touching nothing (pass `detached` for a part meant to float). `bone_cycles` names a loop in the outliner. `uv_density` names a face whose pixels-per-unit differ by more than 1.5x between the two axes. `coplanar_faces` names two axis-aligned cubes whose outer faces share a plane and overlap; offset one face. A rotated cube is not checked there, because its bounding box would report faces that do not touch. `box_uv_rects` is the six-face unfold of one `uv_offset`.

`bbmodel_maker.model.material_paint.paint_sheet(width, height, faces, frames=1)` paints those faces from a color and a material name (`metal`, `wood`, `stone`, `cloth`, `leather`, `gem`, `glow`, `bone`, `scale`, `flat`). `glow` is the only material that grows a vertical frame strip. `paint_face` paints one rectangle.

`bbmodel_maker.gates.gatekit.AssetGates` checks orphans, overflow, degenerate cubes, floating cubes, interpenetration, seating, and mirror. `animgate.AnimGates` checks ground contact, foot slip, seams, overlap, chain breaks, and balance. A gate answers whether a defect is present. It does not answer whether the model looks right. `gates.manifest.roll_call` checks a hand-written feature list. `mirror_x` defaults to `0`. A model shifted into block space (`x` and `z` plus 8) before saving is reported as entirely on the right.

`bbmodel-contact-sheet MODEL` writes a six-view sheet and then stops. Flags: `--manifest`, `--no-manifest`, `--gates MODULE`, `--prev`, `--size`, `--shading lambert|mc`, `--out`. Show that PNG to the user before another modeling pass.

`bbmodel-armor-preview MODULE --slot head|chest|...` puts an armor generator on a player. `--coverage` reports uncovered body. `--grey` drops the face. `--no-render` writes the model only.

Every `.bbmodel` this library writes is `format_version` `"4.10"`. Do not write any other version, and do not convert a file between versions. Bones stay inline in `outliner`.

`bbmodel-to-pose FILE --anim NAME` prints the pose table. `--tick` selects one frame. The default reads generator write-side signs. `--assume blockbench` reads a file Blockbench itself saved. Read and write layers are not inverses; use the signs in Build. A preview of either file turns the stored degrees and does not negate again.

`bbmodel-to-geckolib FILE --out-dir DIR --name NAME` drives web Blockbench through Playwright and needs the `geckolib` extra. Do not claim a `.geo.json` without that command exiting 0. This is the only path that opens a browser.

A `.bbmodel` is the project, not the game file. Bedrock geometry, the texture, and `.animation.json` ship separately. A `.particle.json` is a Bedrock effect, not a cube in the model. This library does not write particle files or Hytale projects.

If the user asked for PBR, the color texture must still read on its own. MER is R metalness, G emissive, B roughness. A normal map is tangent-space OpenGL, +Y up, and a flat texel is about `(128, 128, 255)`. A heightmap is grayscale, mid-gray `128`. Pack those images beside the model. Do not start Substance or an MCP paint session.

## Done

The `.bbmodel` is on disk at `format_version` `"4.10"`, and a render or a gate from this skill exited 0 in this turn. A gate list with no failing line passes only the gates that ran. A render PNG is not a game-ready export.
