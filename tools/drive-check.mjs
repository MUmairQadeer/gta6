import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
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
await sleep(5000)
await page.bringToFront()
await sleep(2500)

await page.evaluate(() => {
  const cars = window.__GAME3D.cars()
  let best = cars[0]
  let bestD = Infinity
  const px = 44 * 8, py = 44 * 8
  for (const c of cars) {
    const d = (c.x - px) ** 2 + (c.y - py) ** 2
    if (d < bestD) { bestD = d; best = c }
  }
  window.__GAME3D.teleport(best.x + 8, best.y + 8)
})
await sleep(1000)

const s = () => page.evaluate(() => ({
  inCar: window.__GAME3D.inCar,
  speed: window.__GAME3D.speed,
  brake: window.__GAME3D.brakeLight,
  honking: window.__GAME3D.honking
}))

// enter vehicle
const cars = await page.evaluate(() => window.__GAME3D.cars())
check('cars exist', cars.length > 0, `n=${cars.length}`)
await page.evaluate(() => window.__GAME3D.enterCar())
await sleep(400)
let st = await s()
check('entered car', st.inCar === true)

// accelerate
await page.keyboard.down('w')
await sleep(1600)
st = await s()
check('accelerates', st.speed > 100, `speed=${st.speed}`)

// handbrake
await page.keyboard.down('Space')
await sleep(250)
st = await s()
check('handbrake engages (brake light on)', st.brake > 1.5, `emissive=${st.brake}`)
const spBefore = st.speed
await sleep(1500)
st = await s()
check('handbrake decelerates', st.speed < spBefore * 0.5, `speed ${spBefore} -> ${st.speed}`)
await page.keyboard.up('Space')
await sleep(300)
st = await s()
check('brake light off after release', st.brake === 0, `emissive=${st.brake}`)

// reverse braking lights (S while moving forward)
await page.keyboard.down('s')
await page.keyboard.up('w')
await sleep(250)
st = await s()
check('foot brake lights (S)', st.brake > 1.5, `emissive=${st.brake}`)
await page.keyboard.up('s')
await sleep(500)

// horn
await page.keyboard.down('h')
await sleep(200)
st = await s()
check('horn flag on while held', st.honking === true)
await page.keyboard.up('h')
await sleep(150)
st = await s()
check('horn flag off on release', st.honking === false)

// crash detection still alive
await page.keyboard.up('w')

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '))

console.log(results.join('\n'))
await browser.close()
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
