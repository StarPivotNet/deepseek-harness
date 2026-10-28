---
name: frontend-design
description: "Use for distinctive visual design when building or reshaping a web UI: aesthetic direction, typography, palette, layout, and copy. Not a module interface (`codebase-design`), not a Remotion timeline, not music (`agi-music`)."
---

# Frontend design

Load this before writing or reshaping a web page's visual design. The brief's own visual direction wins, including when it asks for a look listed below as a common default.

## Ground it

Name the subject, the audience, and the page's primary job before choosing a look. Use known client preferences as hints. A toy for children and a dashboard for analysts do not share a visual language. Build with the brief's real content.

## Principles

The hero is the first thing viewers see. Open with the most characteristic thing in the subject's world: a headline, an image, an animation, a live demo, or an interactive moment. A big number, a small label, supporting stats, and a gradient accent is the default treatment. Use it only when it is the best option.

Use one type family, or two when they are clearly distinct. Do not reach for the same default families on every project. Set a type scale with intentional weights, widths, and spacing. When type is the visual element, the treatment itself carries the design. Keep lines under 80 characters. A serif body can run slightly longer and needs slightly more line-height than a sans-serif.

These typographic treatments read as generated:

- Accenting one word in a headline with italic, bold, or a different color.
- Labels in all caps.
- A label stacked above content that does not need one.

Outlines, borders, numbers, eyebrows, dividers, and labels encode information. They do not decorate. Numbered markers (`01`, `02`, `03`) belong only on a real sequence, such as steps or a timeline.

Use motion that nobody triggered only to draw attention. One page-load sequence or one reveal beats a fade-and-slide on every section and a hover on every card. Motion that answers an action is welcome when it shows what changed.

## Plan, then build

Work in two passes. First write a compact plan:

- Color: 4–6 named hex values.
- Type: the families and the role of each.
- Layout: one-sentence descriptions plus ASCII wireframes, including whether content is left aligned, center aligned, or justified.
- Principles: what makes this page specific.

Review that plan against the brief before writing code. If a part would fit any similar page, revise it and say what changed. These looks are legitimate for some briefs, but they are defaults when the brief did not ask for them:

1. Warm cream near `#F4F1EA`, a high-contrast serif, and a terracotta accent near `#D97757`.
2. Near-black with one acid-green or vermilion accent.
3. A broadsheet: hairline rules, zero border-radius, dense columns.
4. Identical rounded cards, one radius everywhere, the same soft shadow (`rgba(0,0,0,.1)`), and gradient washes.
5. Template chrome: a tracked all-caps eyebrow on every heading, meta joined by middle dots, labels shaped as `WORD — fragment`, tinted near-black standing in for black, monospace for small labels, and `→` appended to links and buttons.

After the plan is specific, write the code. `.section` and `.cta` are both class selectors. Equal specificity means source order decides which spacing wins.

## Restraint

Spend boldness in one place. Keep everything around that element quiet, and cut decoration that does not serve the brief. Meet the floor without announcing it: responsive down to mobile, visible keyboard focus, reduced motion respected, visually accessible contrast, and a harmonious palette. If the environment can capture the rendered page, review that image before calling the design done.

## Copy

Words make the design easier to understand. Write from the user's side: notifications, not webhook config. Describe what something does instead of selling it. Use active voice and sentence case. A control names the result: "Save changes", not "Submit". The same action keeps one name, so "Publish" produces "Published". An error says what happened and how to fix it. It does not apologize. An empty screen invites the next action. Each written element does one job.

## DSH

- Follow the repo's existing framework and visual system. This skill does not replace them.
- Write files with `file_write` or `file_edit`. Do not paste a full page into chat.
- A rendered page the user asked to receive is presented with `present`.
- Review a rendered PNG, JPEG, WebP, or GIF with `read_image`. Do not install an image library or make a thumbnail merely to inspect it.
- This skill chooses the visual plan and the page. It does not choose a module interface (`codebase-design`), a Remotion timeline (`remotion-best-practices`), or music (`agi-music`).
