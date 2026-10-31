# <img src="icon.svg" width="36" height="36" alt="" align="absmiddle"> Spendwatch

**A DeepSeek Harness plugin that keeps your DeepSeek balance and what each conversation costs in view.**

Spendwatch puts the wallet, workspace totals, and current-conversation spend
where you are already looking. It reads the same DeepSeek account DSH uses, so
there is no extra login or settings screen.

![Stylized vector illustration of Spendwatch inside DeepSeek Harness: workspace totals in the sidebar, the balance with its peak/off-peak countdown, and the session spend under the composer](docs/preview.svg)

## What you get

- **Your balance** in the left sidebar, with a live peak / off-peak marker and
  a countdown to the next pricing flip.
- **Workspace totals** on each workspace row, archived sessions included.
- **Conversation spend** in a pill under the message box, subagents included.

## How it stays current

The balance is re-read when a conversation adds spend, when you return to the
window, or when you click it. It does not poll while idle. Session totals follow
the usage each model call reports, and a forked conversation is billed only for
what it did after the fork. Workspace totals add live sessions on top of the
durable fold, so archived sessions still count.

The peak / off-peak marker is derived from the same price book the Host uses,
re-evaluates every 10 seconds, and includes the Beijing weekday rule and Chinese
public holidays.

## Accuracy

- The **balance** is the real wallet value last returned by DeepSeek.
- The **spend** is an estimate: tokens × published list prices, including
  peak/off-peak and cache-hit/miss rates. Unpriced models are skipped, and
  Search/Fetch per-request fees are not modelled.
- Chinese public holidays are covered through 2026; add the 2027 dates when they
  are announced.
- Do not reconcile an invoice with Spendwatch. DeepSeek's ledger can settle
  after the fact.

## Technical notes

Built against DSH 0.2.x; the host-coupling notes below are the parts most likely to need attention on upgrades.

- **Fork accounting:** the Host fold skips events below a session's
  `inheritedEventCount`, so inherited history is not billed twice.
- **Host coupling:** DSH has no per-workspace slot, so workspace totals attach
  to the shipped row through `data-row-key="workspace:<id>"`; the wallet row
  sits above the footer action through a scoped `:has()` wrap. If either host
  detail changes, only that surface disappears.
- **Failure isolation:** the sidebar and composer entries each sit behind a
  crash boundary. Missing optional services degrade individually — no
  `sessionQuery` drops spend figures, no `workspaceRegistry` drops workspace
  badges, and no `deepseekAccount` falls back to `DEEPSEEK_API_KEY`.
- **Pricing book:** the Host validates `pricing.json` at startup and serves it
  to the Client, falling back to the bundled copy if the file is malformed or
  missing. To update rates or holidays, add a period with its effective `from`
  instant and restart DSH.

## Install

1. In DSH, open **Plugins → Install**.
2. Choose **Git repository** and enter
   `https://github.com/awychoi/dsh-spendwatch`.
3. Restart DSH when prompted.

The wallet is read through your signed-in DeepSeek account, or through
`DEEPSEEK_API_KEY` if you use API keys. The key and account token stay on the
Host and never reach the browser.

## Uninstall

Remove **Spendwatch** from DSH's plugin list and restart DSH. Nothing else is
stored.

## Assets

`icon.svg` is the plugin icon. `icon-white.svg` is the transparent solid-white
mark for dark backgrounds. Exported as `./icon` and `./icon-white`.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free to use, change, and share
for **non-commercial purposes only**. The software comes as-is, with no warranty
and no liability, to the extent the law allows.

Copyright © 2026 [awychoi](https://github.com/awychoi).

Not affiliated with DeepSeek.
