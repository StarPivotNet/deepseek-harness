# Agent Note: Marketplace Discover tab waits on Plugins slot declaration

Status: implemented

English | [中文](2026-09-05-marketplace-tab-waits-on-plugins-declaration.zh.md)

## Problem

The in-box marketplace browser half contributed its Discover page to `settings.plugins.tab` with a bare `ctx.slots.register` inside `ctx.effect`. That slot exists only as a child of the Plugins settings section. When the marketplace Loader entry activated first, register threw `slot "settings.plugins.tab" is not declared (a parent entry's children table must declare it)` and the whole marketplace fiber failed to apply.

## Decision

The Discover tab uses `ctx.slots.inject('settings.plugins.tab', …)` the same way the inventory tab does. Injection waits for the Plugins section to declare the slot, re-registers across declaration replacement, and leaves with the marketplace fiber. The contribution still omits a `children` table: Discover does not render `settings.plugin.item`, and a second declaration of that nested slot would collide with the configurable tab.

Slot-level wait is the general rule in [slot declaration injection](../architecture/2026-08-05-slot-declaration-injection.md). The marketplace still joins Plugins as tabs under [in-box plugin catalog and marketplace](../feature/2026-08-18-in-box-plugin-catalog-and-marketplace.md).

## Alternatives considered

**Order the marketplace Loader row after `ui-settings-plugins` in the web patch.** Rejected because client manifest `inject` rows do not sequence activation, and a later reload can invert order while both services remain mounted.

**Declare `settings.plugins.tab` from `ui-settings`, the SlotMap owner, as a root child.** Rejected because the Plugins section owns the tab chrome; the slot exists only while that section is mounted.

**Keep the bare `register` and catch the undeclared-slot error.** Rejected because a missed declaration is a broken composition, and catching it would hide a real missing Plugins section.

## Testing

`packages/client/ui-settings-plugin-marketplace/tests/client/browser-plugin.client.spec.tsx` mounts the browser half with no tab declaration, asserts zero entries, then declares `settings.plugins.tab` from a parent children table and requires the `discover` contribution. Removing the declaration drops the tab; replacing it restores the same component; disposing the marketplace fiber removes it.

## Consequences

A web profile no longer fails the marketplace Loader entry when that fiber boots before the Plugins section. Discover appears once the section declares the tab slot.
