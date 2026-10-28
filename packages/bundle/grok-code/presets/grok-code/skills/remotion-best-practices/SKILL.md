---
name: remotion-best-practices
description: Router for all Remotion skills
version: 4.0.538
---

The domain files are `<skill_base>\library`. Read `<skill_base>\library\<name>\SKILL.md` with `file_read`. Do not call `skill` for `remotion-create`, `remotion-markup`, `remotion-captions`, `remotion-maps`, `remotion-multimedia`, `remotion-interactivity`, `remotion-render`, `remotion-studio`, `remotion-saas`, `remotion-docs`, or `remotion-upgrade`. Those names are files in this skill, not catalog entries.

## Preserve user changes

Users may make edits in the code outside of the conversation.

If you detect a surprising change made in the meanwhile, don't overwrite it, assume it was intentional or ask for confirmation.

## Creating a video

If the user asks to make, create, or build a new video or composition, read [Create a new Remotion video](library/remotion-create/SKILL.md), whether or not a Remotion project already exists.

## New project setup

If no Remotion project currently exists, read [Create a new Remotion project](library/remotion-create/SKILL.md)

## React Markup Best Practices

If you are writing Remotion React Markup, read [Remotion Markup Best Practices](library/remotion-markup/SKILL.md)

## Maps

For static maps, animated routes and markers, geographic explainers, Mapbox, MapLibre, MapTiler, GeoJSON, or 3D geographic flyovers, read [Remotion Maps](library/remotion-maps/SKILL.md).

## Multimedia

For achieving multimedia tasks in the browser, such as trimming, cropping videos, or getting metadata from them, read [Remotion Multimedia](library/remotion-multimedia/SKILL.md)

## Improving Interactivity

By structuring the Remotion markup well, we can allow users to interactively change things in the Studio and write back to code. If relevant: [Interactivity Best Practices](library/remotion-interactivity/SKILL.md)

## Open the preview

If the user asks to "make" a video, "create" a video, etc.
Don't render the video by default unless they are very explicit. They want to instead see an interactive preview.
As soon as the project can run, start Studio and open the preview in the browser before building or editing the composition. Keep it open while you work so the user can watch progress and steer.

### If you are using Cursor

Run Studio without `--no-open` so it opens the browser automatically:

```bash
npx remotion studio
```

### If you are using another agent client with an in-app browser

You can use the command above to let Studio open the browser, or run:

```bash
npx remotion studio --no-open
```

This will start a long-running process and print the server URL for the preview.  
If the server is already started, it will print the URL.
If you use `--no-open`, open the exact printed URL in the in-app browser and verify that Studio loads. Once a composition exists, verify that its video preview loads. If you cannot open it there, run Studio without `--no-open`.
You can visit a specific composition by navigating to `/[composition-id]`, for example `http://localhost:3000/MapAnimation`.

:::note
The Studio supports WebMCP tools.
:::

### If you do not have an in-app browser

This will open the Studio in the browser or refocus it if it is already open.

```bash
npx remotion studio
```

### More options

To launch a project in Remotion Studio, open its exact local URL, or configure Studio CLI flags, read [Remotion Studio](library/remotion-studio/SKILL.md).

## Render the video

Only render if the user is very explicit in asking for it.  
E.g. "Render the video", "Export", "Give me the MP4".

The preview also has a more intuitive rendering interface, so consider using it instead of the command line for rendering.

```
npx remotion render
```

For more options, see [Rendering](library/remotion-render/SKILL.md).

For advanced rendering beyond simple `npx remotion render`, see: [Rendering Best Practices](library/remotion-render/SKILL.md)

## Captions

When working with Captions, read [Remotion Captions](library/remotion-captions/SKILL.md).

## Creating a SaaS, automation or application

Read [Remotion SaaS](library/remotion-saas/SKILL.md) for knowledge about Remotion-powered SaaS apps, such as `<Player>`, rendering on Lambda, Vercel, Cloudflare, via Express.js, client-side rendering, or for finding the right SaaS template.

## Looking up Remotion APIs and documentation

To find and read current Remotion documentation, read [Remotion Docs](library/remotion-docs/SKILL.md).

## Upgrading

To upgrade Remotion, related packages, compatible Mediabunny packages, and installed Remotion Agent Skills, read [Remotion Upgrade](library/remotion-upgrade/SKILL.md).
