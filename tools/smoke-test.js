import puppeteer from 'puppeteer-core'

const browserPath = process.env.CHROME_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const baseUrl = process.argv[2] || 'http://localhost:5173/'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const press = async (page, key) => {
  await page.keyboard.down(key)
  await wait(150)
  await page.keyboard.up(key)
  await wait(250)
}

let browser
try {
  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })

  const errors = []
  const badReqs = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().startsWith('Failed to load resource')) {
      errors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message))
  page.on('response', (res) => {
    if (res.status() >= 400) badReqs.push(res.status() + ' ' + res.url())
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 20000 })
  await wait(1200)

  const readPlayer = () =>
    page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      const p = scene.player
      if (!p) return null
      return { x: Math.round(p.x), y: Math.round(p.y) }
    })

  const spawn = await readPlayer()
  await press(page, 'KeyD')
  await wait(600)
  await press(page, 'KeyW')
  await wait(600)
  const moved = await readPlayer()

  const carTest = await (async () => {
    const before = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      const car = scene.cars[0].sprite
      scene.player.setPosition(car.x, car.y)
      scene.player.body.setVelocity(0, 0)
      return { x: car.x, y: car.y }
    })
    await press(page, 'KeyE')
    const entered = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return {
        controlled: !!scene.controlled,
        sameCar: scene.controlled ? scene.controlled.sprite === scene.cars[0].sprite : false,
        playerHidden: !scene.player.visible
      }
    })
    await page.keyboard.down('ArrowUp')
    await wait(1000)
    await page.keyboard.up('ArrowUp')
    await wait(200)
    const after = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return { x: scene.cars[0].sprite.x, y: scene.cars[0].sprite.y, speed: Math.round(scene.cars[0].speed) }
    })
    await press(page, 'KeyE')
    const exited = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return { controlled: !!scene.controlled, playerVisible: scene.player.visible }
    })
    return {
      entered,
      moved: { speed: after.speed, px: Math.round(Math.hypot(after.x - before.x, after.y - before.y)) },
      exited
    }
  })()

  const wantedTest = await (async () => {
    await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      const car = scene.cars[0].sprite
      const pedInst = scene.peds[0]
      const ped = pedInst.sprite
      scene.wantedLevel = 0
      scene.wantedTimer = 0
      scene.cops.forEach((c) => c.destroy())
      scene.cops.length = 0
      scene._lastOffenseAt = -Infinity
      pedInst.target = null
      pedInst.idle = 999
      pedInst.timer = 1e9
      ped.setPosition(520, 500)
      ped.setVelocity(0, 0)
      ped.setFlipY(false)
      ped.setAlpha(1)
      car.setPosition(520, 548)
      car.rotation = 0
      scene.cars[0].speed = 0
      scene.player.setPosition(520, 560)
      scene.player.body.enable = true
      scene.player.visible = true
      scene.controlled = null
      scene.cameras.main.startFollow(car, true, 0.09, 0.09)
    })
    await press(page, 'KeyE')
    const entered = await page.evaluate(() => !!window.game.scene.getScenes(true)[0].controlled)
    await wait(300)
    await page.keyboard.down('ArrowUp')
    await wait(1600)
    await page.keyboard.up('ArrowUp')
    await wait(300)
    const result = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return {
        wantedLevel: scene.wantedLevel,
        cops: scene.cops.length,
        stars: scene.starsText.text,
        pedKnocked: scene.peds.some((p) => !p.sprite.body.enable)
      }
    })
    return { entered, result }
  })()

  const missionTest = await (async () => {
    const before = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      scene.controlled = null
      scene.player.body.enable = true
      scene.player.visible = true
      scene.player.setVelocity(0, 0)
      scene.player.setFlipY(false)
      scene.missionTimer = 0
      scene.missionActive = false
      scene.wantedLevel = 0
      scene.wantedTimer = 0
      scene._lastOffenseAt = -Infinity
      scene.cops.forEach((c) => c.destroy())
      scene.cops.length = 0
      return { money: scene.money }
    })
    const started = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      scene.startMission()
      const t = scene.missionTarget
      scene.player.setPosition(t.x, t.y - 30)
      return { active: scene.missionActive, markerVisible: scene.missionMarker.visible }
    })
    await wait(500)
    const after = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return {
        active: scene.missionActive,
        money: scene.money,
        banner: scene.message.text
      }
    })
    return { before: before.money, started, after }
  })()

const bustedTest = await (async () => {
    await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      scene.controlled = null
      scene.player.body.enable = true
      scene.player.visible = true
      scene.player.setVelocity(0, 0)
      scene.busted = false
      scene.catchCooldown = 0
      scene.wantedLevel = 3
      scene.wantedTimer = 1e9
      scene.cops.forEach((c) => c.destroy())
      scene.cops.length = 0
      scene.spawnCop()
      const cop = scene.cops[scene.cops.length - 1]
      cop.sprite.setPosition(scene.player.x + 8, scene.player.y + 8)
      cop.car.speed = 0
    })
    await wait(700)
    let caught = null
    try {
      caught = await page.evaluate(() => {
        const scene = window.game.scene.getScenes(true)[0]
        if (!scene) throw new Error('no scene in caught')
        return { busted: scene.busted, overlay: scene.bustedOverlay.visible }
      })
    } catch (e) {
      caught = { error: e.message }
    }
    await press(page, 'KeyR')
    await wait(600)
    let restarted = null
    try {
      restarted = await page.evaluate(() => {
        const scene = window.game.scene.getScenes(true)[0]
        if (!scene) throw new Error('no scene after restart')
        return {
          busted: scene.busted,
          money: scene.money,
          stars: scene.starsText.text,
          cops: scene.cops.length,
          player: scene.player.visible
        }
      })
    } catch (e) {
      restarted = { error: e.message }
    }
    return { caught, restarted }
  })()

  const hudTest = await (async () => {
    const base = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return {
        minimap: !!scene.minimap && scene.minimap.visible,
        dots: !!scene.minimapDots,
        overlay: !!scene.nightOverlay,
        label: scene.minimapLabel.text,
        night: scene.isNight
      }
    })
    await press(page, 'KeyT')
    const night = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return { isNight: scene.isNight, alpha: scene.nightOverlay.alpha }
    })
    await press(page, 'KeyT')
    const day = await page.evaluate(() => {
      const scene = window.game.scene.getScenes(true)[0]
      return { isNight: scene.isNight, alpha: scene.nightOverlay.alpha }
    })
    return { base, night, day }
  })()

  await page.screenshot({ path: 'tools/smoke.png' })

  console.log('foot spawn:', JSON.stringify(spawn))
  console.log('after WASD:', JSON.stringify(moved))
  console.log('car test:', JSON.stringify(carTest))
  console.log('wanted test:', JSON.stringify(wantedTest))
  console.log('mission test:', JSON.stringify(missionTest))
  console.log('busted test:', JSON.stringify(bustedTest))
  console.log('hud test:', JSON.stringify(hudTest))
  console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'NONE')
  console.log('http 4xx/5xx:', badReqs.length ? JSON.stringify(badReqs, null, 2) : 'NONE')

  const footMoved = spawn && moved && (Math.abs(moved.x - spawn.x) > 20 || Math.abs(moved.y - spawn.y) > 20)
  const carOk =
    carTest.entered.controlled &&
    carTest.entered.sameCar &&
    carTest.entered.playerHidden &&
    carTest.moved.speed > 50 &&
    carTest.moved.px > 20 &&
    !carTest.exited.controlled &&
    carTest.exited.playerVisible
  const wantedOk =
    wantedTest.entered &&
    wantedTest.result.wantedLevel >= 1 &&
    wantedTest.result.cops >= 1 &&
    wantedTest.result.pedKnocked
  const missionOk =
    missionTest.started.active &&
    missionTest.started.markerVisible &&
    !missionTest.after.active &&
    missionTest.after.money === missionTest.before + 250 &&
    missionTest.after.banner.includes('MISSION COMPLETE')
  const bustedOk =
    bustedTest.caught.busted &&
    bustedTest.caught.overlay &&
    !bustedTest.restarted.busted &&
    bustedTest.restarted.money === 300 &&
    bustedTest.restarted.stars === '☆☆☆☆☆' &&
    bustedTest.restarted.cops === 0 &&
    bustedTest.restarted.player
  const hudOk =
    hudTest.base.minimap &&
    hudTest.base.dots &&
    hudTest.base.label === 'MINIMAP' &&
    !hudTest.base.night &&
    hudTest.night.isNight &&
    hudTest.night.alpha > 0.2 &&
    !hudTest.day.isNight &&
    hudTest.day.alpha < hudTest.night.alpha
  const ok = footMoved && carOk && wantedOk && missionOk && bustedOk && hudOk && errors.length === 0 && badReqs.every((r) => r.includes('favicon'))
  process.exitCode = ok ? 0 : 1
  console.log(ok ? 'SMOKE RESULT: PASS' : 'SMOKE RESULT: FAIL')
} catch (e) {
  console.error('SMOKE FAILED:', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
}