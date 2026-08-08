import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const ang = (a, b) => {
  const d = a[0] * b[0] + a[1] * b[1]
  const la = Math.hypot(...a) || 1
  const lb = Math.hypot(...b) || 1
  return Math.acos(Math.max(-1, Math.min(1, d / (la * lb))))
}
const degStr = (rad) => (rad * 180 / Math.PI).toFixed(1)

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: false,
  defaultViewport: { width: 1280, height: 720 }
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => console.log('[pg]', m.type(), m.text().slice(0, 300)))

await page.goto('http://localhost:5200/', { waitUntil: 'load', timeout: 20000 })
await sleep(5000)
await page.bringToFront()
await sleep(2500)

// pick a parked car with the most open space around it (same ring scoring as aimFree)
const RINGS = [4, 8, 12, 20, 30, 45, 70, 100, 140]
const picked = await page.evaluate(([RINGS]) => {
  const G = window.__GAME3D
  const inB = (x, y) => x >= 96 && x <= 1952 && y >= 96 && y <= 1952
  let best = null
  let bestScore = -1
  for (const c of G.cars()) {
    if (G.circle(c.x, c.y, 9.5)) continue // car wedged inside a solid — never drivable
    let top = 0
    for (let a = 0; a < 16; a++) {
      const an = a / 16 * Math.PI * 2
      let f = 0
      for (const d of RINGS) {
        const px = c.x + Math.sin(an) * d
        const py = c.y - Math.cos(an) * d
        if (inB(px, py) && !G.circle(px, py, 9)) f++
      }
      if (f > top) top = f
    }
    if (top > bestScore) { bestScore = top; best = c }
  }
  return { x: best.x, y: best.y, bestScore }
}, [RINGS])
if (picked.bestScore < 7) {
  console.log(`FAIL  no car with a clear lane (best lane has ${picked.bestScore}/${RINGS.length} rings open)`)
  process.exit(1)
}
console.log(`picked car @ (${picked.x},${picked.y}) lanes=${picked.bestScore}/${RINGS.length}`)
await page.evaluate(([x, y]) => window.__GAME3D.teleport(x + 8, y + 8), [picked.x, picked.y])
await sleep(1200)
await page.evaluate(() => window.__GAME3D.enterCar())
await sleep(500)

const state = async () => {
  try {
    const r = await page.evaluate(() => {
      const G = window.__GAME3D
      if (!G) return { __missing: true }
      return {
        r: G.carR,
        p: G.carPos(),
        sp: G.speed
      }
    })
    if (r && r.__missing) { console.log('  !! __GAME3D missing'); return null }
    return r
  } catch (e) {
    console.log('  !! state error:', e.message)
    return null
  }
}

// aim the car's nose along a clear lane where motion will happen.
// mode 'front' checks the lanes ahead of the nose (driving W), mode 'rear'
// checks the lanes behind (driving S while reversing). idx = (idx+1)-th best.
const aimFree = async (mode = 'front', idx = 0) => {
  const r = await page.evaluate(([mode, idx, R]) => {
    const G = window.__GAME3D
    const p = G.carPos()
    const inB = (x, y) => x >= 96 && x <= 1952 && y >= 96 && y <= 1952
    const scores = []
    for (let a = 0; a < 16; a++) {
      const an = a / 16 * Math.PI * 2
      const sx = mode === 'rear' ? -Math.sin(an) : Math.sin(an)
      const sy = mode === 'rear' ? Math.cos(an) : -Math.cos(an)
      let f = 0
      for (const dist of R) {
        const px = p.x + sx * dist
        const py = p.y + sy * dist
        if (inB(px, py) && !G.circle(px, py, 9)) f++
      }
      scores.push([an, f])
    }
    scores.sort((x, y) => y[1] - x[1])
    return scores[idx % scores.length][0]
  }, [mode, idx, RINGS])
  await page.evaluate((an) => { window.__GAME3D.aimRot(an) }, r)
  await sleep(200)
  return r
}

const fullstop = async () => {
  await page.keyboard.down(' ')
  await sleep(1600)
  await page.keyboard.up(' ')
  await sleep(250)
}

// hold a key along a clear lane for `holdMs`; retries pick the next-best lane
// until real travel is seen. returns {s0, s1, travel, len} or null if blocked
const driveBurst = async (mode, holdMs, key) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await aimFree(mode, attempt) } catch (e) { console.log('  !! aimFree error:', e.message) }
    const s0 = await state()
    if (!s0) { console.log('  !! abort burst, no state'); return null }
    try { await page.keyboard.down(key) } catch (e) { console.log('  !! keydown error:', e.message) }
    await sleep(holdMs)
    await page.keyboard.up(key)
    await sleep(150)
    const s1 = await state()
    const travel = [s1.p.x - s0.p.x, s1.p.y - s0.p.y]
    const len = Math.hypot(...travel)
    console.log(`  [burst ${key} m=${mode} a=${attempt}] r=${s0.r.toFixed(2)} sp=${s0.sp.toFixed(0)}->${s1.sp.toFixed(0)} moved=${len.toFixed(1)}u`)
    if (len >= 12) return { s0, s1, travel, len }
    await fullstop()
  }
  return null
}

// test 1: W moves along the nose (aimed along a verified-clear lane)
{
  const b = await driveBurst('front', 2200, 'w')
  if (!b) { check('W moves along car nose', false, 'no clear lane found') }
  else {
    const nose = [-Math.sin(b.s0.r), -Math.cos(b.s0.r)]
    const a = degStr(ang(b.travel, nose))
    check('W moves along car nose', +a < 25, `offset ${a}° moved ${b.len.toFixed(0)}u r=${b.s0.r.toFixed(2)}`)
  }
  await fullstop()
}

// test 2: steering while stationary has no effect
{
  const s0 = await state()
  await page.keyboard.down('a')
  await sleep(700)
  await page.keyboard.up('a')
  await sleep(150)
  const s1 = await state()
  check('no turn while stationary', Math.abs(s1.r - s0.r) < 0.02, `Δr=${Math.abs(s1.r - s0.r).toFixed(3)}`)
}

// test 3: steering turns the nose and travel follows the turned nose
{
  await aimFree()
  const s0 = await state()
  await page.keyboard.down('w')
  await sleep(1500)
  await page.keyboard.down('a')
  await sleep(900)
  await page.keyboard.up('a')
  await sleep(100)
  const s1 = await state()
  const b = await driveBurst('front', 1500, 'w')
  if (!b) { check('travel follows turned nose', false, 'no clear lane found') }
  else {
    const nose = [-Math.sin(b.s0.r), -Math.cos(b.s0.r)]
    const diff = degStr(ang(b.travel, nose))
    check('travel follows turned nose', +diff < 35, `offset ${diff}° (arc-tolerant, steer-release tail)`)
  }
  check('A turns the nose left', s1.r - s0.r > 0.06, `Δr=+${(s1.r - s0.r).toFixed(3)}`)
  await fullstop()
}

// test 4: S reverses along -nose (aim onto a clear rear lane first)
{
  const b = await driveBurst('rear', 1800, 's')
  if (!b) { check('S moves along -nose', false, 'no clear rear lane found') }
  else {
    const nose = [-Math.sin(b.s0.r), -Math.cos(b.s0.r)]
    const rev = degStr(ang(b.travel, [-nose[0], -nose[1]]))
    check('S moves along -nose', +rev < 25, `vs -nose ${rev}° moved ${b.len.toFixed(0)}u`)
  }
  await fullstop()
}

// test 5: camera angle (2.4 rad = 137°) does not affect car heading or travel
{
  await page.evaluate(() => { window.__GAME3D.setCam(2.4) })
  const b = await driveBurst('front', 2000, 'w')
  if (!b) { check('car ignores camera yaw', false, 'no clear lane found') }
  else {
    const nose = [-Math.sin(b.s0.r), -Math.cos(b.s0.r)]
    const a = degStr(ang(b.travel, nose))
    const camRead = await page.evaluate(() => window.__GAME3D.camYaw)
    check('car ignores camera yaw', +a < 12 && Math.abs(b.s1.r - b.s0.r) < 0.6, `offset ${a}° cam=${camRead.toFixed(2)} Δr=${(b.s1.r - b.s0.r).toFixed(3)}`)
  }
  await fullstop()
}

// test 6: on-foot movement remains camera-relative after exit
{
  await page.keyboard.down('e')
  await sleep(300)
  await page.keyboard.up('e')
  await sleep(300)
  const spot = await page.evaluate(() => {
    const G = window.__GAME3D
    for (let y = 20; y < 180; y++) {
      for (let x = 20; x < 180; x++) {
        let ok = true
        for (let dx = -2; dx <= 2 && ok; dx++) {
          for (let dy = -2; dy <= 2 && ok; dy++) {
            const t = G.probe(x + dx, y + dy)
            if (t.solid) ok = false
          }
        }
        if (ok) return [x * 16 + 8, y * 16 + 8]
      }
    }
    return null
  })
  if (spot) {
    await page.evaluate(([sx, sy]) => {
      const G = window.__GAME3D
      G.teleport(sx, sy)
      let freeA = 0
      for (let a = 0; a < 8; a++) {
        const an = a / 8 * Math.PI * 2
        if (!G.circle(sx + Math.sin(an) * 50, sy - Math.cos(an) * 50, 7)) { freeA = an; break }
      }
      G.setCam(Math.atan2(-Math.sin(freeA), Math.cos(freeA)), 0.55)
    }, spot)
    await sleep(400)
    const p0 = await page.evaluate(() => window.__GAME3D.playerPos)
    let p1 = null
    for (let attempt = 0; attempt < 3 && !p1; attempt++) {
      await page.keyboard.down('w')
      await sleep(700)
      await page.keyboard.up('w')
      await sleep(150)
      const pa = await page.evaluate(() => window.__GAME3D.playerPos)
      if (Math.hypot(pa.x - p0.x, pa.y - p0.y) >= 8) p1 = pa
    }
    if (!p1) {
      check('on-foot W follows camera yaw', false, 'blocked at spot')
    } else {
      const travel = [p1.x - p0.x, p1.y - p0.y]
      const cam = await page.evaluate(() => window.__GAME3D.camYaw)
      const camDir = [-Math.sin(cam), -Math.cos(cam)]
      const a = degStr(ang(travel, camDir))
      check('on-foot W follows camera yaw', +a < 25, `offset ${a}° moved ${Math.hypot(...travel).toFixed(0)}u cam=${cam.toFixed(2)}`)
    }
  } else {
    check('on-foot W follows camera yaw', false, 'no open spot found')
  }
}

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '))

console.log(results.join('\n'))
await browser.close()
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)