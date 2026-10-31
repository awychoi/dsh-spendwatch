# Spendwatch

**A DeepSeek Harness plugin that keeps your DeepSeek balance and what each conversation costs in view.**

Spendwatch is an add-on for **DeepSeek Harness (DSH)**. Once installed, it puts the money where you're already looking:

- **Your balance** — in the left sidebar, with a live **peak / off-peak** marker and a countdown to the next pricing flip.
- **What each workspace has spent** — right on the workspace row, archived sessions included.
- **What this conversation has spent** — in a pill under the message box, subagents included.

They move on their own while you work, so you can watch the wallet drain without keeping the DeepSeek platform open in another tab.

![Stylized vector illustration of Spendwatch inside DeepSeek Harness: workspace totals in the sidebar, the balance with its peak/off-peak countdown, and the session spend under the composer](docs/preview.svg)

## Where things are

| Where | What you see | What it does when you touch it |
|---|---|---|
| Left sidebar, at the bottom (above **More**) | `Balance $10.64` | Hover for the all-time estimate and how many sessions it covers. Click to refresh now. |
| Under the balance | `● Off-peak · ends in 2h 22m` | DeepSeek's current pricing window, with a live countdown to the next flip. Hover for the flip time in your local clock. |
| On each workspace row, right-aligned | `~$1.28` | Estimated spend for every session in that workspace — archived sessions included. Hover for the workspace name and the figure. |
| Left sidebar collapsed to the 56 px rail | a wallet icon | Hover — the tooltip still carries the balance and the estimate. |
| Under the message box, beside the context meter | `~$0.37 this session` | Hover for the split: the conversation's own spend, and the subagents it spawned. |

That's the whole plugin. No extra panels, no settings screen, no separate login.

## How it stays current

- **The balance is re-read from DeepSeek** whenever a running conversation adds to its cost, when you come back to the window, and when you click the row. Nothing polls while you're idle.
- **The session figure follows the tokens** each model call reports, so it moves as replies and tool calls land — including work done by subagents.
- **A forked conversation** is billed only for what it did after the fork, not for the history it inherited.
- **The pricing marker** follows DeepSeek's schedule — peak is 01:00–04:00 and 06:00–10:00 UTC, on weekdays in Beijing time; weekends and Chinese public holidays are off-peak all day. It re-evaluates every 10 seconds from the price book described below.
- **Workspace totals** come from the same durable fold, attributed through the official workspace registry's membership (`workspace.sessionIds`, with a cwd fallback for unowned sessions), so archived sessions count. Sessions running now add their live spend on top of the last fold.

## What the numbers are (and aren't)

- The **balance** is the real wallet: whatever DeepSeek's API last told us.
- The **spend** is an **estimate**: tokens × DeepSeek's published list prices, including peak/off-peak and cache-hit/miss rates. It is not a billing record.
- Expect small differences. Unpriced models are skipped, Search/Fetch per-request fees are not modelled, and DeepSeek's ledger can settle after the fact. **Don't reconcile an invoice with it.**
- Chinese public holidays are modelled through 2026 as off-peak all day; the 2027 dates need adding when the State Council announces them.
- Spendwatch is provided **as-is, without warranty** — it makes no promise of accuracy, completeness, or timeliness. Use it at your own risk.

## Pricing data

Windows, rates, and holidays live in [`pricing.json`](pricing.json) as a versioned book. Each period carries a `from` instant, the weekday rule, the UTC windows, and the rates in force from then, so history keeps the prices that applied when it happened. The Host validates the file at startup and serves it at `/plugins/spendwatch/pricing` for the Client.

To update, add a period with the new rates/windows and its effective `from`, then restart DSH. The JSON is the whole update path — no build, no automation. Some of this may be automated by editing and committing the file manually or with an agent; the plugin simply reads it on startup. The Chinese holiday list is a short array; add next year's dates when they are announced.

## Compatibility

Built against **DSH 0.2.x**. Spendwatch has no build step, no npm dependencies, and stores nothing of its own.

- It rides DSH's extension surfaces: the plugin bundle format, the `sidebar.footer.action` and `conversation.composer.dock` slots, the `sessionProjections` seam, and the `sessionQuery` / `workspaceRegistry` services. A release that renames one of those will need a matching update.
- It degrades instead of breaking: without `sessionQuery` the spend figures are unavailable but the balance still works; without `workspaceRegistry` (or `useWorkspaces`) the workspace badges are skipped; without `deepseekAccount` it falls back to `DEEPSEEK_API_KEY`. Each slot entry sits behind a crash boundary, so a render error falls back to the shipped UI rather than blanking it.
- The **workspace badges are the least stable piece.** DSH has no per-workspace slot, so they attach to the shipped row through `data-row-key`. If a release changes that attribute, the badges disappear and nothing else is affected.
- After a DSH update, reload the page (client half) and restart DSH (Host half), then check the three surfaces: sidebar balance, workspace totals, composer pill.

## Install

1. In DSH, open **Plugins → Install**.
2. Choose **Git repository** and enter:

   ```
   https://github.com/awychoi/dsh-spendwatch
   ```

3. Restart DSH when prompted.

Spendwatch reads the wallet through your signed-in DeepSeek account, or through the `DEEPSEEK_API_KEY` credential if you use API keys. The key and any account token stay on the host and never reach the browser.

## Uninstall

Remove **Spendwatch** from DSH's plugin list and restart DSH. Nothing else is stored.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free to use, change, and share for **non-commercial purposes only**. The software comes as-is, with no warranty and no liability, to the extent the law allows.

Copyright © 2026 [awychoi](https://github.com/awychoi).

Not affiliated with DeepSeek.

---

## Technical notes

<details>
<summary>How it works, for the curious</summary>

**Host** ([`index.js`](index.js))

- Registers the `deepseekSpend` session projection: a pure fold over each session's `assistant/message` usage records, priced from [`pricing.json`](pricing.json) — the period in force at each event's timestamp, so windows, weekday rule, holidays, and rates all follow the book.
- Skips events below a session's `inheritedEventCount`, so fork-inherited history is never priced twice. `stateVersion: 3` invalidates checkpoints written by the earlier pricing and fork states.
- Loads and validates the price book at startup; a malformed or missing file falls back to the bundled copy.
- Serves three read-only routes on the DSH Web server:
  - `GET /plugins/spendwatch/summary` — wallet plus the all-session estimate. The spend half is cached for 15 s; `refresh=1` bypasses it.
  - `GET /plugins/spendwatch/balance` — wallet only, no fold. Concurrent callers share one in-flight upstream read.
  - `GET /plugins/spendwatch/pricing` — the validated price book the Client renders its marker from.

**Client** ([`client.js`](client.js))

- Registers `sidebar.footer.action` (root scope) and `conversation.composer.dock` (session scope) through DSH's slot API.
- The sidebar fetches the price book from `/pricing` (bundled copy as fallback), computes the peak/off-peak marker from the period in force, ticks every 10 s, and renders the next flip as a countdown plus a local clock time in the tooltip. Holidays and the Beijing weekday rule are part of the book, so the marker matches the prices the Host charged.
- The Host folds spend per Workspace id (`byWorkspace` in `/summary`): each Session is attributed through `workspaceRegistry.list()` membership, the same account the sidebar renders, so archived Sessions keep their place; unowned Sessions (subagents, deleted registrations) fall back to their `cwd`. The Client adds only the post-fold delta for Sessions it has live projections for, then attaches the total to the shipped workspace row identified by `data-row-key="workspace:<id>"` — DSH has no per-workspace slot. If that attribute ever changes, the badges simply stop appearing; nothing else breaks.
- Both slot entries are wrapped in a crash boundary that logs the error and re-throws, so a render failure falls back to the shipped UI instead of abdicating silently with no trace.
- The sidebar sums every session's live `deepseekSpend` from the root `useSessions` snapshot. The client receives control frames for every session whether or not its conversation is open, so background sessions and subagents count. When the sum rises it pulls `/balance`: debounced 200 ms, single-flight, with one queued trailing pull.
- The composer pill sums the current session's own view with every descendant marked `origin: "subagent"`, recursively. A subagent this app run has never loaded falls back to the `/summary` `bySession` fold.
- The wallet row sits above the host's existing footer action via a scoped `:has()` wrap; the collapsed rail shows the icon only.

**Files**

| File | Role |
|---|---|
| `index.js` | Host half: projection + routes |
| `pricing.json` | Versioned price book: windows, weekday rule, holidays, rates |
| `client.js` | Client half: sidebar row + composer pill |
| `cordis.patch.yml` | Registers the bundle in a DSH profile |
| `locale/en.json`, `locale/zh.json` | Plugin-manager title and description |
| `icon.svg` | Plugin icon |
| `icon-white.svg` | Solid-white website icon for dark backgrounds; exported as `./icon-white` |

Both icons are transparent SVGs. `icon-white.svg` is a single-color mark for dark backgrounds and is not used by the plugin manager.

</details>
