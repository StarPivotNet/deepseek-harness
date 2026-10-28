---
name: nukkit-mot-plugin-dev
description: "Use when writing a Nukkit-MOT Java plugin: plugin.yml, MOT-SNAPSHOT API, commands, forms, DDUI, custom block or item, scoreboard, or PyRpc. Not minecraft-build and not Blockbench."
license: MIT
metadata:
  author: OpenCode
  version: 1.4.1
---

# Nukkit-MOT Plugin Development

When developing or modifying a Nukkit-MOT (MOT-SNAPSHOT) Java plugin, follow this skill's constraints and workflow.

The plugin project and this skill directory are not the same place. The plugin project is the repository you are changing. Package layout, names, config keys, and permission nodes follow that project. This skill directory contains only this `SKILL.md`. When an API is uncertain, use the matching document in References at the end.

## North star

- Follow the plugin project's existing conventions (package layout, names, config keys, permission-node names). Do not ship a change that looks cleaner and breaks compatibility.
- For any change that touches player data or a destructive action, find the existing guard first (permission, state machine, or game-phase check). Do not bypass it.
- Player-facing and admin-facing interaction stays controllable: clear permission checks, migratable config, and text through i18n.
- Follow Nukkit-MOT thread and scheduler rules. Writes to the world, inventory, or entities belong on the main thread, as the official guide describes.
- Do not write a complex or high-risk API from memory. Read the matching official document in References, then code.
- The plugin project must load, debug, and ship: `plugin.yml` metadata, lifecycle, dependency declarations, the build artifact, and the README are part of the delivery.
- A running build comes first. Before you submit runnable code, complete one local compile check (for example `mvn -q -DskipTests package`) and confirm resources are packaged.

## Workflow

1) Match the plugin project as it is

- Find an existing implementation of the same kind of feature and reuse its conventions, especially GUI, inventory, event listeners, and data structures.
- Before you add or change any command, check the command registration channel (see `Hard constraints -> Command registration`).
- Before you change the plugin entry, dependencies, resources, or the release jar, check that `plugin.yml` is still at the jar root and that its metadata is correct.
- Before you call an API from a dependency under `lib/`, check the version and method signature so runtime stays compatible.
- When Nukkit-MOT API or internal behavior is uncertain, read the matching document in References. Mark a field the document does not describe as uncertain. Do not invent a local core mirror that does not exist.
- Check only the topics this change touches. Leave the rest closed.

2) Implement to Nukkit-MOT conventions

- Prefer `FormResponseHandler` for form responses (see `Hard constraints -> Form handling`).
- When the UI must keep syncing state after it opens, evaluate DDUI first. For a one-shot submit, keep using `FormWindow*`.
- For player data or a destructive action: check permission and state first. A client UI limit is not enough.
- When you change a player inventory, handle the edges: full inventory, stack rules, drop fallback, and an explicit message.
- Keep reads and writes of `Level`, chunks, blocks, entities, players, and inventories on the main thread. Put slow I/O and heavy computation on async, and switch back to the main thread before applying the result.

3) Finish and verify

- When the config shape changes, provide defaults and comments, and consider migrating old config.
- When you add player-visible text, route it through i18n and keep placeholders consistent.
- Submit after the local compile check passes. Add a minimal reproduction and regression steps when they are needed.

## Hard constraints

### Maven baseline

A Nukkit-MOT plugin uses the official Maven coordinates unless the target repository already uses Gradle or ships its own parent POM.

Repository (`pom.xml`):

```xml
<repositories>
  <repository>
    <id>repo-lanink-cn</id>
    <url>https://repo.lanink.cn/repository/maven-public/</url>
  </repository>
</repositories>
```

Dependency (`pom.xml`):

```xml
<dependencies>
  <dependency>
    <groupId>cn.nukkit</groupId>
    <artifactId>Nukkit</artifactId>
    <version>MOT-SNAPSHOT</version>
    <scope>provided</scope>
  </dependency>
</dependencies>
```

`scope` is `provided`. Do not package the Nukkit server into the plugin jar.

### Plugin metadata and lifecycle

`plugin.yml` lives at `src/main/resources/plugin.yml` and, after packaging, at the jar root.

Required fields:

- `name`: plugin name, and the default data-folder name.
- `main`: fully qualified entry class. It must match the Java package and class name exactly.
- `version`: plugin version string. Quote it.
- `api`: supported Nukkit API versions. A starter or ordinary plugin commonly uses `["1.0.0"]`.

Lifecycle:

- The main class extends `PluginBase` and does not live under the `cn.nukkit.*` package.
- Do not put startup logic in the constructor. `onLoad()` does early lightweight init. `onEnable()` registers listeners, commands, tasks, and recipes. `onDisable()` saves state and releases resources.
- `depend` is a hard dependency; a missing one keeps the plugin from loading. `softdepend` is optional; code checks whether that plugin is present.
- `load` defaults to `POSTWORLD`. Use `STARTUP` only when the feature truly needs early registration, such as a custom block.
- Before release, keep the `pom.xml` version and the `plugin.yml` version the same.

### Command registration

Do not register the same command in both `plugin.yml` and code. Confirm which channel the plugin project already uses before you implement.

- Way A is `plugin.yml` only: declare the command under `commands:`. Code implements the command and does not register it again through the command map.
- Way B is code only: register the command in code through the command map or registration API. `plugin.yml` does not declare that same command.
- Way C, `cn.nukkit.command.SimpleCommandMap#registerSimpleCommands(Object)`, and way D, a custom `Command` plus `ParamTree`, are APIs inside the code channel. They are not extra channels beside A and B, and they do not depend on declaring the same command in `plugin.yml`.
  - Way C: annotate the method with `@cn.nukkit.command.simple.Command`. The signature is `boolean method(CommandSender sender, String commandLabel, String[] args)`. A method without that annotation is not registered.
  - Way D fits typed parameters, overloads, and target selectors. After `commandParameters` is set, call `enableParamTree()`.

Before you add or change a command:

- Search `plugin.yml` for an existing declaration of that command.
- Search code for the same command already registered through `SimpleCommandMap` or `plugin.yml`.
- When both channels would register it, follow the plugin project's existing channel. Do not mix the two mechanisms.
- When `ParamTree` is enabled, override `execute(CommandSender, String, Map.Entry<String, ParamList>, CommandLogger)` that returns `int`: `0` is failure, `1` or greater is success. The old `boolean execute(CommandSender, String, String[])` throws `UnsupportedOperationException` by default, and dispatch no longer uses it.
- `CommandParamType.TARGET` supports `@a`, `@e`, `@p`, `@r`, `@s`, `@initiator`, and common selector arguments. Check for an empty target before handling the result.

### Form handling

Nukkit-MOT forms are Modal, Simple, Custom, and Dialog. Handle the response with `FormResponseHandler` or the form's own handler:

- Do not keep a manual map from form id to callback or player state.
- Bind response handling to the form instance so concurrency, disconnects, and repeated opens do not scramble state.
- When the form changes permission, economy, or items, re-check player state and permission inside the response callback.
- Each handler checks `form.wasClosed()` first. Read Custom form elements with the correct index and typed API.
- A Dialog form binds a non-player entity. For scrolling text, use `ScrollingTextDialog`.

Implementation detail follows the official form guide: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/form>

### DDUI handling

DDUI is Data-Driven UI. Use it when the screen must keep syncing server state while it is open. A traditional `FormWindow*` fits a one-shot submit.

- The public surface to prefer now is `CustomForm` and `MessageBox`.
- `DataDrivenScreen#show(player)` opens the screen. Opening another DDUI for the same player replaces the active screen.
- `Observable<T>` is the binding layer. Common types are `Observable<String>`, `Observable<Boolean>`, and `Observable<Long>`.
- A default `Observable` is read-only to the client. Client writes use `ObservableOptions.builder().clientWritable(true).build()`, and you validate the written-back data. `ObservableOptions` has no boolean constructor.
- `textField`, `toggle`, `slider`, and `dropdown` sync values immediately. `button` is a separate click action. `CustomForm` has no whole-form submit callback.
- DDUI targets newer Bedrock protocol. On a low-protocol or multi-version server, measure callback and close-cleanup behavior.
- Re-check economy, permission, items, and world edits inside any DDUI callback.

### Thread and scheduler boundary

- Treat `Player`, `Entity`, `Level`, chunks, blocks, inventories, windows, and most event dispatch as main-thread APIs.
- An async task does file I/O, database, network, compression, pure computation, or JSON/YAML/NBT conversion.
- An async task does not hold live objects such as `Player` or `Level` for long. Copy pure data (`UUID`, world name, coordinates) before scheduling, and look the object up again after returning to the main thread.
- Prefer a scheduler API that takes the plugin as owner. When you need a completion callback, `AsyncTask#onCompletion(Server)` returns to the main thread.
- A `NukkitRunnable` instance schedules once. A restart needs a new instance.

### Custom block registration

A custom block is stricter than an ordinary plugin feature:

- The server root must contain Bin_Data `bin/` data files, or custom block registration fails.
- The plugin sets `load: STARTUP` in `plugin.yml`, because a custom block must register before `CustomBlockManager.closeRegistry()`.
- A custom block id is at least `10000`. The identifier uses `namespace:block_name`. Do not take the `minecraft` namespace.
- A stateless block uses `CustomBlock`. A stateful or property block uses `CustomBlockMeta` plus `BlockProperties`.
- Block textures in the resource pack go through `textures/terrain_texture.json` and `textures/blocks/`. Item textures go through `item_texture.json` and `textures/items/`.

### Custom recipe registration

Register a custom recipe in `onEnable()` with `getServer().getCraftingManager().registerRecipe(recipe)`.

- Call `Item.registerCustomItem(...)` before a recipe references that custom item as an ingredient or a result.
- A `ShapedRecipe` shape is 1-3 rows, 1-3 characters per row, and every row the same length. Every non-space character exists in the ingredient map, and the map contains no unused character.
- `CraftingDataPacket` sends the shaped pattern to the client, but server matching mainly uses the output hash and aggregated ingredients. When grid position must be enforced, check it again in `CraftItemEvent`.
- A `ShapelessRecipe` ingredient list holds at most 9 entries. A single `Item` count may be greater than 1.
- Furnace, blast furnace, and campfire recipe meta matching has fallback semantics. Meta `0` can act as a variant fallback recipe.
- The current client recipe packet does not walk the blast-furnace and campfire recipe maps. Treat those as server processing rules. Do not rely on the client recipe book to show them.
- Smithing recipe ingredient order is equipment, material, template. The netherite upgrade template path copies the input equipment NBT and keeps damage against the new item's max durability.
- Do not rely on `priority` to override a vanilla recipe. Replacing or removing a vanilla recipe means understanding both the server match map and the client broadcast cache, and calling `rebuildPacket()` when needed.

### Custom enchantment persistence

Register a custom enchantment with `Identifier`. Do not use the `minecraft` namespace.

- Register early in the lifecycle (usually `onLoad()`), before you grant or read the enchantment.
- `Enchantment.register(enchantment, true)` can produce a custom enchanted book at the matching level. Do not assume it wires itself into the enchanting table or anvil.
- Ordinary item enchantment NBT currently stores numeric `id` and `lvl`. Plugin custom enchantments may share `Enchantment.CUSTOM_ENCHANTMENT_ID`. Do not distinguish several custom enchantments by numeric id alone.
- In a real project, also write the plugin's own NBT, lore, or metadata marker, and trigger behavior from an event listener.
- When a custom item does not match a built-in `EnchantmentType`, override `canEnchant(Item)` and allow it by exact `item.getNamespaceId()`.

### Runtime block state

`runtime_block_state` sits closer to Nukkit-MOT core and the runtime palette. It is not the first choice for an ordinary plugin.

- An ordinary plugin uses the custom block API and a resource pack, rather than editing core runtime block-state data.
- Only when the user explicitly asks for core-level compatibility or a runtime-state extension do you check the current official docs site for the implementation. When that site has no stable `runtime_block_state` page, mark the documentation gap. Do not fill in a core implementation from memory.
- Runtime block state also needs checks of protocol version, client resource pack, block-state serialization, and server palette init order.

### Scoreboard API

New code uses the current main API. Do not import the deprecated wrapper:

- Use `cn.nukkit.scoreboard.scoreboard.Scoreboard`, `IScoreboard`, and `ScoreboardLine`.
- Do not use the deprecated `cn.nukkit.scoreboard.Scoreboard`.
- A per-player private sidebar can be a `Scoreboard` you create and then `scoreboard.addViewer(player, DisplaySlot.SIDEBAR)`.
- Register a global objective through `getServer().getScoreboardManager()`. `addScoreboard(...)` overwrites an objective of the same name. Call `containScoreboard(name)` first.
- `FakeScorer` equality depends on the text. Several blank or separator lines need different strings.
- `PlayerScorer` depends on the player being online. Offline network info may be `null`. Pure text and offline-safe labels use `FakeScorer`.
- Manager-level display has to maintain viewers. `manager.setDisplay(...)` does not apply to every player by itself.
- Treat scoreboard updates and display switches as main-thread work. After a large rebuild, call `resend()`. When persistence is required, call `manager.save()` explicitly.

### PyRpc / NetEase integration

PyRpc is the NetEase client Python-script RPC channel. It is not a general Bedrock UI or API.

- It is available only on a NetEase protocol session. To let NetEase players join, turn on `netease-settings.client-support` in `nukkit-mot.yml`. Turn on the sibling `only-allow-netease-client` only when the server allows NetEase clients alone. The old top-level key `netease-client-support` migrates into this nested key.
- `Player#sendPyRpcData(...)`, `sendPyRpc(...)`, and `modNotifyToClient(...)` return `false` when the player is not a NetEase version. Check the return value.
- Prefer `modNotifyToClient(...)` for an ordinary server-to-client Mod event. Prefer listening to `PlayerNetEaseModEventC2SEvent` for an ordinary client-to-server Mod event.
- Listen to `PlayerNetEasePyRpcReceivedEvent` when you need every decoded PyRpc message. Cancelling the general event stops later specialized events from dispatching.
- Use a raw payload or API only when you already know the method name, argument shape, and MessagePack payload.
- Register a custom typed codec once, globally, with `PyRpcPacket.registerSubPacketCodec(...)`. Do not take a method name owned by Nukkit-MOT or another plugin.
- Do not trust client `eventData`. Check modName, systemName, customEventName, argument types, size, permission, and player state.
- Keep a PyRpc payload small and simple. Decode rejects or returns null for an empty payload, a payload over 64 KiB, a container over 1024 entries, or nesting over 32 levels.

## Conventions

### Java version

- Baseline: Java 17
- Allowed features: `record`, `sealed`, switch expressions, text blocks, instanceof pattern matching, `Stream#toList`, `HexFormat`
- Prohibited: preview features that need `--enable-preview`; JDK internal APIs (`sun.*`, `jdk.internal.*`)

### `lib/` dependencies

- Dependencies (third-party libraries, prerequisite plugins, and similar) generally live in `lib/`. A new dependency follows the existing placement and reference style.
- Before calling an API under `lib/`, check package name, class name, method signature, and version. Compare release notes when needed.
- Delete caches and temporary output produced while inspecting a dependency (extracted directories, decompiler output) after the API checks out, so they are not committed by mistake.

## Defaults

- Permission: set a permission node for admin or destructive actions, and check it before execution. A client UI limit is not enough.
- Config: configurable values go in a config file. Explain defaults and comments clearly. Stay compatible with old config, and migrate when needed.
- I18n: player-facing text goes through i18n. Do not hard-code a mix of languages. Keep placeholders consistent.
- Resource pack: a custom item, block, or entity needs a client resource pack. A pack bundled in the plugin lives at `src/main/resources/assets/resource_pack/`.
- README / release: a publicly released plugin states install steps, commands, permissions, config, dependencies, the Nukkit-MOT version that was tested, and known limits.
- Server config awareness: plugin behavior can depend on `server.properties` and `nukkit-mot.yml`. When debugging, check the related switches.

## Implementation notes

### Project structure and publishing

- Standard Maven plugin layout: `pom.xml`, `src/main/java/...`, `src/main/resources/plugin.yml`.
- Before local debugging, start a clean server once so it generates `plugins/`, `worlds/`, and config files.
- When a plugin fails to load, check first: `plugin.yml` missing from the jar root, `main` mismatch, jar not in `plugins/`, a missing hard dependency, or a forgotten rebuild.
- When debugging with an IntelliJ JAR Application run configuration, the working directory is the Nukkit-MOT server directory and the JRE is Java 17.
- Before release, on a clean server, delete the old jar, copy the new jar, start, and run `plugins` / `pl`. Confirm name and version.

### Permission

- Prefer ordinary permission nodes in `permissions:` inside `plugin.yml`, with `description` and `default`.
- `default` uses Nukkit-MOT permission-default semantics: `op`, `notop`, `true`, `false`.
- Check `hasPermission(String)` before a sensitive action. Do not rely only on `sender.isOp()` unless the feature is truly OP-only.
- When code registers a permission dynamically, use `PluginManager#addPermission(new Permission(...))`, and consider `recalculatePermissibles()` when the permission structure changes.

### Event

- A listener implements `Listener`, marks methods with `@EventHandler`, and `onEnable()` calls `registerEvents(listener, plugin)`.
- Event listeners run on one thread. Do not do slow I/O or heavy computation inside an event.
- Higher priority runs later. `MONITOR` only observes the final result and does not modify the event.
- Use `ignoreCancelled = true` when cancelled events should be ignored. Otherwise check `event.isCancelled()` at the start of the handler.
- High-frequency events (move, interact, tick, packet send) return early, dedupe, and rate-limit.
- Whether `DataPacketSendEvent`, `BatchPacketsEvent`, and `EntityMotionEvent` fire depends on `call-data-pk-send-event`, `call-batch-pk-send-event`, and `call-entity-motion-event` in `nukkit-mot.yml`. A plugin that depends on those events states the config requirement in its troubleshooting notes.

### Config

- Prefer YAML for config files. Provide defaults on read so a missing or corrupt config does not crash.
- A simple dynamic shape can use `cn.nukkit.utils.Config` and `ConfigSection`. Read with typed methods such as `getBoolean()`, `getInt()`, and `getStringList()`.
- For a fixed schema that needs comments or nested groups, prefer the Nukkit-MOT bundled `okaeri-configs-yaml-snakeyaml`, declared `provided` / `compileOnly`.
- A hot reload can affect running state. After reload, update caches or construct the config object again.
- When the config shape changes, keep defaults, comments, and a migration for old keys. With Okaeri, `removeOrphans(true)` can drop obsolete keys.

### I18n

- In the plugin entry `onLoad()`, call `PluginI18nManager.register(this)` and initialize the default `LangCode` from the server language.
- Language files live at `src/main/resources/language/<LangCode>.lang`.
- Text keys use the plugin-name prefix. Argument placeholders use `{%0}`, `{%1}`.
- When sending a player a message, prefer `player.getLanguageCode()`. Logs and console text use the server language or clear English.

### Inventory

- An online player's inventory is `player.getInventory()`. The offhand is `player.getOffhandInventory()`.
- NBT slots and API slots differ. The main inventory `0..35` matches. Armor NBT `100..103` maps to API `36..39`. Offhand NBT is `-106`.
- After editing offline player data, call `Server#getInstance().saveOfflinePlayerData(uuid, playerData, false)`. An important online change can call `player.save()`.
- When the client does not sync after an inventory edit, call `sendContents(player)` or `sendSlot(slot, player)`.
- Inventory work runs on the main thread. Viewing or editing another player's inventory needs a concurrency and live-sync plan.
- Prefer FakeInventories for a GUI. A button-style GUI usually cancels the transaction event and turns it into a custom click callback.

### World

- In Nukkit-MOT the world object is `Level`. `Server#getLevelByName()` looks up the world folder name and returns only a loaded world.
- Before using a world, check and load: `isLevelLoaded(name)`, `loadLevel(name)`, `getLevelByName(name)`.
- Create a world with `Server#generateLevel(...)`. Generators come from `Generator.getGenerator("flat" / "void" / "normal" / "nether" / "the_end")`.
- The server can also predefine world generator, seed, and generator-settings under `worlds:` in `nukkit-mot.yml`. Before a plugin creates a world dynamically, check whether server config already manages that world.
- Do not hard-code the height range. Use `level.getMinBlockY()` and `level.getMaxBlockY()`.
- When reading a chunk, avoid generating terrain by accident. Prefer `getChunkIfLoaded()` or `loadChunk(x, z, false)`. Check `isChunkGenerated()` and `isChunkPopulated()` when needed.
- Before a cross-world teleport, the target world is loaded. Prefer `level.getSafeSpawn()` or a verified `Position`.
- A permanently loaded region uses `Server#getTickingAreaManager()`. A ticking area persists into the world directory.
- World, entity, and resource behavior can depend on `load-all-worlds`, `do-not-tick-worlds`, `entity-spawning-disabled-worlds`, `auto-save-disabled-worlds`, `spawn-animals`, `spawn-mobs`, `auto-save`, and similar settings.

### Block

- Read a block with `level.getBlock(...)`. Create a block instance with `Block.get(id[, meta])`.
- Set a block directly with `Level#setBlock(...)`. For a door, bed, or similar special block, try `Block#place()` first.
- To break a block and drop items, use `level.useBreakOn(pos, tool, player)`, not a plain set-to-air.
- Before a batch `setBlock`, check that chunks are loaded. A large batch can disable live updates and apply them together at the end.
- During a batch fill, call `block.clone()` at each position so instances are not shared.
- Before operating on a container block, check the block type and whether the `BlockEntity` exists.

### Item

- Always obtain an item with `Item.get(...)` or `Item.fromString("namespace:item")`. Do not `new ItemXxx(...)` directly.
- Prefer a namespace id (for example `minecraft:apple`) to reduce protocol and version drift.
- After editing NBT, call `item.setNamedTag(tag)` or the change does not apply. Check `hasCompoundTag()` before reading.
- When setting lore, custom name, enchantments, durability, or lock mode, account for client display and for move, drop, and craft limits.
- When giving a player an item, handle a full inventory, leftover items, a drop fallback, and player feedback.
- A custom item uses a fitting base such as `ItemCustom`, `ItemCustomTool`, `ItemCustomArmor`, or `ItemCustomEdible`.

### Custom content

- Custom item: extend a fitting `ItemCustom` base, override `getDefinition()` and stack, durability, and attack behavior, and register in `onEnable()` with `Item.registerCustomItem(...)`.
- Custom entity: extend the entity class, implement `CustomEntity`, define `EntityDefinition`, and register in `onLoad()` with `EntityManager.get().registerDefinition(...)`.
- Custom enchantment: see `Hard constraints -> Custom enchantment persistence`.
- Custom block: see `Hard constraints -> Custom block registration`.
- Custom recipe: see `Hard constraints -> Custom recipe registration`.
- Every custom content piece prepares both server registration and a client resource pack. Identifier, texture short name, geometry, and render controller match one to one.
- A pack bundled in the plugin uses `src/main/resources/assets/resource_pack/`. A standalone pack's archive root contains `manifest.json` directly.

### Resource pack troubleshooting

- Blank custom item: the short name in `item_texture.json` equals the texture name in code, and the image path is under `textures/items/`.
- Custom block not shown: check `terrain_texture.json`, `textures/blocks/`, Bin_Data, registration timing, and `load: STARTUP`.
- Custom entity not loaded: short names for identifier, materials, textures, geometry, and render_controllers in the pack's `entity/*.json` agree.
- After updating a resource pack, clear the client cache. A `.mcpack` is still a zip layout the client supports.
- When the server requires the client to download the pack, check `force-resources` and `force-resources-allow-client-packs` in `server.properties`.
- When a resource pack is encrypted, the archive root contains `manifest.json`. The matching `.key` file sits in `resource_packs/`. The key is 32 characters. Restart the server after changing it.
- Nukkit-MOT only passes the resource-pack key to the client. It does not encrypt or decrypt. Do not treat encryption as absolute protection.

Links for custom items, entities, enchantments, blocks, and recipes are in References at the end. Look up only the matching entry for the topic. When runtime block state has no stable doc page, mark the gap. Do not fill in a core implementation from memory.

## FakeInventory

Read this section only when changing a fake-container GUI. Open timing and packet fields follow the rules here.

`chestManager` is not a Nukkit API. Coordinates in examples come from the plugin's own tracking. Do not copy a class that does not exist.

Common problems:

1. A real block update overwrites the fake chest
2. Container open timing
3. Incomplete inventory tracking

- When placing or restoring a block, use `UpdateBlockPacket.FLAG_ALL_PRIORITY`. If it is still overwritten, intercept the real block-update packet.
- On intercept, listen to `DataPacketSendEvent` and cancel an `UpdateBlockPacket` for the fake chest coordinates at `EventPriority.HIGHEST`.
- Open: create the inventory, send the chest block and BlockEntity NBT, record tracking data, then after a delay (usually 3 ticks) send `ContainerOpenPacket` and `sendContents`.
- Close: clear tracking, `removeWindow`, then after a delay (usually 2 ticks) send packets that restore the real block. runtimeId uses `GlobalBlockPalette.getOrCreateRuntimeId(...)`.
- When the fake chest is a real placeable container, do not let `InventoryTransactionEvent` cancel `SlotChangeAction` by mistake.
- When the fake chest is a button-style GUI, cancel the transaction and use a custom click callback.
- Chest BlockEntity NBT uses little-endian network serialization: `NBTIO.write(tag, ByteOrder.LITTLE_ENDIAN, true)`.
- `windowId` uses `player.getWindowId(inventory)`. Container `type` uses `inventory.getType().getNetworkType()`.

```java
@EventHandler(priority = EventPriority.HIGHEST)
public void onPacketSend(DataPacketSendEvent event) {
    DataPacket packet = event.getPacket();
    if (!(packet instanceof UpdateBlockPacket)) {
        return;
    }

    Player player = event.getPlayer();
    Vector3 chestPos = trackedChestPosition(player);
    if (chestPos == null) {
        return;
    }

    UpdateBlockPacket updateBlock = (UpdateBlockPacket) packet;
    if (updateBlock.x == (int) chestPos.x &&
        updateBlock.y == (int) chestPos.y &&
        updateBlock.z == (int) chestPos.z) {
        event.setCancelled();
    }
}
```

## Deliverables checklist

Check only the items this change touches. Do not add features just to tick an untouched topic.

- `plugin.yml` is at the jar root, and required fields `name` / `main` / `version` / `api` are correct
- Lifecycle is sound: the constructor does not start the plugin, `onEnable()` registers runtime features, `onDisable()` cleans up and saves
- Command registration channel is checked (`plugin.yml` and code do not both register the same command)
- Maven repository and `provided` dependency `cn.nukkit:Nukkit:MOT-SNAPSHOT` are configured
- Form interaction uses `FormResponseHandler`, and critical actions re-check permission and state in the callback
- DDUI use is confirmed, and a client-writable `Observable` is checked for type, permission, and state
- Destructive and admin actions have a permission node checked before execution
- Config and i18n follow the plugin project's conventions, including migration when needed
- World, entity, block, and inventory writes do not run directly on an async thread
- Custom blocks confirm Bin_Data, `load: STARTUP`, id >= 10000, and resource-pack layout
- Custom items, entities, enchantments, and recipes confirm registration lifecycle, identifier namespace, resource pack, recipe reference order, and persistence markers
- Scoreboard uses the new package names, with a clear viewer, manager, and persistence plan
- PyRpc is used only where NetEase client support applies, the return value is checked, and inbound data is validated
- Forced packs, encryption, and client-cache notes are written into the docs or troubleshooting notes
- Before release, the README covers install, commands, permissions, config, dependencies, compatible versions, and known limits
- Local compile check passes: `mvn -q -DskipTests package`
- A clean server start passes, and `plugins` / `pl` shows the correct name and version

## References

- Developer documentation index: <https://www.nukkit-mot.com/zh/docs/category/developer-documentation>
- First Java plugin: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-basics/frist_java_plugin>
- Plugin basics: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-basics/plugin-basics>
- Run and debug a plugin: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-basics/debug_plugin>
- Publish a plugin: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-basics/publish_first_plugin>
- Commands: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/command>
- Permissions: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/permission>
- Scheduler: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/scheduler>
- Config: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/config>
- Events: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/event>
- Worlds: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/world>
- Blocks: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/block>
- Items: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/item>
- Inventory: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/inventory>
- Forms: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/form>
- DDUI: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/ddui>
- Scoreboard: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/scoreboard>
- I18n: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/i18n>
- PyRpc: <https://www.nukkit-mot.com/zh/docs/developer-guide/guides/pyrpc>
- Custom items: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-extras/custom/custom_item>
- Custom entities: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-extras/custom/custom_entity>
- Custom enchantments: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-extras/custom/custom_enchantment>
- Custom blocks: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-extras/custom/custom_block>
- Custom recipes: <https://www.nukkit-mot.com/zh/docs/developer-guide/tutorial-extras/custom/custom_recipe>
- server.properties: <https://www.nukkit-mot.com/zh/docs/user-guide/server-config/server-properties>
- nukkit-mot.yml: <https://www.nukkit-mot.com/zh/docs/user-guide/server-config/nukkit-mot-yml>
- Resource pack encryption: <https://www.nukkit-mot.com/zh/docs/user-guide/server-config/resourcepacks-encryption>
