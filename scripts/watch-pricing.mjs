/**
 * Weekly watcher for DeepSeek's pricing page.
 *
 * The page is a client-rendered Docusaurus SPA, so a plain HTTP fetch returns
 * the shell. Playwright renders it, then:
 *   - the article text is snapshotted (for a human to diff rates), and
 *   - if the peak windows are parseable and different, a new price-book period
 *     is appended with `from` set to the detection time.
 *
 * The workflow turns the changes into a pull request; nothing lands on main
 * without review. If the page cannot be rendered or parsed, the job fails
 * loudly instead of guessing.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { normalizeText, parseWindows } from './pricing-parse.mjs'

const PAGE = 'https://api-docs.deepseek.com/quick_start/pricing'
const BOOK = 'pricing.json'
const SNAPSHOT = 'scripts/pricing-source.txt'
const HASH = 'scripts/pricing-source.sha256'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } })
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('article', { timeout: 45_000 })
  await page.waitForFunction(
    () => /peak|off-peak/i.test(document.body.innerText),
    undefined,
    { timeout: 45_000 },
  )
  const text = normalizeText(await page.locator('article').first().innerText())
  if (text.length < 400) throw new Error('the pricing article rendered too short to trust')

  const hash = createHash('sha256').update(text).digest('hex')
  const previous = existsSync(HASH) ? readFileSync(HASH, 'utf8').trim() : ''
  if (hash === previous) {
    console.log('pricing page unchanged')
  } else {
    writeFileSync(SNAPSHOT, `${text}\n`)
    writeFileSync(HASH, `${hash}\n`)
    console.log('pricing page changed; snapshot updated')

    const windows = parseWindows(text)
    const ordered = windows.every((window, index) => index === 0 || window.start >= windows[index - 1].end)
    if (windows.length > 0 && windows.length <= 4 && ordered) {
      const book = JSON.parse(readFileSync(BOOK, 'utf8'))
      const latest = book.periods[book.periods.length - 1]
      if (JSON.stringify(latest.windows) !== JSON.stringify(windows)) {
        const from = new Date().toISOString()
        book.periods.push({ from, weekdays: latest.weekdays, windows, rates: latest.rates })
        book.updated = from.slice(0, 10)
        writeFileSync(BOOK, `${JSON.stringify(book, null, 2)}\n`)
        console.log(`peak windows updated to ${JSON.stringify(windows)} from ${from}`)
      } else {
        console.log('peak windows unchanged')
      }
    } else {
      console.log(`peak windows not parsed safely (${JSON.stringify(windows)}); snapshot only`)
    }
  }
} finally {
  await browser.close()
}
