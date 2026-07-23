// المندس minigame QA — drives every task to a WIN with real CDP input at full
// speed (headless Chrome pages are "visible" → no background timer throttling).
//
// Setup (one-off, dev machine only — deliberately NOT a package.json dep):
//   npm i --no-save puppeteer-core
//   npm run dev            (the harness must be serving on :5173)
// Run:
//   node scripts/mundass-qa.mjs [gameId ...]   (default: all 11)
// Expected output: {"wires":"WIN", ... "fix":"WIN"} — anything else is a
// regression in that minigame's interaction chain.
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:5173/__dev/mundass'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1400,900'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
await page.goto(URL, { waitUntil: 'networkidle2' })
await page.waitForSelector('.mun-canvas')
await sleep(600)

const rectOf = (sel, idx = 0) =>
  page.evaluate((s, i) => {
    const el = document.querySelectorAll(s)[i]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }, sel, idx)

const openGame = async (id) => {
  await page.evaluate(() => document.querySelector('.mun-modal-x')?.click())
  await sleep(120)
  await page.evaluate((gid) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === gid)
    b?.click()
  }, id)
  await page.waitForSelector('.mun-modal')
  await sleep(200)
}

const sawWin = async (timeout = 6000) => {
  try {
    await page.waitForSelector('.mun-g-successflash', { timeout })
    await page.waitForSelector('.mun-modal', { hidden: true, timeout: 3000 }).catch(() => {})
    return true
  } catch {
    return false
  }
}

const drag = async (from, to, steps = 10) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await sleep(40)
  await page.mouse.move(to.x, to.y, { steps })
  await sleep(40)
  await page.mouse.up()
  await sleep(60)
}

const GAMES = {
  async wires() {
    for (let i = 0; i < 4; i++) {
      const pair = await page.evaluate((idx) => {
        const svg = document.querySelector('.mun-g-svg')
        const sr = svg.getBoundingClientRect()
        const W = 340
        const sx = sr.width / W
        const sy = sr.height / 232
        const rects = [...svg.querySelectorAll('rect')]
        const nub = rects.filter((r) => r.getAttribute('x') === '6')[idx]
        const color = nub.getAttribute('fill')
        const right = rects.find((r) => r.getAttribute('x') === String(W - 40) && r.getAttribute('fill') === color)
        return {
          from: { x: sr.left + 23 * sx, y: sr.top + (parseFloat(nub.getAttribute('y')) + 12) * sy },
          to: { x: sr.left + (W - 23) * sx, y: sr.top + (parseFloat(right.getAttribute('y')) + 12) * sy },
        }
      }, i)
      await drag(pair.from, pair.to, 8)
    }
    return sawWin()
  },

  async tea() {
    const field = await rectOf('.mun-g-field')
    for (let i = 0; i < 4; i++) {
      const ing = await rectOf('.mun-g-ing')
      if (!ing) break
      await drag({ x: ing.cx, y: ing.cy }, { x: field.cx, y: field.y + field.h * 0.4 }, 8)
      await sleep(80)
    }
    // boil: lift inside the band
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      const h = await page.evaluate(() => parseFloat(document.querySelector('.mun-g-boilfill')?.style.height || '0'))
      if (h >= 86 && h <= 99) {
        await page.evaluate(() => document.querySelector('.mun-g-bigbtn')?.click())
        break
      }
      await sleep(40)
    }
    return sawWin()
  },

  async satellite() {
    // hill-climb each slider by reading the signal % readout
    const setVal = (idx, v) =>
      page.evaluate((i, val) => {
        const input = document.querySelectorAll('.mun-g-sliderlab input')[i]
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, String(val))
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, idx, v)
    const signal = () => page.evaluate(() => parseFloat(document.querySelector('.mun-g-signaltxt')?.textContent || '0'))
    for (const idx of [0, 1]) {
      let best = 0
      let bestV = 50
      for (let v = 0; v <= 100; v += 2) {
        await setVal(idx, v)
        await sleep(12)
        const s = await signal()
        if (s > best) { best = s; bestV = v }
      }
      for (let v = Math.max(0, bestV - 2); v <= Math.min(100, bestV + 2); v += 0.5) {
        await setVal(idx, v)
        await sleep(12)
        const s = await signal()
        if (s > best) { best = s; bestV = v }
      }
      await setVal(idx, bestV)
      await sleep(30)
    }
    return sawWin(6000) // lock needs ~900ms in-band
  },

  async laundry() {
    const field = await rectOf('.mun-g-field')
    for (let slot = 0; slot < 4; slot++) {
      const item = await rectOf('.mun-g-tray .mun-g-ing')
      if (!item) break
      await drag(
        { x: item.cx, y: item.cy },
        { x: field.x + field.w * (0.125 + slot * 0.25), y: field.y + field.h * 0.25 },
        8,
      )
      await sleep(80)
    }
    return sawWin()
  },

  async coffee() {
    const btn = await rectOf('.mun-g-mihbash')
    const t0 = Date.now()
    let lastGround = 0
    while (Date.now() - t0 < 25000) {
      const s = await page.evaluate(() => {
        const won = !!document.querySelector('.mun-g-successflash') || !document.querySelector('.mun-modal')
        const el = document.querySelector('.mun-g-beatring')
        const m = el ? /scale\(([\d.]+)\)/.exec(el.style.transform || '') : null
        return {
          won,
          scale: m ? parseFloat(m[1]) : null,
          ground: document.querySelectorAll('.mun-g-beans span.ground').length,
        }
      })
      if (s.won) return true
      if (s.ground !== lastGround) {
        lastGround = s.ground
        console.error(`  coffee: ${s.ground}/7 ground @${Date.now() - t0}ms`)
      }
      if (s.scale !== null && (s.scale < 1.12 || s.scale > 1.82)) {
        await page.mouse.click(btn.cx, btn.cy)
        await sleep(120)
      } else {
        await sleep(25)
      }
    }
    return sawWin(2000)
  },

  async plants() {
    const field = await rectOf('.mun-g-field')
    await page.mouse.move(field.x + field.w * 0.1, field.y + field.h * 0.6)
    await page.mouse.down()
    for (let pot = 0; pot < 5; pot++) {
      await page.mouse.move(field.x + field.w * (0.1 + pot * 0.2), field.y + field.h * 0.6, { steps: 4 })
      await sleep(1800)
    }
    await page.mouse.up()
    return sawWin(8000)
  },

  async olives() {
    const field = await rectOf('.mun-g-field')
    await page.mouse.move(field.cx, field.y + field.h * 0.7)
    await page.mouse.down()
    const t0 = Date.now()
    while (Date.now() - t0 < 30000) {
      const won = await page.evaluate(() => !!document.querySelector('.mun-g-successflash') || !document.querySelector('.mun-modal'))
      if (won) break
      const target = await page.evaluate(() => {
        const os = [...document.querySelectorAll('.mun-g-olive')]
        if (!os.length) return null
        let best = null
        for (const o of os) {
          const top = parseFloat(o.style.top)
          if (!best || top > best.top) best = { left: parseFloat(o.style.left), top }
        }
        return best
      })
      if (target) {
        await page.mouse.move(field.x + (field.w * target.left) / 100, field.y + field.h * 0.7, { steps: 2 })
      }
      await sleep(50)
    }
    await page.mouse.up()
    return sawWin(2000)
  },

  async shelf() {
    const layout = await page.evaluate(() =>
      [...document.querySelectorAll('.mun-g-shelf .mun-mg-slot .mun-mg-emoji')].map((e) => e.textContent))
    await sleep(3100) // memorize phase
    for (let slot = 0; slot < 4; slot++) {
      const chip = await page.evaluate((emoji) => {
        const c = [...document.querySelectorAll('.mun-mg-chip')].find((x) => x.querySelector('.mun-mg-emoji')?.textContent === emoji)
        if (!c) return null
        const r = c.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, layout[slot])
      if (!chip) return false
      await page.mouse.click(chip.x, chip.y)
      await sleep(90)
      const slotR = await rectOf('.mun-g-shelf .mun-mg-slot', slot)
      await page.mouse.click(slotR.cx, slotR.cy)
      await sleep(90)
    }
    return sawWin()
  },

  async gas() {
    const spin = async (dir) => { // dir -1 = CCW (close), +1 = CW (open)
      const v = await rectOf('.mun-g-valvewheel')
      const R = 34
      await page.mouse.move(v.cx, v.cy - R)
      await page.mouse.down()
      for (let a = 0; a <= 560; a += 12) {
        const rad = (-Math.PI / 2) + dir * (a * Math.PI) / 180
        await page.mouse.move(v.cx + Math.cos(rad) * R, v.cy + Math.sin(rad) * R)
      }
      await page.mouse.up()
      await sleep(120)
    }
    await spin(-1) // close the valve
    // drag the old jarrah out to the right edge
    const field = await rectOf('.mun-g-field')
    const oldJar = await rectOf('.mun-g-jarrah.old')
    if (oldJar) await drag({ x: oldJar.cx, y: oldJar.cy }, { x: field.x + field.w * 0.92, y: oldJar.cy }, 10)
    await sleep(150)
    const newJar = await rectOf('.mun-g-jarrah.new')
    if (newJar) await drag({ x: newJar.cx, y: newJar.cy }, { x: field.x + field.w * 0.32, y: newJar.cy }, 10)
    await sleep(150)
    await spin(1) // open the valve
    return sawWin()
  },

  async water() {
    const btn = await rectOf('.mun-mg-mash')
    let holding = false
    const t0 = Date.now()
    while (Date.now() - t0 < 25000) {
      const s = await page.evaluate(() => ({
        won: !!document.querySelector('.mun-g-successflash') || !document.querySelector('.mun-modal'),
        needle: parseFloat(document.querySelector('.mun-g-needle2')?.style.left || '0'),
        pct: parseFloat(document.querySelector('.mun-mg-jar-water')?.style.height || '0'),
      }))
      if (s.won) break
      const good = s.needle >= 44 && s.needle <= 70
      if (s.pct >= 82 && s.pct <= 95) {
        if (holding) { await page.mouse.up(); holding = false } // release inside the band
      } else if (good && !holding && s.pct < 82) {
        await page.mouse.move(btn.cx, btn.cy)
        await page.mouse.down()
        holding = true
      } else if (!good && holding) {
        await page.mouse.up()
        holding = false
      }
      await sleep(35)
    }
    if (holding) await page.mouse.up()
    return sawWin(2000)
  },

  async fix() {
    const t0 = Date.now()
    while (Date.now() - t0 < 12000) {
      const done = await page.evaluate(() => {
        if (document.querySelector('.mun-g-successflash') || !document.querySelector('.mun-modal')) return true
        const offs = [...document.querySelectorAll('.mun-g-switch:not(.on)')]
        offs.forEach((s) => s.click())
        return false
      })
      if (done) break
      await sleep(150)
    }
    return sawWin(2000)
  },
}

const wanted = process.argv.slice(2)
const ids = wanted.length ? wanted : Object.keys(GAMES)
const report = {}
for (const id of ids) {
  try {
    await openGame(id)
    report[id] = (await GAMES[id]()) ? 'WIN' : 'FAILED'
  } catch (e) {
    report[id] = `ERROR: ${e.message.slice(0, 90)}`
  }
}
console.log(JSON.stringify(report, null, 2))
await browser.close()
