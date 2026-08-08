import puppeteer from 'puppeteer-core'

const browserPath = process.env.CHROME_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const baseUrl = process.argv[2] || 'http://localhost:5173/'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let browser
try {
  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })

  const errors = []
  const badReqs = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') &&
        !msg.text().startsWith('Failed to load resource') &&
        !msg.text().includes('AudioContext')) {
      errors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message))
  page.on('response', (res) => {
    if (res.status() >= 400) badReqs.push(res.status() + ' ' + res.url())
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 })

  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    await wait(500)
    ready = await page.evaluate(() => !!window.__GAME3D?.ready)
  }
  if (!ready) throw new Error('game never became ready')

  await wait(1500)

  const readPos = () => page.evaluate(() => window.__GAME3D.player)

  const spawn = await readPos()

  await page.keyboard.down('KeyW')
  let walked = 0
  for (let i = 0; i < 20 && walked < 60; i++) {
    await wait(400)
    const p = await readPos()
    walked = Math.abs(p.x - spawn.x) + Math.abs(p.y - spawn.y)
  }
  await page.keyboard.up('KeyW')
  await wait(300)
  const moved = await readPos()

  await page.evaluate(() => {
    const g = window.__GAME3D
    const p = g.player
    let best = null
    let bd = 1e9
    for (const c of g.cars()) {
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    if (best) g.teleport(best.x, best.y)
  })
  await wait(300)
  const enter = await page.evaluate(() => window.__GAME3D.enterCar())
  await wait(300)
  const entered = await page.evaluate(() => {
    const g = window.__GAME3D
    const p = g.player
    let best = null, bestS = -1, bestD = null
    const dirs = [[0, -1, 0], [0, 1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, Math.PI * 1.5]]
    for (const c of g.cars()) {
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (d > 800) continue
      for (const [dx, dy, rot] of dirs) {
        let n = 0
        for (let i = 1; i <= 12; i++) {
          const t = g.probe(Math.floor((c.x + dx * i * 16) / 16), Math.floor((c.y + dy * i * 16) / 16))
          if (t.b || t.g === 9) break
          n++
        }
        if (n > bestS) { bestS = n; best = c; bestD = [dx, dy, rot] }
      }
    }
    if (!best) return { ok: false }
    g.teleport(best.x, best.y)
    g.enterCar()
    g.aimRot(bestD[2])
    return { ok: true, score: bestS, pos: { x: best.x, y: best.y } }
  })
  if (!entered.ok) throw new Error('no drivable car found')
  const driveStart = await page.evaluate(() => window.__GAME3D.carPos())
  await page.keyboard.down('ArrowUp')
  let traveled = 0
  for (let i = 0; i < 24 && traveled < 40; i++) {
    await wait(500)
    traveled = await page.evaluate((sx, sy) => {
      const g = window.__GAME3D
      const p = g.carPos()
      return Math.hypot(p.x - sx, p.y - sy)
    }, driveStart.x, driveStart.y)
  }
  const driven = await page.evaluate(() => ({ speed: window.__GAME3D.speed, inCar: window.__GAME3D.inCar, pos: window.__GAME3D.carPos() }))
  await page.keyboard.up('ArrowUp')
  await page.keyboard.press('KeyE')
  await wait(400)
  const exited = await page.evaluate(() => ({ inCar: window.__GAME3D.inCar, cash: window.__GAME3D.hudCash }))

  await page.evaluate(() => window.__GAME3D.startMission())
  await wait(400)
  const mission = await page.evaluate(() => {
    const t = window.__GAME3D.missionTarget
    return { active: window.__GAME3D.missionActive, hasTarget: !!t }
  })
  await page.evaluate(() => {
    const t = window.__GAME3D.missionTarget
    window.__GAME3D.teleport(t.x, t.y)
  })
  await wait(700)
  const afterClaim = await page.evaluate(() => ({
    active: window.__GAME3D.missionActive,
    money: window.__GAME3D.money
  }))

  const hudVisible = await page.evaluate(() => {
    const ids = ['hud-cash', 'med-bar-wrap', 'hud-pos', 'hud-stars', 'hud-mini']
    const out = {}
    for (const id of ids) {
      const r = document.getElementById(id).getBoundingClientRect()
      out[id] = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) }
    }
    return out
  })

  await page.evaluate(() => window.__GAME3D.bustedTrigger())
  await wait(400)
  const busted = await page.evaluate(() => {
    const b = document.getElementById('hud-busted')
    return b.style.display === 'flex'
  })

  const health = await page.evaluate(() => window.__GAME3D.health)

  await page.screenshot({ path: 'tools/smoke3d.png' })

  console.log('spawn   :', JSON.stringify(spawn))
  console.log('after W :', JSON.stringify(moved))
  console.log('enter   :', JSON.stringify({ entered }))
  console.log('driven  :', JSON.stringify(driven), 'traveled', Math.round(traveled))
  console.log('exit    :', JSON.stringify(exited))
  console.log('mission :', JSON.stringify(mission), '->', JSON.stringify(afterClaim))
  console.log('hud rect:', JSON.stringify(hudVisible))
  console.log('busted  :', busted)
  console.log('health  :', health)
  console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'NONE')
  console.log('http 4xx/5xx:', badReqs.length ? JSON.stringify(badReqs, null, 2) : 'NONE')

  const movedOk = spawn ? Math.abs(moved.x - spawn.x) + Math.abs(moved.y - spawn.y) > 60 : false
  const driveOk = entered && driven.inCar && traveled > 40 && !exited.inCar
  const missionOk = mission.active && mission.hasTarget && !afterClaim.active && afterClaim.money === 550
  const hudOk = Object.values(hudVisible).every((r) => r.w > 0 && r.top >= 0 && r.left >= 0)
  const bustedOk = busted && health >= 0
  const ok = movedOk && driveOk && missionOk && hudOk && bustedOk && errors.length === 0 &&
    badReqs.every((r) => r.includes('favicon'))
  process.exitCode = ok ? 0 : 1
  console.log(ok ? '3D RESULT: PASS' : '3D RESULT: FAIL')
} catch (e) {
  console.error('3D FAILED:', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
}