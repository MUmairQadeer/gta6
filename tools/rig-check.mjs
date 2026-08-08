import puppeteer from 'puppeteer-core'
import zlib from 'node:zlib'

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function decodePng(buf) {
  let pos = 8
  let w = 0, h = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = 4
  const stride = w * ch
  const out = Buffer.alloc(w * h * ch)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 0xff
    }
    prev = Buffer.from(cur)
  }
  return { w, h, data: out }
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: false,
  defaultViewport: { width: 1280, height: 720 }
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

await page.goto('http://localhost:5200/', { waitUntil: 'load', timeout: 20000 })
await new Promise((r) => setTimeout(r, 5000))
await page.bringToFront()
await new Promise((r) => setTimeout(r, 2500))

await page.evaluate(() => window.__GAME3D.teleport(44 * 8, 44 * 8))
await new Promise((r) => setTimeout(r, 3000))

const measure = async () => {
  const { w, h, data } = decodePng(await page.screenshot({ type: 'png' }))
  const CW3 = 64, CH3 = 40
  const rows3 = []
  let skinPx = 0
  let brightPx = 0
  for (let gy = 0; gy < CH3; gy++) {
    let row = ''
    for (let gx = 0; gx < CW3; gx++) {
      let r = 0, g = 0, b = 0, n = 0
      const px0 = Math.floor((gx * w) / CW3)
      const px1 = Math.ceil(((gx + 1) * w) / CW3)
      const py0 = Math.floor((gy * h) / CH3)
      const py1 = Math.ceil(((gy + 1) * h) / CH3)
      for (let y = py0; y < py1; y++) {
        for (let x = px0; x < px1; x++) {
          const i = (y * w + x) * 4
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
          if (data[i] > 150 && data[i + 1] > 130 && data[i + 2] > 100) brightPx++
          if (data[i] > 140 && data[i + 1] > 90 && data[i + 2] > 60 && data[i] > data[i + 1] && data[i + 1] > data[i + 2]) { skinPx++ }
        }
      }
      r /= n; g /= n; b /= n
      if (g > r + 30 && g > b + 30 && g > 80 && g < 240) row += 'G'
      else if (r > 130 && r > b + 40 && r > g + 25 && g > 80 && r < 250) row += 'S'
      else if (b > 130 && b > r + 30 && b > g + 20) row += 'B'
      else if (r > 200 && g > 190 && b > 180) row += '.'
      else if (r < 70 && g < 70 && b < 70) row += '#'
      else row += ' '
    }
    rows3.push(row)
  }
  return { art: rows3.join('\n'), skinPx, brightPx }
}

const m0 = await measure()
await page.evaluate(() => window.__GAME3D.setNight(false))
await new Promise((r) => setTimeout(r, 300))
await page.evaluate(() => window.__GAME3D.testFlat('flat'))
await new Promise((r) => setTimeout(r, 1000))
const m1 = await measure()
await page.evaluate(() => window.__GAME3D.testFlat('orig'))
await page.evaluate(() => window.__GAME3D.teleport(1416, 2312))
await new Promise((r) => setTimeout(r, 3500))
await page.evaluate(() => window.__GAME3D.setOnlyPed(true))
await new Promise((r) => setTimeout(r, 1500))
const m3 = await measure()
const d3 = await page.evaluate(() => window.__GAME3D.debug())
console.log('ONLY PLAYER:\n' + m3.art + '\nskinPx=' + m3.skinPx + ' bright=' + m3.brightPx)
console.log(JSON.stringify({ ndc: d3.playerNdc, cam: d3.camera, pw: d3.playerWorld, f: d3.frameNo, calls: d3.rendererCalls, rs: d3.rendererState }))
await page.evaluate(() => window.__GAME3D.testFlat('flat'))
await new Promise((r) => setTimeout(r, 1000))
const m4 = await measure()
console.log('ONLY PLAYER + FLAT WHITE: skinPx=' + m4.skinPx + ' bright=' + m4.brightPx)
await page.evaluate(() => window.__GAME3D.testFlat('orig'))
await page.evaluate(() => window.__GAME3D.testBox(true))
await new Promise((r) => setTimeout(r, 1000))
const m5 = await measure()
await page.evaluate(() => {
  const b = window.__boxProbe
  const set = () => { if (b && b.material) b.material = new THREE.MeshLambertMaterial({ color: 0xff0000 }) }
  try { set() } catch (e) { window.__boxLambertErr = String(e) }
})
await new Promise((r) => setTimeout(r, 1200))
const m6 = await measure()
console.log('ONLY PLAYER + RED BOX (Basic): skinPx=' + m5.skinPx + ' bright=' + m5.brightPx)
console.log('ONLY PLAYER + RED BOX (Lambert): skinPx=' + m6.skinPx + ' bright=' + m6.brightPx)
console.log('errors:', errs.length ? JSON.stringify(errs.slice(0, 5)) : 'NONE')
await browser.close()