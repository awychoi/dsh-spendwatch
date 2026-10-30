window.__ModuleLoader__.load({
  id: 'dsh-spendwatch',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'spendwatch'
    const ROUTE_PATH = '/plugins/spendwatch/summary'
    const BALANCE_ROUTE_PATH = '/plugins/spendwatch/balance'
const PRICING_ROUTE_PATH = '/plugins/spendwatch/pricing'
    const CLIENT_VERSION = '1.4.0'
    /** Coalesce same-tick updates (one turn can commit several Sessions' frames together). */
    const PULL_DEBOUNCE_MS = 200
    /** Minimum gap before a queued follow-up pull, so one turn cannot stampede the wallet API. */
    const PULL_TRAIL_MS = 750
    /** How often the peak/off-peak line re-evaluates. */
    const MODE_TICK_MS = 10_000

    /**
     * A crashing slot entry abdicates silently: the host's SlotErrorBoundary
     * retires this entry and elects the next one, and its error anchor unmounts
     * with it. Log the real error, then re-throw so the fallback still happens.
     */
    class CrashBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: undefined }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        console.error('spendwatch: slot component crashed', error, info?.componentStack)
      }

      render() {
        if (this.state.error !== undefined) throw this.state.error
        return this.props.children
      }
    }

    function guarded(Component) {
      return function SpendwatchGuard(props) {
        return h(CrashBoundary, null, h(Component, props))
      }
    }

    const en = {
      balance: 'Balance',
      workspaceCostTitle: 'Estimated spend in {workspace}, including archived sessions: {amount}',
      modePeak: 'Peak',
      modeOffPeak: 'Off-peak',
      modeEndsIn: 'ends in {duration}',
      pricingLine: '{mode} pricing · ends in {duration} (at {time})',
      durationDays: '{days}d',
      durationDaysHours: '{days}d {hours}h',
      durationHours: '{hours}h',
      durationHoursMinutes: '{hours}h {minutes}m',
      durationMinutes: '{minutes}m',
      sidebarTitle: 'DeepSeek balance: {balance}. All-time Harness estimate: {spent} across {sessions} sessions. Click to refresh.',
      sidebarTitleNoBalance: 'DeepSeek balance is unavailable. Check Account settings or your connection. All-time Harness estimate: {spent} across {sessions} sessions. Click to refresh.',
      sidebarTitleLoading: 'Loading DeepSeek balance and all-time Harness spend…',
      sidebarTitleRefreshing: 'Refreshing…',
      sidebarTitleUnavailable: 'DeepSeek balance is unavailable. Click to retry.',
      sidebarTitleStale: 'Refresh failed; showing the last result. Click to retry.',
      sessionSpent: '~{amount} this session',
      sessionLoading: 'Session spend…',
      sessionTitle: 'This session: {session}. Estimated at current DeepSeek list prices.',
      sessionTitleWithSubagents: 'This session with {count} subagents: {total} ({own} without subagents). Estimated at current DeepSeek list prices.',
      sessionTitleOneSubagent: 'This session with 1 subagent: {total} ({own} without it). Estimated at current DeepSeek list prices.',
      sessionTitleUnavailable: 'This session’s estimated spend is not available yet.',
      unpriced: '{count} model calls used an unpriced model and are excluded.',
      partial: '{count} sessions could not be read and are excluded.',
    }

    const zh = {
      balance: '余额',
      workspaceCostTitle: '{workspace} 的预估花费（含已归档会话）：{amount}',
      modePeak: '高峰',
      modeOffPeak: '错峰',
      modeEndsIn: '{duration}后结束',
      pricingLine: '{mode}价 · {duration}后结束（{time}）',
      durationDays: '{days}天',
      durationDaysHours: '{days}天{hours}小时',
      durationHours: '{hours}小时',
      durationHoursMinutes: '{hours}小时{minutes}分',
      durationMinutes: '{minutes}分',
      sidebarTitle: 'DeepSeek 余额：{balance}。Harness 历史预估：{spent}，共 {sessions} 个会话。点击刷新。',
      sidebarTitleNoBalance: 'DeepSeek 余额暂不可用。请检查账户设置或网络。Harness 历史预估：{spent}，共 {sessions} 个会话。点击刷新。',
      sidebarTitleLoading: '正在加载 DeepSeek 余额与历史预估…',
      sidebarTitleRefreshing: '正在刷新…',
      sidebarTitleUnavailable: 'DeepSeek 余额暂不可用。点击重试。',
      sidebarTitleStale: '刷新失败，显示上次结果。点击重试。',
      sessionSpent: '本次会话 ~{amount}',
      sessionLoading: '本次花费加载中…',
      sessionTitle: '本次会话：{session}。按 DeepSeek 当前列表价估算。',
      sessionTitleWithSubagents: '本次会话含 {count} 个子代理：{total}（不含子代理 {own}）。按 DeepSeek 当前列表价估算。',
      sessionTitleOneSubagent: '本次会话含 1 个子代理：{total}（不含子代理 {own}）。按 DeepSeek 当前列表价估算。',
      sessionTitleUnavailable: '本次会话花费暂不可用。',
      unpriced: '有 {count} 次模型调用使用了未定价模型，未计入估算。',
      partial: '有 {count} 个会话无法读取，未计入。',
    }

    const sessionStyles = `
      .spw-session-pill {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 1px 8px;
        border-radius: var(--dsw-radius-sm);
        color: var(--dsw-alias-label-tertiary);
        font: inherit;
        font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
        line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .spw-session-pill svg {
        flex: none;
        width: 14px;
        height: 14px;
      }
      .spw-session-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `

    const sidebarStyles = `
      .spw-sidebar-action {
        box-sizing: border-box;
        order: -1;
        flex: 0 0 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 42px;
        margin: 8px 0 0;
        padding: 0 10px 0 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 14px;
        line-height: 20px;
        text-align: left;
        cursor: pointer;
        overflow: hidden;
      }
      .spw-sidebar-action:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .spw-sidebar-action:focus-visible {
        outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: -2px;
      }
      .spw-sidebar-action[aria-busy="true"] {
        cursor: progress;
      }
      .spw-sidebar-action svg {
        flex: none;
        width: 16px;
        height: 16px;
      }
      .spw-sidebar-main {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 1px;
      }
      .spw-sidebar-top {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }
      .spw-sidebar-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .spw-sidebar-mode {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        color: var(--dsw-alias-label-tertiary);
        font-size: 10.5px;
        line-height: 14px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .spw-sidebar-mode-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .spw-sidebar-mode-dot {
        flex: none;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #55a06d;
      }
      .spw-sidebar-mode[data-mode="peak"] .spw-sidebar-mode-dot {
        background: #d09a3a;
      }
      .spw-workspace-cost {
        flex: none;
        color: var(--dsw-alias-label-tertiary);
        font-size: 10px;
        line-height: 16px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .spw-sidebar-amount {
        margin-left: auto;
        flex: none;
        max-width: 55%;
        color: var(--dsw-alias-label-tertiary);
        font-variant-numeric: tabular-nums;
        font-size: 12px;
        line-height: 16px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .spw-sidebar-action[data-wide="false"] {
        flex: 0 0 36px;
        width: 36px;
        height: 36px;
        margin: 0 0 2px;
        padding: 0;
        justify-content: center;
        border-radius: var(--dsw-radius-md);
      }
      .spw-sidebar-action[data-wide="false"] .spw-sidebar-main {
        display: none;
      }
      /* The footer is a single flex row in the host. Let our full-width balance
         row sit above the existing Cordis action instead of clipping it. */
      div:has(> [data-slot="sidebar.footer.action"] > .spw-sidebar-action) {
        flex-wrap: wrap;
      }
      @media (prefers-reduced-motion: no-preference) {
        .spw-sidebar-action[aria-busy="true"] svg {
          animation: spw-pulse 1.2s ease-in-out infinite;
        }
      }
      @keyframes spw-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: .45; }
      }
    `

    function formatUsd(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value < 0) return `-$${Math.abs(value).toFixed(2)}`
      if (value > 0 && value < 0.01) return '<$0.01'
      return `$${value.toFixed(2)}`
    }

    function formatUsdPrecise(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value > 0 && value < 0.0001) return '<$0.0001'
      return `$${value.toFixed(4)}`
    }

    function formatWallet(wallet) {
      const amount = Number(wallet?.total)
      if (!Number.isFinite(amount)) return undefined
      const symbol = wallet?.currency === 'CNY' ? '¥' : '$'
      const magnitude = Math.abs(amount)
      if (magnitude === 0) return `${symbol}0.00`
      const text = magnitude.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      if (magnitude < 0.01) return `${amount < 0 ? '-' : ''}<${symbol}0.01`
      return `${amount < 0 ? '-' : ''}${symbol}${text}`
    }

    /**
     * Offline copy of `pricing.json` for the first paint and for a Host that
     * cannot serve /pricing. The Host validates and serves the real book.
     */
    const DEFAULT_PRICING = {
      schema: 1,
      updated: '2026-10-29',
      holidays: [
        { from: '2026-09-25', to: '2026-09-27' },
        { from: '2026-10-01', to: '2026-10-07' },
      ],
      periods: [
        {
          from: '1970-01-01T00:00:00.000Z',
          weekdays: 'all',
          windows: [
            { start: '01:00', end: '04:00' },
            { start: '06:00', end: '10:00' },
          ],
        },
        {
          from: '2026-08-22T16:00:00.000Z',
          weekdays: 'beijing',
          windows: [
            { start: '01:00', end: '04:00' },
            { start: '06:00', end: '10:00' },
          ],
        },
      ],
    }

    function pricingMinutes(text) {
      const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text)
      return match === null ? undefined : Number(match[1]) * 60 + Number(match[2])
    }

    /** The price-book period in effect at an instant. */
    function periodAt(book, time) {
      const periods = Array.isArray(book?.periods) ? book.periods : []
      let chosen
      let chosenFrom = -Infinity
      for (const period of periods) {
        const from = Date.parse(period?.from)
        if (!Number.isFinite(from) || from > time) continue
        if (from >= chosenFrom) {
          chosen = period
          chosenFrom = from
        }
      }
      return chosen ?? periods[0]
    }

    function beijingDateKey(time) {
      return new Date(time + 8 * 3600000).toISOString().slice(0, 10)
    }

    function isBeijingWeekend(time) {
      const day = new Date(time + 8 * 3600000).getUTCDay()
      return day === 0 || day === 6
    }

    /** Peak state at an instant, using the period and holidays in force then. */
    function isPeakAt(book, time) {
      const date = new Date(time)
      if (Number.isNaN(date.valueOf())) return false
      const key = beijingDateKey(time)
      for (const holiday of book?.holidays ?? []) {
        if (typeof holiday?.from === 'string' && typeof holiday?.to === 'string'
          && key >= holiday.from && key <= holiday.to) return false
      }
      const period = periodAt(book, time)
      if (period === undefined) return false
      if (period.weekdays === 'beijing' && isBeijingWeekend(time)) return false
      const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
      for (const window of period.windows ?? []) {
        const start = pricingMinutes(window?.start)
        const end = pricingMinutes(window?.end)
        if (start !== undefined && end !== undefined && minute >= start && minute < end) return true
      }
      return false
    }

    /**
     * Next instant the peak state flips. Candidates are every window boundary
     * (per period) and Beijing midnight for 21 days — enough to cross a
     * seven-day holiday plus weekends — with holiday and period starts added.
     */
    function nextPeakFlip(book, time) {
      const current = isPeakAt(book, time)
      const base = new Date(time)
      const dayStart = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
      const candidates = new Set()
      for (let day = 0; day <= 21; day += 1) {
        const midnight = dayStart + day * 86400000
        for (const period of book?.periods ?? []) {
          for (const window of period.windows ?? []) {
            const start = pricingMinutes(window?.start)
            const end = pricingMinutes(window?.end)
            if (start !== undefined) candidates.add(midnight + start * 60000)
            if (end !== undefined) candidates.add(midnight + end * 60000)
          }
          const from = Date.parse(period?.from)
          if (Number.isFinite(from)) candidates.add(from)
        }
        candidates.add(midnight + 16 * 3600000)
      }
      for (const holiday of book?.holidays ?? []) {
        const from = Date.parse(`${holiday?.from}T00:00:00+08:00`)
        const to = Date.parse(`${holiday?.to}T00:00:00+08:00`)
        if (Number.isFinite(from)) candidates.add(from)
        if (Number.isFinite(to)) candidates.add(to + 86400000)
      }
      const ordered = [...candidates].filter((candidate) => candidate > time).sort((a, b) => a - b)
      for (const candidate of ordered) {
        if (isPeakAt(book, candidate) !== current) return candidate
      }
      return undefined
    }

    function formatDuration(t, ms) {
      const minutes = Math.max(1, Math.ceil(ms / 60000))
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      const rest = minutes % 60
      if (days > 0) {
        return hours > 0
          ? t('durationDaysHours', { days, hours })
          : t('durationDays', { days })
      }
      if (hours > 0) {
        return rest > 0
          ? t('durationHoursMinutes', { hours, minutes: rest })
          : t('durationHours', { hours })
      }
      return t('durationMinutes', { minutes: rest })
    }

    function formatClock(time) {
      return new Date(time).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    }

    function WalletGlyph() {
      return h('svg', {
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        focusable: 'false',
      }, [
        h('path', {
          key: 'body',
          d: 'M2.5 5.25c0-.97.78-1.75 1.75-1.75H12c.97 0 1.75.78 1.75 1.75v6.5c0 .97-.78 1.75-1.75 1.75H4.25c-.97 0-1.75-.78-1.75-1.75v-6.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', {
          key: 'line',
          d: 'M2.5 5.75h11.25',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          opacity: 0.65,
        }),
        h('path', {
          key: 'clip',
          d: 'M9.25 8h4.5v3h-4.5a1.5 1.5 0 0 1 0-3Z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('circle', { key: 'dot', cx: 11.5, cy: 9.5, r: 0.7, fill: 'currentColor' }),
      ])
    }

    /**
     * Sum of every Session's live `deepseekSpend` view, read from the root
     * Session-list snapshot. The Client applies control frames for every
     * Session (open or not), so this advances on the same commits that move
     * the composer pill and also covers subagent Sessions.
     */
    function selectLiveCost(sessions) {
      if (sessions === null || typeof sessions !== 'object') return 0
      let total = 0
      const seen = new Set()
      const byId = sessions.byId
      if (byId !== null && typeof byId === 'object') {
        for (const id of Object.keys(byId)) {
          seen.add(id)
          const cost = byId[id]?.projectionValues?.deepseekSpend?.costUsd
          if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) total += cost
        }
      }
      const blocks = sessions.projectionsBySession
      if (blocks !== null && typeof blocks === 'object') {
        for (const id of Object.keys(blocks)) {
          if (seen.has(id)) continue
          const cost = blocks[id]?.values?.deepseekSpend?.costUsd
          if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) total += cost
        }
      }
      return total
    }

    const EMPTY_SESSIONS = Object.freeze({ ids: [], byId: {}, projectionsBySession: {} })

    /** Hook-shaped no-op for hosts whose slot contract predates `useSessions`. */
    function noSessions(selector) {
      return selector(EMPTY_SESSIONS)
    }

    const EMPTY_ITEMS = Object.freeze([])
    const EMPTY_WORKSPACES = Object.freeze({ items: EMPTY_ITEMS })
    const selectSessions = (state) => state
    const selectWorkspaceItems = (state) => state?.items ?? EMPTY_ITEMS

    /** Hook-shaped no-op for hosts whose slot contract predates `useWorkspaces`. */
    function noWorkspaces(selector) {
      return selector(EMPTY_WORKSPACES)
    }

    /** Trailing separators differ between the registry and a Session header. */
    function normalizePath(path) {
      return typeof path === 'string' ? path.replace(/[\\/]+$/, '') : path
    }

    /**
     * Estimated spend per workspace path. The Host's fold is the baseline
     * (archived sessions included); sessions this app run has live projections
     * for add only what they spent after that fold.
     */
    function workspaceCosts(sessions, spend, workspaceItems) {
      const ownerBySession = new Map()
      const ownerByPath = new Map()
      for (const item of Array.isArray(workspaceItems) ? workspaceItems : EMPTY_ITEMS) {
        if (item === null || typeof item !== 'object') continue
        const workspaceId = item.workspaceId
        if (typeof workspaceId !== 'string') continue
        if (typeof item.path === 'string' && item.path.length > 0) {
          ownerByPath.set(normalizePath(item.path), workspaceId)
        }
        for (const sessionId of item.sessionIds ?? []) {
          if (typeof sessionId === 'string') ownerBySession.set(sessionId, workspaceId)
        }
      }

      const totals = new Map()
      const byWorkspace = spend?.byWorkspace
      if (byWorkspace !== null && typeof byWorkspace === 'object') {
        for (const workspaceId of Object.keys(byWorkspace)) {
          const bucket = byWorkspace[workspaceId]
          const cost = typeof bucket?.costUsd === 'number' && Number.isFinite(bucket.costUsd)
            ? bucket.costUsd
            : 0
          totals.set(workspaceId, cost)
        }
      }

      const sessionsById = sessions?.byId
      if (sessionsById !== null && typeof sessionsById === 'object') {
        const bySession = spend?.bySession
        for (const id of Object.keys(sessionsById)) {
          const entry = sessionsById[id]
          const live = entry?.projectionValues?.deepseekSpend?.costUsd
          if (typeof live !== 'number' || !Number.isFinite(live)) continue
          const workspaceId = ownerBySession.get(id)
            ?? (typeof entry?.cwd === 'string' && entry.cwd.length > 0
              ? ownerByPath.get(normalizePath(entry.cwd))
              : undefined)
          if (workspaceId === undefined) continue
          const atFetch = bySession?.[id]
          const delta = live - (typeof atFetch === 'number' && Number.isFinite(atFetch) ? atFetch : 0)
          if (delta <= 0) continue
          totals.set(workspaceId, (totals.get(workspaceId) ?? 0) + delta)
        }
      }
      return totals
    }

    const EMPTY_SUBAGENT_SUMMARY = Object.freeze({ total: 0, count: 0 })

    /**
     * Per-snapshot memo: the selector runs on every Session-list update, and the
     * cost and the count are two separate subscriptions over one walk.
     */
    const SUBAGENT_CACHE = new WeakMap()

    /**
     * The last `/summary` spend block (`bySession` and `byWorkspace`), shared
     * between the sidebar row and the composer pill. The projection store only
     * holds Sessions this app run has seen; this fills in everything else the
     * Host fold already priced, archived Sessions and old subagents included.
     */
    const summaryFeed = {
      spend: undefined,
      listeners: new Set(),
    }

    function publishSummarySpend(spend) {
      summaryFeed.spend = spend !== null && typeof spend === 'object' ? spend : undefined
      for (const listener of summaryFeed.listeners) listener()
    }

    function useSummarySpend() {
      const [value, setValue] = React.useState(summaryFeed.spend)
      React.useEffect(() => {
        const listener = () => setValue(summaryFeed.spend)
        summaryFeed.listeners.add(listener)
        setValue(summaryFeed.spend)
        return () => {
          summaryFeed.listeners.delete(listener)
        }
      }, [])
      return value
    }

    /**
     * Sum every descendant Session of `rootId` that the Host marks as a
     * subagent (`origin: "subagent"`). Forks also carry `parentSession` but are
     * copies of their source's log, so they are deliberately excluded.
     *
     * A descendant's live projection wins; when this app run has never seen it,
     * the last `/summary` fold supplies its absolute cost.
     */
    function summarizeSubagents(sessions, rootId, baseline) {
      if (sessions === null || typeof sessions !== 'object') return EMPTY_SUBAGENT_SUMMARY
      const byId = sessions.byId
      if (byId === null || typeof byId !== 'object' || typeof rootId !== 'string') return EMPTY_SUBAGENT_SUMMARY

      let byRoot = SUBAGENT_CACHE.get(sessions)
      if (byRoot === undefined) {
        byRoot = new Map()
        SUBAGENT_CACHE.set(sessions, byRoot)
      }
      const cached = byRoot.get(rootId)
      if (cached !== undefined && cached.baseline === baseline) return cached.value

      const byParent = new Map()
      for (const id of Object.keys(byId)) {
        const entry = byId[id]
        if (entry?.origin !== 'subagent') continue
        const parent = entry?.parentId
        if (typeof parent !== 'string' || parent.length === 0) continue
        const bucket = byParent.get(parent)
        if (bucket === undefined) byParent.set(parent, [id])
        else bucket.push(id)
      }

      let total = 0
      let count = 0
      const stack = [rootId]
      const seen = new Set()
      while (stack.length > 0) {
        const parentId = stack.pop()
        const children = byParent.get(parentId)
        if (children === undefined) continue
        for (const childId of children) {
          if (seen.has(childId)) continue
          seen.add(childId)
          stack.push(childId)
          count += 1
          const live = byId[childId]?.projectionValues?.deepseekSpend?.costUsd
          const fallback = baseline?.[childId]
          const cost = typeof live === 'number' && Number.isFinite(live)
            ? live
            : typeof fallback === 'number' && Number.isFinite(fallback)
              ? fallback
              : 0
          if (cost > 0) total += cost
        }
      }

      const value = Object.freeze({ total, count })
      byRoot.set(rootId, { baseline, value })
      return value
    }

    function SidebarBalance({ wide, t, readSummary, readBalance, readPricing, useSessions, useWorkspaces }) {
      const [refresh, setRefresh] = React.useState(0)
      const [data, setData] = React.useState(undefined)
      const [phase, setPhase] = React.useState('loading')
      const [balance, setBalance] = React.useState(undefined)
      const [now, setNow] = React.useState(Date.now())
      const [pricing, setPricing] = React.useState(DEFAULT_PRICING)
      // The slot contract always supplies `useSessions`; the fallback only keeps
      // an older host from failing the whole row, it just never pulls live.
      const sessionHook = typeof useSessions === 'function' ? useSessions : noSessions
      const sessionList = sessionHook(selectSessions)
      const liveCost = React.useMemo(() => selectLiveCost(sessionList), [sessionList])
      const workspaceHook = typeof useWorkspaces === 'function' ? useWorkspaces : noWorkspaces
      const workspaceItems = workspaceHook(selectWorkspaceItems)
      const readRef = React.useRef(readSummary)
      readRef.current = readSummary
      const balanceReadRef = React.useRef(readBalance)
      balanceReadRef.current = readBalance
      const pricingReadRef = React.useRef(readPricing)
      pricingReadRef.current = readPricing
      const hasData = React.useRef(false)
      const lastCost = React.useRef(undefined)

      const feed = React.useRef({
        epoch: 0,
        accepted: 0,
        inFlight: false,
        queued: false,
        timer: undefined,
        controller: undefined,
        disposed: false,
        unavailable: false,
      })

      const writeBalance = React.useCallback((value, epoch) => {
        const state = feed.current
        if (state.disposed || epoch < state.accepted) return
        state.accepted = epoch
        setBalance(value)
      }, [])

      const pullBalance = React.useCallback(() => {
        const state = feed.current
        if (state.disposed || state.unavailable) return
        if (typeof balanceReadRef.current !== 'function') return
        if (state.inFlight) {
          state.queued = true
          return
        }
        state.inFlight = true
        const epoch = ++state.epoch
        const controller = new AbortController()
        state.controller = controller
        balanceReadRef.current(controller.signal)
          .then((value) => {
            if (state.disposed) return
            writeBalance(value, epoch)
          })
          .catch((error) => {
            // An older host has no balance route; keep the summary value and
            // stop asking until the page reloads against the new host.
            if (error?.status === 404) state.unavailable = true
          })
          .finally(() => {
            state.inFlight = false
            if (state.controller === controller) state.controller = undefined
            if (!state.disposed && state.queued) {
              state.queued = false
              state.timer = setTimeout(() => {
                state.timer = undefined
                pullBalance()
              }, PULL_TRAIL_MS)
            }
          })
      }, [writeBalance])

      const schedulePull = React.useCallback(() => {
        const state = feed.current
        if (state.disposed) return
        if (state.timer !== undefined) clearTimeout(state.timer)
        state.timer = setTimeout(() => {
          state.timer = undefined
          pullBalance()
        }, PULL_DEBOUNCE_MS)
      }, [pullBalance])

      React.useEffect(() => {
        const state = feed.current
        return () => {
          state.disposed = true
          if (state.timer !== undefined) clearTimeout(state.timer)
          state.controller?.abort()
        }
      }, [])

      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), MODE_TICK_MS)
        return () => clearInterval(timer)
      }, [])

      React.useEffect(() => {
        if (typeof pricingReadRef.current !== 'function') return undefined
        const controller = new AbortController()
        let active = true
        pricingReadRef.current(controller.signal)
          .then((book) => {
            if (!active || book === null || typeof book !== 'object') return
            if (!Array.isArray(book.periods)) return
            setPricing(book)
          })
          .catch(() => {})
        return () => {
          active = false
          controller.abort()
        }
      }, [])

      React.useEffect(() => {
        const controller = new AbortController()
        let active = true
        setPhase('loading')
        if (typeof readRef.current !== 'function') {
          setPhase('error')
          return () => controller.abort()
        }
        const epoch = ++feed.current.epoch
        readRef.current(refresh > 0, controller.signal)
          .then((value) => {
            if (!active) return
            setData(value)
            setPhase('ready')
            hasData.current = true
            publishSummarySpend(value?.spend)
            if (value?.balance !== undefined) writeBalance(value.balance, epoch)
          })
          .catch((error) => {
            if (!active || error?.name === 'AbortError') return
            setPhase('error')
          })
        return () => {
          active = false
          controller.abort()
        }
      }, [refresh, writeBalance])

      // A committed model response in any live Session moves its cost; pull the
      // wallet then, so the total is anchored to the same event.
      React.useEffect(() => {
        if (typeof liveCost !== 'number' || !Number.isFinite(liveCost)) return
        const previous = lastCost.current
        lastCost.current = liveCost
        if (previous === undefined || !hasData.current) return
        if (liveCost > previous + 1e-9) schedulePull()
      }, [liveCost, schedulePull])

      // Coming back to the window also catches a top-up made elsewhere.
      React.useEffect(() => {
        const onFocus = () => schedulePull()
        const onVisibility = () => {
          if (document.visibilityState === 'visible') schedulePull()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [schedulePull])

      const peak = isPeakAt(pricing, now)
      const modeLabel = peak ? t('modePeak') : t('modeOffPeak')
      const nextFlip = nextPeakFlip(pricing, now)
      const remainingText = nextFlip !== undefined ? formatDuration(t, nextFlip - now) : undefined
      const modeText = remainingText !== undefined
        ? `${modeLabel} · ${t('modeEndsIn', { duration: remainingText })}`
        : modeLabel

      const balanceValue = balance !== undefined ? balance : data?.balance
      const spend = data?.spend
      const spendReady = spend?.status === 'ready' || spend?.status === 'partial'
      const totalCost = spendReady && typeof spend.totalUsd === 'number' ? spend.totalUsd : undefined
      const wallets = balanceValue?.status === 'ready' && Array.isArray(balanceValue.wallets)
        ? balanceValue.wallets.map(formatWallet).filter(Boolean)
        : []
      const walletText = wallets.join(' · ')
      const amountText = walletText.length > 0
        ? walletText
        : data === undefined
          ? (phase === 'loading' ? '…' : '—')
          : '—'
      const sessions = spend?.countedSessions ?? spend?.sessions ?? 0
      const spentDetail = totalCost !== undefined ? formatUsd(totalCost) : '—'
      const pricingDetail = nextFlip !== undefined && remainingText !== undefined
        ? t('pricingLine', {
            mode: modeLabel,
            duration: remainingText,
            time: formatClock(nextFlip),
          })
        : undefined
      const details = []
      if (pricingDetail !== undefined) details.push(pricingDetail)
      if (walletText.length > 0) {
        details.push(t('sidebarTitle', {
          balance: walletText,
          spent: spentDetail,
          sessions,
        }))
      } else if (data !== undefined) {
        details.push(t('sidebarTitleNoBalance', {
          spent: spentDetail,
          sessions,
        }))
      }
      if (data !== undefined && phase === 'loading') details.push(t('sidebarTitleRefreshing'))
      else if (data !== undefined && phase === 'error') details.push(t('sidebarTitleStale'))
      if (spend?.unpricedMessages > 0) details.push(t('unpriced', { count: spend.unpricedMessages }))
      if (spend?.failedSessions > 0) details.push(t('partial', { count: spend.failedSessions }))
      const title = data === undefined
        ? [
            phase === 'loading' ? t('sidebarTitleLoading') : t('sidebarTitleUnavailable'),
            pricingDetail,
          ].filter(Boolean).join(' ')
        : details.join(' ')
      const busy = phase === 'loading'

      const workspaceById = React.useMemo(() => {
        const map = new Map()
        for (const item of workspaceItems) {
          if (item !== null && typeof item === 'object' && typeof item.workspaceId === 'string') {
            map.set(item.workspaceId, item)
          }
        }
        return map
      }, [workspaceItems])

      const workspaceCostMap = React.useMemo(
        () => workspaceCosts(sessionList, data?.spend, workspaceItems),
        [sessionList, data, workspaceItems],
      )

      const workspaceRefs = React.useRef({ costs: workspaceCostMap, byId: workspaceById })
      workspaceRefs.current = { costs: workspaceCostMap, byId: workspaceById }
      const translateRef = React.useRef(t)
      translateRef.current = t

      const syncWorkspaceBadges = React.useCallback(() => {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
        const { costs, byId } = workspaceRefs.current
        const rows = document.querySelectorAll('[data-row-key^="workspace:"]')
        for (const row of rows) {
          const key = typeof row.getAttribute === 'function' ? row.getAttribute('data-row-key') : null
          if (typeof key !== 'string' || !key.startsWith('workspace:')) continue
          const workspaceId = key.slice('workspace:'.length)
          if (workspaceId.length === 0) continue
          const workspace = byId.get(workspaceId)
          const path = workspace?.path
          const cost = costs.get(workspaceId)
          let badge = typeof row.querySelector === 'function'
            ? row.querySelector(':scope > .spw-workspace-cost')
            : null
          if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
            if (badge !== null && typeof badge.remove === 'function') badge.remove()
            continue
          }
          if (badge === null && typeof document.createElement === 'function') {
            badge = document.createElement('span')
            badge.className = 'spw-workspace-cost'
            if (typeof row.appendChild === 'function') row.appendChild(badge)
          }
          if (badge === null) continue
          if (badge.parentNode === row && row.lastElementChild !== badge && typeof row.appendChild === 'function') {
            row.appendChild(badge)
          }
          const amount = formatUsd(cost)
          const text = `~${amount}`
          if (badge.textContent !== text) badge.textContent = text
          const label = typeof workspace?.title === 'string' && workspace.title.length > 0
            ? workspace.title
            : path
          const title = translateRef.current('workspaceCostTitle', { workspace: label, amount })
          if (badge.title !== title) badge.title = title
        }
      }, [])

      React.useEffect(() => {
        syncWorkspaceBadges()
      }, [syncWorkspaceBadges, workspaceCostMap, workspaceById])

      React.useEffect(() => {
        const timer = setInterval(syncWorkspaceBadges, 2000)
        return () => clearInterval(timer)
      }, [syncWorkspaceBadges])

      return h(React.Fragment, null, [
        h('style', { key: 'style', 'data-plugin-css': 'spendwatch/sidebar' }, sidebarStyles),
        h('button', {
          key: 'button',
          type: 'button',
          className: 'spw-sidebar-action',
          'data-wide': wide ? 'true' : 'false',
          'data-spendwatch-balance': true,
          title,
          'aria-label': title,
          'aria-busy': busy ? 'true' : undefined,
          onClick: () => {
            if (!busy) setRefresh((value) => value + 1)
          },
        }, [
          h(WalletGlyph, { key: 'icon' }),
          h('span', { key: 'main', className: 'spw-sidebar-main' }, [
            h('span', { key: 'top', className: 'spw-sidebar-top' }, [
              h('span', { key: 'label', className: 'spw-sidebar-label' }, t('balance')),
              h('span', { key: 'amount', className: 'spw-sidebar-amount' }, amountText),
            ]),
            h('span', {
              key: 'mode',
              className: 'spw-sidebar-mode',
              'data-mode': peak ? 'peak' : 'off-peak',
            }, [
              h('span', { key: 'dot', className: 'spw-sidebar-mode-dot' }),
              h('span', { key: 'text', className: 'spw-sidebar-mode-text' }, modeText),
            ]),
          ]),
        ]),
      ])
    }

    function SessionSpend({ t, useProjection, useSessions, sessionId }) {
      const live = useProjection('deepseekSpend')
      const ownCost = typeof live?.costUsd === 'number' && Number.isFinite(live.costUsd)
        ? live.costUsd
        : undefined
      const sessionHook = typeof useSessions === 'function' ? useSessions : noSessions
      const baselineSpend = useSummarySpend()
      const baseline = baselineSpend?.bySession
      const selectCost = React.useCallback(
        (sessions) => summarizeSubagents(sessions, sessionId, baseline).total,
        [sessionId, baseline],
      )
      const selectCount = React.useCallback(
        (sessions) => summarizeSubagents(sessions, sessionId, baseline).count,
        [sessionId, baseline],
      )
      const subagentCost = sessionHook(selectCost)
      const subagentCount = sessionHook(selectCount)
      const cost = ownCost !== undefined ? ownCost + subagentCost : undefined
      const text = cost !== undefined
        ? t('sessionSpent', { amount: formatUsd(cost) })
        : t('sessionLoading')
      let title
      if (cost === undefined) {
        title = t('sessionTitleUnavailable')
      } else if (subagentCount > 1) {
        title = t('sessionTitleWithSubagents', {
          total: `~${formatUsdPrecise(cost)}`,
          own: `~${formatUsdPrecise(ownCost)}`,
          count: subagentCount,
        })
      } else if (subagentCount === 1) {
        title = t('sessionTitleOneSubagent', {
          total: `~${formatUsdPrecise(cost)}`,
          own: `~${formatUsdPrecise(ownCost)}`,
        })
      } else {
        title = t('sessionTitle', { session: `~${formatUsdPrecise(cost)}` })
      }

      return h(React.Fragment, null, [
        h('style', { key: 'style', 'data-plugin-css': 'spendwatch/session' }, sessionStyles),
        h('span', {
          key: 'pill',
          className: 'spw-session-pill',
          'data-spendwatch-session-spend': true,
          title,
          'aria-label': title,
        }, [
          h(WalletGlyph, { key: 'icon' }),
          h('span', { key: 'label', className: 'spw-session-label' }, text),
        ]),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => {
            try {
              return ctx.locale.register(NS, { en, zh })
            } catch (error) {
              console.error('spendwatch: locale registration failed', error)
              return undefined
            }
          },
          'spendwatch: dictionaries',
        )

        const readSummary = async (force, signal) => {
          const params = new URLSearchParams({
            locale: ctx.locale.getSnapshot().active,
            version: CLIENT_VERSION,
            tz: String(-new Date().getTimezoneOffset() * 60),
          })
          if (force) params.set('refresh', '1')
          const response = await fetch(`${ROUTE_PATH}?${params.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal,
          })
          if (!response.ok) throw new Error(`spendwatch HTTP ${response.status}`)
          const value = await response.json()
          if (value?.ok !== true) throw new Error('spendwatch summary failed')
          return value
        }

        /** Wallet only: no all-Session spend fold, safe to call on every commit. */
        const readBalance = async (signal) => {
          const params = new URLSearchParams({
            locale: ctx.locale.getSnapshot().active,
            version: CLIENT_VERSION,
            tz: String(-new Date().getTimezoneOffset() * 60),
          })
          const response = await fetch(`${BALANCE_ROUTE_PATH}?${params.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal,
          })
          if (!response.ok) {
            const error = new Error(`spendwatch HTTP ${response.status}`)
            error.status = response.status
            throw error
          }
          const value = await response.json()
          if (value?.ok !== true) throw new Error('spendwatch balance failed')
          return value.balance
        }

        /** The Host's validated price book; it can adopt a newer copy without a release. */
        const readPricing = async (signal) => {
          const response = await fetch(PRICING_ROUTE_PATH, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal,
          })
          if (!response.ok) throw new Error(`spendwatch HTTP ${response.status}`)
          const value = await response.json()
          if (value?.ok !== true) throw new Error('spendwatch pricing failed')
          return value.pricing
        }

        const registerSlot = (name, options, Component) => {
          try {
            ctx.slots.inject(name, () => ctx.slots.register(options, Component))
          } catch (error) {
            console.error(`spendwatch: ${name} slot registration failed`, error)
          }
        }

        registerSlot('sidebar.footer.action', {
          name: 'sidebar.footer.action',
          id: 'spendwatch',
          order: 5,
          locale: NS,
          inject: () => ({ readSummary, readBalance, readPricing }),
        }, guarded(SidebarBalance))

        registerSlot('conversation.composer.dock', {
          name: 'conversation.composer.dock',
          id: 'spendwatch-session-spend',
          order: 2,
          locale: NS,
        }, guarded(SessionSpend))
      },
    }
  },
})
