/**
 * DeepSeek Balance — Host half.
 *
 * Registers the `deepseekSpend` session projection (one pure fold over the
 * durable log) and a same-origin summary route used by the composer-dock
 * Client half. Wallet balance comes from the signed-in DeepSeek account when
 * available, otherwise from the configured DeepSeek API key.
 */

import { readFileSync } from 'node:fs'

const ROUTE_PATH = '/plugins/spendwatch/summary'
const BALANCE_ROUTE_PATH = '/plugins/spendwatch/balance'
const PRICING_ROUTE_PATH = '/plugins/spendwatch/pricing'
const CACHE_MS = 15_000
const DEFAULT_CLIENT_VERSION = '1.4.0'
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance'

/**
 * Pricing is data, not code. `pricing.json` beside this file is a versioned
 * price book: peak windows, the weekday rule, Chinese public holidays, and the
 * rates in effect from each `from` instant. A newer copy can be fetched from
 * the repository at runtime, validated, and adopted without a plugin release;
 * the bundled file (or FALLBACK_BOOK when it is missing) is the offline path.
 */
const MODEL_FAMILY = new Map([
  ['deepseek-flash', 'flash'],
  ['deepseek-v4-flash', 'flash'],
  ['deepseek-v4-flash-vision-exp', 'flash'],
  ['deepseek-chat', 'flash'],
  ['deepseek-reasoner', 'flash'],
  ['deepseek-v4-pro', 'pro'],
])

const DEFAULT_PRICING_URL = 'https://raw.githubusercontent.com/awychoi/dsh-spendwatch/main/pricing.json'
const PRICING_REFRESH_MS = 6 * 60 * 60 * 1000
const PRICING_FETCH_TIMEOUT_MS = 8_000
const PRICING_MAX_BYTES = 128 * 1024

/** Last-resort copy if pricing.json is missing or unreadable. */
const FALLBACK_BOOK = {
  schema: 1,
  updated: 'fallback',
  holidays: [
    { from: '2026-09-25', to: '2026-09-27' },
    { from: '2026-10-01', to: '2026-10-07' },
  ],
  periods: [
    {
      from: '1970-01-01T00:00:00.000Z',
      weekdays: 'beijing',
      windows: [
        { start: '01:00', end: '04:00' },
        { start: '06:00', end: '10:00' },
      ],
      rates: {
        flash: {
          peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
          offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
        },
        pro: {
          peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
          offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
        },
      },
    },
  ],
}

/** Parse "HH:MM" into minutes of day, or undefined. */
function pricingMinutes(text) {
  if (typeof text !== 'string') return undefined
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text)
  if (match === null) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

function normalizeRateSet(value) {
  if (value === null || typeof value !== 'object') return undefined
  const out = {}
  for (const field of ['cacheHit', 'cacheMiss', 'output']) {
    const number = value[field]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return undefined
    out[field] = number
  }
  return out
}

/** Validate a price book. Unknown fields are ignored; a bad row rejects the book. */
function normalizePricing(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (value.schema !== 1) return undefined
  if (!Array.isArray(value.holidays) || !Array.isArray(value.periods) || value.periods.length === 0) {
    return undefined
  }

  const holidays = []
  for (const holiday of value.holidays) {
    if (typeof holiday?.from !== 'string' || typeof holiday?.to !== 'string') return undefined
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday.from) || !/^\d{4}-\d{2}-\d{2}$/.test(holiday.to)) {
      return undefined
    }
    if (holiday.from > holiday.to) return undefined
    holidays.push({ from: holiday.from, to: holiday.to })
  }

  const periods = []
  for (const period of value.periods) {
    const from = Date.parse(period?.from)
    if (!Number.isFinite(from)) return undefined
    if (period.weekdays !== 'all' && period.weekdays !== 'beijing') return undefined
    if (!Array.isArray(period.windows) || period.windows.length === 0) return undefined
    const windows = []
    for (const window of period.windows) {
      const start = pricingMinutes(window?.start)
      const end = pricingMinutes(window?.end)
      if (start === undefined || end === undefined || end <= start) return undefined
      windows.push([start, end])
    }
    const rates = {}
    for (const family of ['flash', 'pro']) {
      const peak = normalizeRateSet(period.rates?.[family]?.peak)
      const offPeak = normalizeRateSet(period.rates?.[family]?.offPeak)
      if (peak === undefined || offPeak === undefined) return undefined
      rates[family] = { peak, offPeak }
    }
    periods.push({ from, weekdays: period.weekdays, windows, rates })
  }
  periods.sort((left, right) => left.from - right.from)

  return {
    raw: value,
    holidays,
    periods,
    updated: typeof value.updated === 'string' ? value.updated : '',
  }
}

function loadBundledPricing() {
  try {
    const text = readFileSync(new URL('./pricing.json', import.meta.url), 'utf8')
    const book = normalizePricing(JSON.parse(text))
    if (book !== undefined) return book
    console.warn('spendwatch: bundled pricing.json is invalid; using the fallback book')
  } catch (error) {
    console.warn('spendwatch: cannot read bundled pricing.json; using the fallback book', error)
  }
  const fallback = normalizePricing(FALLBACK_BOOK)
  if (fallback === undefined) throw new Error('spendwatch: fallback pricing is invalid')
  return fallback
}

let activePricing = loadBundledPricing()
let pricingRefreshAt = 0
let pricingRefreshInflight

/** Beijing calendar date key (YYYY-MM-DD) for an instant. */
function beijingDateKey(time) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10)
}

function isBeijingWeekend(time) {
  const day = new Date(time + 8 * 3600000).getUTCDay()
  return day === 0 || day === 6
}

function isHoliday(time) {
  const key = beijingDateKey(time)
  for (const holiday of activePricing.holidays) {
    if (key >= holiday.from && key <= holiday.to) return true
  }
  return false
}

function periodAt(time) {
  let chosen = activePricing.periods[0]
  for (const period of activePricing.periods) {
    if (period.from <= time) chosen = period
  }
  return chosen
}

/** Peak state at an instant, using the price book period in effect then. */
function isPeak(time) {
  const date = new Date(time)
  if (Number.isNaN(date.valueOf())) return false
  if (isHoliday(time)) return false
  const period = periodAt(time)
  if (period === undefined) return false
  if (period.weekdays === 'beijing' && isBeijingWeekend(time)) return false
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
  return period.windows.some(([start, end]) => minute >= start && minute < end)
}

function priceFor(model, time) {
  if (typeof model !== 'string' || model.length === 0) return undefined
  if (!Number.isFinite(time)) return undefined
  const family = MODEL_FAMILY.get(model.toLowerCase())
  if (family === undefined) return undefined
  const period = periodAt(time)
  if (period === undefined) return undefined
  return isPeak(time) ? period.rates[family].peak : period.rates[family].offPeak
}

function priceEvent(model, time, usage) {
  const price = priceFor(model, time)
  if (price === undefined) return undefined
  const inputTokens = finiteUsage(usage.inputTokens)
  const outputTokens = finiteUsage(usage.outputTokens)
  const cacheReadTokens = finiteUsage(usage.cacheReadTokens)
  const cacheWriteTokens = finiteUsage(usage.cacheWriteTokens)
  const costUsd = (
    inputTokens * price.cacheMiss
    + cacheReadTokens * price.cacheHit
    + cacheWriteTokens * price.cacheMiss
    + outputTokens * price.output
  ) / 1_000_000
  return {
    costUsd,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

/**
 * Adopt a newer price book from the repository without a plugin release.
 * Runs at most once per PRICING_REFRESH_MS; failures keep the current book.
 */
async function refreshPricing(ctx) {
  const source = process.env.SPENDWATCH_PRICING_URL ?? DEFAULT_PRICING_URL
  if (source === '') return
  if (Date.now() - pricingRefreshAt < PRICING_REFRESH_MS) return
  if (pricingRefreshInflight !== undefined) return pricingRefreshInflight
  pricingRefreshAt = Date.now()

  const request = (async () => {
    let url
    try {
      url = new URL(source)
    } catch {
      return
    }
    if (url.protocol !== 'https:') return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PRICING_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
      if (!response.ok) return
      const text = await response.text()
      if (text.length > PRICING_MAX_BYTES) return
      const book = normalizePricing(JSON.parse(text))
      if (book === undefined) {
        ctx.logger?.warn?.('spendwatch: remote pricing book rejected')
        return
      }
      activePricing = book
      ctx.logger?.info?.(`spendwatch: pricing book ${book.updated} adopted`)
    } catch {
      // Offline or slow: the bundled book stays active.
    } finally {
      clearTimeout(timer)
    }
  })()

  pricingRefreshInflight = request
  try {
    await request
  } finally {
    if (pricingRefreshInflight === request) pricingRefreshInflight = undefined
  }
}

const NUMERIC_FIELDS = [
  'costUsd',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'messages',
  'unpricedMessages',
]

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseSpend(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('deepseekSpend must be an object')
  }
  for (const field of NUMERIC_FIELDS) {
    if (!isNonNegativeNumber(value[field])) {
      throw new TypeError(`deepseekSpend.${field} must be a non-negative finite number`)
    }
  }
  return value
}

/** Minimal schema surface used by the projection registry (`parse` only). */
const spendSchema = {
  parse: parseSpend,
  safeParse(value) {
    try {
      return { success: true, data: parseSpend(value) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/**
 * @param _header - Session header (unused; part of the projection init contract).
 * @param inheritedEventCount - fork-inherited prefix length. Events below it
 *   belong to the source Session and must not be priced again.
 */
function emptySpend(_header, inheritedEventCount) {
  const inherited = Number(inheritedEventCount)
  return {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    messages: 0,
    unpricedMessages: 0,
    inheritedEventCount: Number.isSafeInteger(inherited) && inherited > 0 ? inherited : 0,
  }
}

function finiteUsage(value) {
  return isNonNegativeNumber(value) ? value : 0
}

function applySpend(state, event) {
  if (Number(event?.seq) < state.inheritedEventCount) return state
  if (event?.type !== 'assistant/message') return state
  const usage = event.data?.usage
  if (usage === null || typeof usage !== 'object') return state
  const model = event.data?.message?.source?.model
  const priced = priceEvent(model, event.time, usage)
  if (priced === undefined) {
    return {
      ...state,
      messages: state.messages + 1,
      unpricedMessages: state.unpricedMessages + 1,
    }
  }
  return {
    costUsd: state.costUsd + priced.costUsd,
    inputTokens: state.inputTokens + priced.inputTokens,
    outputTokens: state.outputTokens + priced.outputTokens,
    cacheReadTokens: state.cacheReadTokens + priced.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens + priced.cacheWriteTokens,
    messages: state.messages + 1,
    unpricedMessages: state.unpricedMessages,
    inheritedEventCount: state.inheritedEventCount,
  }
}

function viewSpend(state) {
  return {
    costUsd: state.costUsd,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens,
    messages: state.messages,
    unpricedMessages: state.unpricedMessages,
  }
}

/** Client-visible projection consumed through the normal Session projection seam. */
const deepseekSpendProjection = {
  key: 'deepseekSpend',
  stateVersion: 3,
  stateSchema: spendSchema,
  init: emptySpend,
  apply: applySpend,
  wire: {
    viewSchema: spendSchema,
    view: viewSpend,
  },
}

function foldEvents(events, inheritedEventCount) {
  let state = emptySpend(undefined, inheritedEventCount)
  for (const event of events) state = applySpend(state, event)
  return viewSpend(state)
}

function disposeObservation(observation) {
  try {
    if (typeof observation?.[Symbol.dispose] === 'function') observation[Symbol.dispose]()
    else if (typeof observation?.dispose === 'function') observation.dispose()
  } catch {
    // A lease that cannot be disposed must not break the read it served.
  }
}

async function readSessionSpend(sessionQuery, sessionId) {
  let observation
  try {
    observation = await sessionQuery.observeSession(sessionId, { projectionMode: 'all' })
    const projected = observation?.projections?.values?.deepseekSpend
    if (projected !== undefined) {
      return { status: 'ready', value: projected, via: 'projection' }
    }
  } catch {
    // Fall through to the raw log; migration or a missing cache must not hide
    // already-committed usage.
  } finally {
    disposeObservation(observation)
  }

  try {
    const log = await sessionQuery.readSession(sessionId)
    return {
      status: 'ready',
      value: foldEvents(log.events, log.inheritedEventCount),
      via: 'log',
    }
  } catch {
    return { status: 'failed' }
  }
}

function normalizeWorkspacePath(path) {
  return typeof path === 'string' ? path.replace(/[\\/]+$/, '') : path
}

/**
 * Session -> Workspace attribution from the official registry, which is what
 * the sidebar itself groups by. `sessionIds` keeps archived sessions in place;
 * `byPath` is the fallback for Sessions that are not owned (subagents, or a
 * Session whose Workspace registration was deleted).
 */
function workspaceIndex(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return undefined
  let list
  try {
    list = registry.list()
  } catch {
    return undefined
  }
  if (!Array.isArray(list)) return undefined
  const bySession = new Map()
  const byPath = new Map()
  for (const workspace of list) {
    const id = typeof workspace?.id === 'string' ? workspace.id : undefined
    if (id === undefined) continue
    const path = workspace?.path
    if (typeof path === 'string' && path.length > 0) byPath.set(normalizeWorkspacePath(path), id)
    for (const sessionId of workspace?.sessionIds ?? []) {
      if (typeof sessionId === 'string') bySession.set(sessionId, id)
    }
  }
  return { bySession, byPath }
}

async function computeSpend(ctx) {
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined) {
    return { status: 'unavailable', reason: 'no-session-query' }
  }

  let records
  try {
    records = await sessionQuery.listSessions()
  } catch {
    return { status: 'unavailable', reason: 'list-failed' }
  }

  const bySession = {}
  const byWorkspace = {}
  const index = workspaceIndex(ctx)
  let totalUsd = 0
  let countedSessions = 0
  let failedSessions = 0
  let messages = 0
  let unpricedMessages = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  const queue = records.filter((record) => typeof record?.header?.id === 'string')
  const worker = async () => {
    while (queue.length > 0) {
      const record = queue.shift()
      if (record === undefined) continue
      const result = await readSessionSpend(sessionQuery, record.header.id)
      if (result.status !== 'ready') {
        failedSessions += 1
        continue
      }
      const value = result.value
      countedSessions += 1
      totalUsd += value.costUsd
      messages += value.messages
      unpricedMessages += value.unpricedMessages
      inputTokens += value.inputTokens
      outputTokens += value.outputTokens
      cacheReadTokens += value.cacheReadTokens
      cacheWriteTokens += value.cacheWriteTokens
      bySession[record.header.id] = value.costUsd
      const cwd = record.header.cwd
      const workspaceId = index?.bySession.get(record.header.id)
        ?? (typeof cwd === 'string' && cwd.length > 0 ? index?.byPath.get(normalizeWorkspacePath(cwd)) : undefined)
      if (workspaceId !== undefined) {
        const workspace = byWorkspace[workspaceId] ?? (byWorkspace[workspaceId] = { costUsd: 0, sessions: 0 })
        workspace.costUsd += value.costUsd
        workspace.sessions += 1
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, Math.max(1, queue.length)) }, () => worker()),
  )

  return {
    status: failedSessions === 0 ? 'ready' : 'partial',
    currency: 'USD',
    totalUsd,
    bySession,
    byWorkspace,
    sessions: records.length,
    countedSessions,
    failedSessions,
    messages,
    unpricedMessages,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    computedAt: Date.now(),
  }
}

const spendCache = {
  at: 0,
  value: undefined,
  inflight: undefined,
}

async function getSpend(ctx, force) {
  if (
    !force
    && spendCache.value !== undefined
    && Date.now() - spendCache.at < CACHE_MS
  ) {
    return spendCache.value
  }
  if (spendCache.inflight !== undefined) return spendCache.inflight

  const request = computeSpend(ctx)
    .then((value) => {
      spendCache.at = Date.now()
      spendCache.value = value
      return value
    })
    .finally(() => {
      if (spendCache.inflight === request) spendCache.inflight = undefined
    })
  spendCache.inflight = request
  return request
}

function normalizeAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0) return undefined
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return undefined
  return text
}

function sumAmounts(values) {
  let total = 0
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) total += number
  }
  return total.toFixed(6).replace(/\.?0+$/, '')
}

async function readApiKeyBalance(ctx) {
  const credentials = ctx.get('credentials')
  let key
  try {
    if (credentials !== undefined) {
      key = (await credentials.resolve('DEEPSEEK_API_KEY'))?.value
    }
  } catch {
    key = undefined
  }
  if (typeof key !== 'string' || key.trim().length === 0) {
    const ambient = process.env.DEEPSEEK_API_KEY
    key = typeof ambient === 'string' ? ambient : undefined
  }
  if (typeof key !== 'string' || key.trim().length === 0) {
    return { status: 'no-credential', source: null }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(BALANCE_ENDPOINT, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${key.trim()}`,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      return { status: 'failed', source: 'api-key', httpStatus: response.status }
    }
    const body = await response.json()
    const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
    const wallets = []
    for (const info of infos) {
      const total = normalizeAmount(info?.total_balance)
      if (total === undefined) continue
      wallets.push({
        currency: info?.currency === 'CNY' ? 'CNY' : 'USD',
        total,
        toppedUp: normalizeAmount(info?.topped_up_balance) ?? total,
        granted: normalizeAmount(info?.granted_balance) ?? '0',
      })
    }
    if (wallets.length === 0 || body?.is_available === false) {
      return { status: 'unavailable', source: 'api-key', reason: 'no-available-balance' }
    }
    return { status: 'ready', source: 'api-key', wallets }
  } catch {
    return { status: 'failed', source: 'api-key' }
  } finally {
    clearTimeout(timer)
  }
}

function accountWallets(balance) {
  const toppedUp = new Map()
  const granted = new Map()
  const add = (map, wallet) => {
    if (wallet?.currency !== 'CNY' && wallet?.currency !== 'USD') return
    const amount = normalizeAmount(wallet.balance)
    if (amount === undefined) return
    map.set(wallet.currency, [...(map.get(wallet.currency) ?? []), amount])
  }
  for (const wallet of balance.value ?? []) add(toppedUp, wallet)
  for (const wallet of balance.bonusWallets ?? []) add(granted, wallet)
  const currencies = new Set([...toppedUp.keys(), ...granted.keys()])
  return [...currencies].map((currency) => {
    const topped = toppedUp.get(currency) ?? []
    const bonus = granted.get(currency) ?? []
    return {
      currency,
      total: sumAmounts([...topped, ...bonus]),
      toppedUp: sumAmounts(topped),
      granted: sumAmounts(bonus),
    }
  })
}

async function readBalance(ctx, client) {
  const account = ctx.get('deepseekAccount')
  if (account !== undefined) {
    try {
      const balance = await account.getBalance(client)
      if (balance === null) {
        const fallback = await readApiKeyBalance(ctx)
        return fallback.status === 'no-credential'
          ? { status: 'signed-out', source: null }
          : fallback
      }
      if (balance.status !== 'ready') {
        return { status: 'failed', source: 'account' }
      }
      return {
        status: 'ready',
        source: 'account',
        wallets: accountWallets(balance),
      }
    } catch {
      return { status: 'failed', source: 'account' }
    }
  }

  const fallback = await readApiKeyBalance(ctx)
  return fallback.status === 'no-credential'
    ? { status: 'unavailable', source: null, reason: 'no-credential' }
    : fallback
}

function accountClientMetadata(params) {
  const version = (params.get('version') ?? '').slice(0, 64)
  const locale = (params.get('locale') ?? 'en').slice(0, 32)
  const timezone = Number(params.get('tz'))
  return {
    version: version.length > 0 ? version : DEFAULT_CLIENT_VERSION,
    locale: locale.length > 0 ? locale : 'en',
    timezoneOffsetSeconds: Number.isFinite(timezone) ? timezone : 0,
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * One upstream wallet read at a time. The Client may ask for a balance on
 * every committed spend update from several Sessions at once; sharing the
 * in-flight read keeps that to one call to DeepSeek without introducing a
 * cache that would hide a top-up.
 */
let balanceInflight

function getBalance(ctx, client) {
  if (balanceInflight !== undefined) return balanceInflight
  const request = readBalance(ctx, client).finally(() => {
    if (balanceInflight === request) balanceInflight = undefined
  })
  balanceInflight = request
  return request
}

function createBalanceHandler(ctx) {
  return async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
      return
    }

    let params
    try {
      params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
    } catch {
      sendJson(response, 400, { ok: false, error: 'bad-request' })
      return
    }

    try {
      const balance = await getBalance(ctx, accountClientMetadata(params))
      sendJson(response, 200, { ok: true, balance, now: Date.now() })
    } catch {
      sendJson(response, 500, { ok: false, error: 'balance-failed' })
    }
  }
}

function createPricingHandler() {
  return async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    sendJson(response, 200, { ok: true, pricing: activePricing.raw, now: Date.now() })
  }
}

function createHandler(ctx) {
  return async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
      return
    }

    let params
    try {
      params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
    } catch {
      sendJson(response, 400, { ok: false, error: 'bad-request' })
      return
    }

    const force = params.get('refresh') === '1'
    const client = accountClientMetadata(params)
    try {
      const [balance, spend] = await Promise.all([
        getBalance(ctx, client),
        getSpend(ctx, force),
      ])
      sendJson(response, 200, {
        ok: true,
        balance,
        spend,
        now: Date.now(),
      })
    } catch {
      sendJson(response, 500, { ok: false, error: 'summary-failed' })
    }
  }
}

/** Required service; the other services used below are read opportunistically. */
export const inject = ['webServer']

/**
 * Mount the projection and the read-only summary route.
 * @param ctx - Host plugin context carrying the Web server.
 */
export function apply(ctx) {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(deepseekSpendProjection)
  })

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: createHandler(ctx),
    }),
    'spendwatch: summary route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: BALANCE_ROUTE_PATH,
      handler: createBalanceHandler(ctx),
    }),
    'spendwatch: balance route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: PRICING_ROUTE_PATH,
      handler: createPricingHandler(),
    }),
    'spendwatch: pricing route',
  )

  ctx.effect(() => {
    const initial = setTimeout(() => { void refreshPricing(ctx) }, 5_000)
    const repeat = setInterval(() => { void refreshPricing(ctx) }, PRICING_REFRESH_MS)
    initial.unref?.()
    repeat.unref?.()
    return () => {
      clearTimeout(initial)
      clearInterval(repeat)
    }
  }, 'spendwatch: pricing refresh')
}

export { deepseekSpendProjection, priceEvent }
