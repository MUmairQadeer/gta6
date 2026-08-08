import puppeteer from 'puppeteer-core'

const browserPath = process.env.CHROME_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const baseUrl = process.argv[2] || 'http://localhost:5173/'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let browser
const results = {}
try {
  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().startsWith('Failed to load resource')) {
      errors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message))

  await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 20000 })
  await wait(1200)

  const tiles = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    const tw = scene.map.tileWidth
    const buildingTiles = []
    for (let y = 0; y < scene.map.height; y++) {
      for (let x = 0; x < scene.map.width; x++) {
        if (scene.buildings.getTileAt(x, y)) {
          buildingTiles.push({ x: x * tw + tw / 2, y: y * tw + tw / 2, i: x, j: y })
        }
      }
    }
    return { buildingTiles }
  })

  // ---- S1: player stuck in a wall ----
  const b0 = tiles.buildingTiles[0]
  await page.evaluate((p) => {
    const scene = window.game.scene.getScenes(true)[0]
    scene.controlled = null
    scene.player.body.enable = true
    scene.player.visible = true
    scene.player.setPosition(p.x, p.y)
  }, b0)
  await wait(1200)
  results.playerStuck = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    const t = scene.buildings.getTileAtWorldXY(scene.player.x, scene.player.y)
    return { rescued: !t || t.index < 1, x: Math.round(scene.player.x), y: Math.round(scene.player.y) }
  })

  // ---- S2: car exiting spawns outside walls / rescue inside a building ----
  results.carExit = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    const car = scene.cars[0].sprite
    scene.player.setPosition(car.x, car.y)
    scene.controlled = null
    return true
  })
  await pressKey(page, 'KeyE')
  await pressKey(page, 'KeyE')
  await wait(300)
  results.carExit = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    const t = scene.buildings.getTileAtWorldXY(scene.player.x, scene.player.y)
    return { walkable: !t || t.index < 1 }
  })

  // drop car forcibly into a building center, drive for a bit, expect rescue
  results.carRescue = await page.evaluate((p) => {
    const scene = window.game.scene.getScenes(true)[0]
    const car = scene.cars[0]
    scene.controlled = car
    car.sprite.setPosition(p.x, p.y)
    car.sprite.setRotation(0)
    car.speed = 0
    car.sprite.body.setVelocity(0, 0)
    return true
  }, b0)
  await wait(3000)
  results.carRescue = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    const t = scene.buildings.getTileAtWorldXY(scene.cars[0].sprite.x, scene.cars[0].sprite.y)
    return { freed: !t || t.index < 1 }
  })
  await pressKey(page, 'KeyE') // exit so next tests start on foot

  // ---- S3: police stuck on obstacle -> must unstick and make progress ----
  const wallSpot = await page.evaluate((tiles) => {
    const scene = window.game.scene.getScenes(true)[0]
    let spot = null
    for (const t of tiles) {
      if (scene.buildings.getTileAt(t.i, t.j) && scene.buildings.getTileAt(t.i + 1, t.j)) {
        spot = t
        break
      }
    }
    return spot
  }, tiles.buildingTiles)
  await page.evaluate((wall) => {
    const scene = window.game.scene.getScenes(true)[0]
    scene.wantedLevel = 1
    scene.wantedTimer = 1e9
    scene.cops.forEach((c) => c.destroy())
    scene.cops.length = 0
    scene.spawnCop()
    const cop = scene.cops[0]
    // cop faces the wall (forward = +y), 26px in front of the wall
    cop.sprite.setPosition(wall.x, wall.y - 26)
    cop.sprite.setRotation(Math.PI)
    cop.car.speed = 0
    // player far behind the cop (not directly reachable)
    scene.player.setPosition(wall.x, wall.y + 260)
    scene.player.body.enable = true
    scene.player.visible = true
    scene.controlled = null
  }, wallSpot)
  const copStart = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    return { x: scene.cops[0].sprite.x, y: scene.cops[0].sprite.y }
  })
  await wait(6500)
  results.policeUnstick = await page.evaluate((start) => {
    const scene = window.game.scene.getScenes(true)[0]
    const cop = scene.cops[0]
    const s = cop.sprite
    return {
      moved: Math.round(Math.hypot(s.x - start.x, s.y - start.y)),
      nearPlayer: Math.round(Math.hypot(s.x - scene.player.x, s.y - scene.player.y))
    }
  }, copStart)

  // ---- S4: mission marker reliability + trigger radius ----
  results.missionTargets = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    scene.wantedLevel = 0
    scene.wantedTimer = 0
    scene.cops.forEach((c) => c.destroy())
    scene.cops.length = 0
    const tw = scene.map.tileWidth
    let okCount = 0
    const n = 60
    for (let i = 0; i < n; i++) {
      scene.missionActive = false
      scene.startMission()
      const t = scene.missionTarget
      const gx = Math.floor(t.x / tw)
      const gy = Math.floor(t.y / tw)
      const blocked = !!scene.buildings.getTileAt(gx, gy)
      let nOpen = false
      for (const [nx, ny] of [[gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]]) {
        const gt = scene.ground.getTileAt(nx, ny)
        if (gt && !scene.buildings.getTileAt(nx, ny)) nOpen = true
      }
      if (!blocked && nOpen) okCount++
      scene.missionActive = false
      scene.missionMarker.setVisible(false)
      scene.tweens.killTweensOf(scene.missionMarker)
    }
    return { tested: n, okCount }
  })

  results.missionTrigger = await page.evaluate(() => {
    const scene = window.game.scene.getScenes(true)[0]
    scene.missionActive = false
    scene.missionTimer = 0
    scene.startMission()
    const t = scene.missionTarget
    // far away: should not complete
    scene.player.setPosition(t.x - 120, t.y - 120)
    scene.missionActive = scene.missionActive
    const farBefore = scene.missionActive
    let farAfter = scene.missionActive
    let nearTriggered = false
    // simulate a couple of frames by calling updateMission directly
    scene.updateMission(0.05)
    farAfter = scene.missionActive
    // then walk inside radius
    scene.player.setPosition(t.x, t.y - 30)
    scene.missionActive = farAfter
    scene.updateMission(0.05)
    nearTriggered = !scene.missionActive
    return { farStayedActive: farAfter === true, nearTriggered }
  })

  await page.screenshot({ path: 'tools/edge.png' })

  console.log('playerStuck  :', JSON.stringify(results.playerStuck))
  console.log('carExit      :', JSON.stringify(results.carExit))
  console.log('carRescue    :', JSON.stringify(results.carRescue))
  console.log('policeUnstick:', JSON.stringify(results.policeUnstick))
  console.log('missionTargets:', JSON.stringify(results.missionTargets))
  console.log('missionTrigger:', JSON.stringify(results.missionTrigger))
  console.log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 10), null, 2) : 'NONE')

  const ok =
    results.playerStuck.rescued &&
    results.carExit.walkable &&
    results.carRescue.freed &&
    results.policeUnstick.moved > 60 &&
results.missionTargets.okCount === results.missionTargets.tested &&
    results.missionTrigger.farStayedActive &&
    results.missionTrigger.nearTriggered &&
    errors.length === 0
  process.exitCode = ok ? 0 : 1
  console.log(ok ? 'EDGE RESULT: PASS' : 'EDGE RESULT: FAIL')
} catch (e) {
  console.error('EDGE FAILED:', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
}

async function pressKey(page, key) {
  await page.keyboard.down(key)
  await wait(150)
  await page.keyboard.up(key)
  await wait(250)
}