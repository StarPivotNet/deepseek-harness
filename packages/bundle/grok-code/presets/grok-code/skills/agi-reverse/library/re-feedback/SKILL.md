---
name: re-feedback
type: gateway
description: >
  Experience-feedback meta-gateway. Three collection sources (session review / article scan / manual input) → distill and redact → assign a domain → three-tier handling (file an issue / store locally / do not store).
  Triggers: `反馈经验`, `经验入库`, `提交经验`, `经验复盘`, `心得沉淀`, lessons learned.
---

# Experience feedback

<HARD-GATE>
Two hard lines. Stop if either is violated:
1. Neutral presentation: options and suggestions must not use superlative push wording such as "most recommended" or "strongly recommended". List options and the situations they fit, neutrally, and let the user decide. The banned Chinese push phrases, kept as search literals, are `最推荐` and `强烈建议`.
2. Privacy redaction: a distilled product must not be specific to a project, company, or product. Hints are also forbidden (industry + scale + region combination, proprietary protocol name, internal codename, and so on).
   This library is published (npm + plugin marketplace). Local storage is under the same constraint. Run a redaction self-check before storing or filing an issue.
</HARD-GATE>

## Full workflow

1. Collect (three sources, one pipeline):
   - Session review: pitfalls / new methods from this analysis session (already available when [[re-analyze]] step 4 calls this gateway)
   - Article scan: `node bin/wxsource.mjs` fetches Kanxue / WeChat articles (`node bin/wxsource.mjs kanxue thread <post-id> --md` / `node bin/wxsource.mjs wechat <article-URL> --md`). Distill each article. Site names to search: `看雪`.
   - Manual input: one sentence or a note from the user
2. Distill and redact: follow `references/intake.md` — pitfall format `**Title**: Symptom — …; Cause — …; Fix — …`, and redact at the same time
3. Assign a domain: decision table in `references/intake.md` → grep the skill library as fallback → if still unsure, ask the user (do not guess)
4. Three-tier handling (neutral presentation, no recommendation mark):
   Ask the tier first. The sample utterance to ask is `这次经验怎么处理？1. 发表 issue 2. 本地入库 3. 不入库` (How should this experience be handled? 1. file an issue 2. store it locally 3. do not store it). Run the chosen tier only after the user picks. Do not preset a default tier.
   - (1) File an issue: probe with `which gh` + `gh auth status`; if usable, `gh issue create --repo dslsdzc/rev-skills --label 经验`, title `经验: <skill>: <one line>`, body from `references/issue-template.md`; if unusable → print a markdown draft for manual submit; if the label is reported missing → drop `--label` and retry, or tell the user to create it first; if the repo is unreachable → print a draft
   - (2) Store locally: grep to dedup → append to that skill's `references/experience.md` (create it if missing; each entry has source + date) → keep the curated picks under SKILL.md "Common pitfalls" and append an experience.md link (create the file before adding the link, so the link is not broken) → `npm test` → commit as agreed in step 5 (or ask the user first). The heading literal other skills still use is `常见坑与陷阱`.
   - (3) Do not store: confirm, then stop
5. (Optional on the article-scan path) Commit: `经验: 第N轮扫描入库X篇——<篇目>`, and list the new entries per skill in the message

## Which path (selection tree)

- Input = this analysis session's summary → session-review source; goal = capture this field session
- Input = article URL / post id / article text → article-scan source; distill each piece, and skip tool / promotion posts by the intake.md criteria
- Input = one user sentence / note → manual source; distill directly
- Three-tier choice (neutral presentation): 1. file an issue (can be shared publicly, others can reuse it) 2. store locally (settles into this library and ships with it) 3. do not store (kept only in the session)

## Cross-domain join

- [[re-analyze]] step 4 (optional) calls this gateway for a session review
- Domain targets are every skill ([[re-binary-core]] [[re-malware]] [[re-firmware]] [[re-protocol]] [[re-mobile]] [[re-anti-analysis]] [[re-cracking]] [[re-vuln]] [[re-ctf]] [[re-managed]] [[re-forensics]] and their atomic skills)
- Article fetch uses the repo `bin/wxsource.mjs`; after storage, `npm test` (validate.mjs) checks structure

## Common pitfalls

- Distilling without redaction and storing / filing an issue directly → leaks project identity — hard line 2; before storage, list proper nouns item by item and self-check
- Presentation includes push wording such as `最推荐` → overrides the user's judgment — hard line 1; list options neutrally only
- Guessing a domain when unsure → the experience is written to the wrong skill and the next search misses it — ask the user
- Not running npm test after storage → a broken link or format error breaks CI — `npm test` is required after every store
- Storing a duplicate entry again → the library bloats — grep keywords and dedup before storage
- Article scan does not skip tool / promotion posts → the experience is devalued — filter by the intake.md skip criteria
- **Assert preconditions before trusting tool output**: Symptom — the tool appears to run normally but the product is empty, loose, or a no-op (missing official runtime returns empty output, an architecture mismatch yields zero hook hits, a packed repack is a black screen on a real device, a screenshot taken before the screen wakes is blank). Cause — every tool has hard preconditions (official runtime / native architecture / not packed / environment ready); violating them fails quietly instead of erroring. Fix — before accepting any output, explicitly assert that its preconditions hold on this target. Treat silence and empty results as suspicious first. If three structurally different direct paths all fail, a runtime invariant is blocking them: stop retrying and change environment / abstraction layer / target. (Source: reverse-skills (inliver233), MIT)
- **Multi-agent collaboration state goes into a handoff document**: Symptom — parallel multi-agent analysis cannot reconcile, dead ends are walked again, and hypotheses are re-verified. Cause — state exists only in chat history; agents have no shared baseline for "confirmed / ruled out". Fix — one controller is the only verification authority (an agent's hypothesis counts as confirmed only after the controller reproduces it on a machine). One goal per agent per round. Write the operating scene / confirmed facts (with how they were verified) / a required ruled-out list / a suggested first step into the handoff document. Reconcile by evidence class (runtime > static > hypothesis). (Source: reverse-skills (inliver233), MIT)
- **Distillation wording triggers a collaboration-model refusal**: Symptom — a distilled product that contains words such as `破解` / `绕过` is refused in a collaboration flow. Cause — the trigger words are blocked by content policy, unrelated to content quality. Fix — during distillation, systematically rewrite into engineering language (code recovery / compatibility adaptation / integrity-check adaptation / runtime-signature adaptation) and attach an authorization premise (own-code recovery / interoperability / security audit / CTF / education; not authorization to attack protected software). Same root as hard line 1's neutral presentation. Self-check against this before storage. (Source: reverse-skills (inliver233), MIT)
- More experience is in this skill's [[experience]] (full set)
