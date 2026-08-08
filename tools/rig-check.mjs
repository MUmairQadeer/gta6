import puppeteer from 'puppeteer-core'
import fs from 'fs'

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: process.argv.includes('headless'),
  args: ['--window-size=1280,720']
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))

const port = process.argv.includes('port5199') ? 5199 : 5200
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 25000 })
await new Promise((r) => setTimeout(r, 5000))

const painted = await page.evaluate(() => {
  const g = window.__GAME3D
  if (!g || !g.testPaint) return false
  g.testPaint(true)
  return true
})
await page.keyboard.down('KeyW')
await new Promise((r) => setTimeout(r, 800))
await page.keyboard.up('KeyW')
await new Promise((r) => setTimeout(r, 300))

const buf = await page.screenshot({ encoding: 'binary' })
const b64 = buf.toString('base64')
fs.writeFileSync(`C:/Users/NIC/AppData/Local/Temp/opencode/paint-${port}.png`, buf)

await page.goto('about:blank')
const res = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  const cx = c.width >> 1
  const cy = c.height >> 1
  let magenta = 0
  let centerMagenta = 0
  let diff = 0
  const seen = new Set()
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4
      const r = d[i], g = d[i + 1], b = d[i + 2]
      seen.add((r >> 5) + ',' + (g >> 5) + ',' + (b >> 5))
      if (r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 80) {
        magenta++
        if (Math.abs(x - cx) < c.width * 0.3 && Math.abs(y - cy) < c.height * 0.4) centerMagenta++
      }
    }
  }
  return { magenta, centerMagenta, distinct: seen.size }
}, b64)

console.log(`port ${port} painted=${painted} ->`, JSON.stringify(res))
console.log('errors:', errs.length ? JSON.stringify(errs, null, 2) : 'NONE')
await browser.close()