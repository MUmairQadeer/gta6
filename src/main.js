import Phaser from 'phaser'
import { Car, makeCarTextures, makePoliceTexture } from './Car.js'
import { makeCharacterTexture } from './character.js'
import { PED_SHIRTS, Pedestrian, respawnPedestrian } from './Pedestrian.js'
import { Police } from './Police.js'
import { unlockAudio, setEngine, playCrash, playBusted } from './audio.js'

const WALK_SPEED = 260
const SPRINT_SPEED = 420
const CORNER_ZOOM_MIN = 1.4
const CORNER_ZOOM_MAX = 3
const ENTER_RADIUS = 42
const PEDESTRIAN_COUNT = 44
const MISSION_REWARD = 250
const MISSION_CLAIM_RADIUS = 70
const MISSION_MIN_DISTANCE = 420
const MISSION_RESTART_MS = 5000

function makeMissionTexture(scene) {
  if (scene.textures.exists('mission-marker')) return
  const t = scene.textures.createCanvas('mission-marker', 32, 32)
  const c = t.getContext()
  c.strokeStyle = 'rgba(0,0,0,0.55)'
  c.lineWidth = 5
  c.beginPath()
  c.arc(16, 16, 14, 0, Math.PI * 2)
  c.stroke()
  c.fillStyle = '#ffe24a'
  c.beginPath()
  c.arc(16, 16, 10, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = '#7a5c00'
  c.lineWidth = 2
  c.stroke()
  c.fillStyle = '#1b1300'
  c.beginPath()
  c.arc(16, 16, 4.5, 0, Math.PI * 2)
  c.fill()
  t.refresh()
  return t
}

class CityScene extends Phaser.Scene {
  init() {
    this.keys = null
    this.cars = []
    this.carSprites = []
    this.controlled = null
    this.moveLerp = 0.22
    this.peds = []
    this.cops = []
    this.wantedLevel = 0
    this.wantedTimer = 0
    this._lastOffenseAt = -Infinity
    this.missionActive = false
    this.missionTarget = null
    this.missionTimer = 1200
    this.busted = false
    this.catchCooldown = 0
    this.baseZoom = 2
    this._lastCrashSoundAt = 0
    this._lastUnstuck = 0
    this.isNight = false
  }

  preload() {
    this.load.image('tiles', 'assets/map/tiles.png')
    this.load.tilemapTiledJSON('city', 'assets/map/city.json')
  }

  create() {
    this.map = this.make.tilemap({ key: 'city' })
    this.tileset = this.map.addTilesetImage('tiles', 'tiles')
    const tileset = this.tileset

    this.ground = this.map.createLayer('ground', tileset)
    this.ground.setDepth(0)

    this.buildings = this.map.createLayer('buildings', tileset)
    this.buildings.setDepth(1)
    this.buildings.setCollisionByExclusion([-1], true)

    this.physics.world.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels)

makeCharacterTexture(this, 'player')
    this.player = this.physics.add.sprite(0, 0, 'player')
    this.player.setDepth(2)
    this.player.body.setSize(12, 15, 1, 3)
    this.player.body.setOffset(1, 3)
    this.player.setCollideWorldBounds(true)
    this.player.setMaxVelocity(SPRINT_SPEED)

    const spawn = this.map.getObjectLayer('spawns').objects[0]
    this.player.setPosition(spawn.x, spawn.y)
    this.physics.add.collider(this.player, this.buildings)

    const carTextureKeys = makeCarTextures(this)
    this.policeKey = makePoliceTexture(this)
    this.cars = this.map
      .getObjectLayer('cars')
      .objects.map((obj, i) => new Car(this, obj.x, obj.y, obj.rotation, carTextureKeys[i % carTextureKeys.length]))
    this.carSprites = this.cars.map((c) => c.sprite)

    this.physics.add.collider(this.carSprites, this.buildings)
    this.physics.add.collider(this.player, this.carSprites)
    this.physics.add.collider(this.carSprites, this.carSprites, (a, b) => this.carCrash(a, b), undefined, this)

    this.cacheTileColl()
    this.setupPedestrians()

    this.physics.add.overlap(this.player, this.pedGroup, (pl, sp) => this.hitPedestrian(this.player, sp), undefined, this)
    this.physics.add.collider(this.carSprites, this.pedGroup, (c, sp) => this.hitPedestrian(c, sp), undefined, this)

    this.keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      UP: Phaser.Input.Keyboard.KeyCodes.UP,
      DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
      LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
      RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      E: Phaser.Input.Keyboard.KeyCodes.E,
      R: Phaser.Input.Keyboard.KeyCodes.R,
      T: Phaser.Input.Keyboard.KeyCodes.T
    })

    this.enterPrompt = this.add
      .text(0, 0, '[ E ]  ENTER VEHICLE', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffe08c',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 7, y: 4 }
      })
      .setDepth(90)
      .setVisible(false)

    this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels)
    this.cameras.main.setZoom(2)
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08)

    makeMissionTexture(this)
    this.missionMarker = this.add.sprite(0, 0, 'mission-marker').setDepth(20).setVisible(false)

    this.input.on('wheel', (_, __, ___gz) => {
      this.baseZoom = Phaser.Math.Clamp(this.baseZoom - ___gz * 0.002, CORNER_ZOOM_MIN, CORNER_ZOOM_MAX)
    })
    this.input.keyboard.once('keydown', () => unlockAudio())

    this.minimapSize = 128
    this.minimap = this.add.image(
      this.cameras.main.width - this.minimapSize - 14,
      this.cameras.main.height - this.minimapSize - 14,
      this.createMinimapTexture()
    )
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(145)
    this.minimapLabel = this.add
      .text(this.minimap.x, this.minimap.y - 14, 'MINIMAP', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#9aa2ab'
      })
      .setScrollFactor(0)
      .setDepth(146)
    this.minimapDots = this.add.graphics().setScrollFactor(0).setDepth(147)

    this.nightOverlay = this.add
      .rectangle(0, 0, this.cameras.main.width, this.cameras.main.height, 0x22309e, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(90)

    this.money = 300
    this.health = 100
    this.hudText = this.add
      .text(14, 12, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.45)',
        padding: { x: 10, y: 8 }
      })
      .setScrollFactor(0)
      .setDepth(100)

    this.starsText = this.add
      .text(this.cameras.main.width - 14, 12, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffe24a'
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(101)

    this.message = this.add
      .text(this.cameras.main.width / 2, 110, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 16, y: 8 }
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(102)
      .setAlpha(0)

    this.hint = this.add
      .text(0, 0, 'WASD / Arrows move  ·  E enter vehicles  ·  SHIFT sprint  ·  Scroll zoom  ·  T day/night', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#d2f0d2'
      })
      .setScrollFactor(0)
      .setDepth(100)
    this.hint.setPosition(
      this.cameras.main.width / 2 - this.hint.width / 2,
      this.cameras.main.height - this.hint.height - 14
    )

    this.bustedOverlay = this.add
      .rectangle(0, 0, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.62)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(150)
      .setVisible(false)
    this.bustedText = this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2 - 40, 'BUSTED', {
        fontFamily: 'monospace',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#ff5a4a'
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(151)
      .setVisible(false)
    this.bustedSub = this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2 + 18, 'PRESS  [ R ]  TO RESTART', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 12, y: 6 }
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(151)
      .setVisible(false)

    const onResize = () => {
      this.hint.setPosition(this.cameras.main.width / 2 - this.hint.width / 2,
        this.cameras.main.height - this.hint.height - 14)
      this.starsText.setPosition(this.cameras.main.width - 14, 12)
      this.bustedOverlay.setSize(this.cameras.main.width, this.cameras.main.height)
      this.bustedText.setPosition(this.cameras.main.width / 2, this.cameras.main.height / 2 - 40)
      this.bustedSub.setPosition(this.cameras.main.width / 2, this.cameras.main.height / 2 + 18)
      this.nightOverlay.setSize(this.cameras.main.width, this.cameras.main.height)
      this.minimap.setPosition(this.cameras.main.width - this.minimapSize - 14,
        this.cameras.main.height - this.minimapSize - 14)
      this.minimapLabel.setPosition(this.minimap.x, this.minimap.y - 14)
    }
    this.game.events.on('resize', onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('resize', onResize)
    })

    this.updateStars()
    this.syncCams()
  }

  syncCams() {
    if (!this.hudCam) {
      this.hudCam = this.cameras.add(this.cameras.main.x, this.cameras.main.y, this.cameras.main.width, this.cameras.main.height, false, 'hudCam')
    }
    const world = [
      this.ground,
      this.buildings,
      this.player,
      this.missionMarker,
      this.pedGroup ? this.pedGroup.getChildren() : [],
      this.carSprites,
      ...this.cops.flatMap((c) => [c.sprite, c.car.sprite])
    ]
    const hud = [
      this.enterPrompt,
      this.minimap,
      this.minimapLabel,
      this.minimapDots,
      this.nightOverlay,
      this.hudText,
      this.starsText,
      this.message,
      this.hint,
      this.bustedOverlay,
      this.bustedText,
      this.bustedSub
    ]
    this.hudCam.ignore(...world.flat())
    this.cameras.main.ignore(...hud)
  }

  cacheTileColl() {
    const tileSize = this.map.tileWidth
    this.walkableTiles = []
    this.roadTiles = []
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const gt = this.ground.getTileAt(x, y)
        if (!gt || gt.index < 1) continue
        const cx = x * tileSize + tileSize / 2
        const cy = y * tileSize + tileSize / 2
        if (gt.index === 3) this.roadTiles.push({ x: cx, y: cy })
        if (gt.index !== 9) {
          const bt = this.buildings.getTileAt(x, y)
          if (!bt || bt.index < 1) this.walkableTiles.push({ x: cx, y: cy })
        }
      }
    }
  }

  setupPedestrians() {
    PED_SHIRTS.forEach((color, i) => makeCharacterTexture(this, 'ped' + i, color))
    this.pedGroup = this.physics.add.group()
    this.peds = []
    for (let i = 0; i < PEDESTRIAN_COUNT; i++) respawnPedestrian(this)
  }

  showMessage(text, duration = 2600) {
    this.message.setText(text).setAlpha(1)
    this.tweens.killTweensOf(this.message)
    this.tweens.add({
      targets: this.message,
      alpha: 0,
      duration,
      delay: 300
    })
  }

  updateStars() {
    this.starsText.setText('★'.repeat(this.wantedLevel) + '☆'.repeat(5 - this.wantedLevel))
  }

  createMinimapTexture() {
    if (this.textures.exists('minimap-bg')) return 'minimap-bg'
    const s = this.minimapSize
    const t = this.textures.createCanvas('minimap-bg', s, s)
    const c = t.getContext()
    c.fillStyle = '#262a31'
    c.fillRect(0, 0, s, s)
    const step = Math.max(1, Math.round((this.map.tileWidth * s) / this.map.widthInPixels))
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const g = this.ground.getTileAt(x, y)
        const b = this.buildings.getTileAt(x, y)
        let col = '#31363e'
        if (b && b.index >= 1) col = '#7d828b'
        else if (g && g.index === 3) col = '#4e535c'
        else if (g && (g.index === 4 || g.index === 10 || g.index === 11)) col = '#434850'
        else if (g && g.index === 2) col = '#3a3f47'
        c.fillStyle = col
        c.fillRect(x * step, y * step, step, step)
      }
    }
    t.refresh()
    return 'minimap-bg'
  }

  updateMinimap() {
    const ref = this.playerRef()
    if (!ref) return
    this.minimapDots.clear()
    const k = this.minimapSize / this.map.widthInPixels
    const ox = this.minimap.x
    const oy = this.minimap.y

    for (const cop of this.cops) {
      const d = Phaser.Math.Distance.Between(ref.x, ref.y, cop.sprite.x, cop.sprite.y)
      if (d > 800) continue
      this.minimapDots.fillStyle(0xff3b30, 0.95)
      this.minimapDots.fillRect(ox + cop.sprite.x * k - 2, oy + cop.sprite.y * k - 2, 4, 4)
    }

    if (this.missionActive && this.missionTarget) {
      const pulse = 3.5 + Math.sin(this.time.now / 220) * 1
      this.minimapDots.fillStyle(0xffe24a, 1)
      this.minimapDots.fillCircle(ox + this.missionTarget.x * k, oy + this.missionTarget.y * k, pulse)
    }

    this.minimapDots.fillStyle(0x5eff5e, 1)
    this.minimapDots.fillCircle(ox + ref.x * k, oy + ref.y * k, 3)

    this.minimapDots.lineStyle(1, 0x000000, 0.85)
    this.minimapDots.strokeRect(ox, oy, this.minimapSize, this.minimapSize)
  }

  toggleNight() {
    this.isNight = !this.isNight
    this.tweens.killTweensOf(this.nightOverlay)
    this.tweens.add({ targets: this.nightOverlay, alpha: this.isNight ? 0.45 : 0, duration: 500 })
  }

  canOffense() {
    const now = this.time.now
    if (now - this._lastOffenseAt < 380) return false
    this._lastOffenseAt = now
    return true
  }

  offense() {
    this.wantedLevel = Math.min(5, this.wantedLevel + 1)
    this.wantedTimer = 9000
    this.syncCops()
    this.updateStars()
    this.cameras.main.shake(120, 0.0025)
    if (this.wantedLevel === 1) this.showMessage('POLICE ARE ON YOUR TAIL')
    else this.showMessage('WANTED LEVEL ' + this.wantedLevel)
  }

  triggerBusted() {
    if (this.busted) return
    this.busted = true
    this.bustedOverlay.setVisible(true)
    this.bustedText.setVisible(true)
    this.bustedSub.setVisible(true)
    setEngine(0)
    playBusted()
    this.cameras.main.shake(240, 0.01)
  }

  hitPedestrian(bodySprite, pedSprite) {
    const ped = this.peds.find((p) => p.sprite === pedSprite)
    if (!ped) return

    let strong = false
    if (bodySprite === this.player) {
      strong = Math.hypot(this.player.body.velocity.x, this.player.body.velocity.y) > 300
    } else if (this.controlled && bodySprite === this.controlled.sprite) {
      strong = Math.abs(this.controlled.speed) > 110
    }
    if (!strong) return
    if (!this.canOffense()) return

    playCrash(0.45)
    this.offense()
    ped.knock()
    const removed = ped
    this.time.delayedCall(2600, () => {
      this.peds = this.peds.filter((p) => p !== removed)
      this.pedGroup.remove(removed.sprite, true, false)
      removed.sprite.destroy()
      respawnPedestrian(this)
    })
  }

  carCrash(a, b) {
    const car = this.controlled && this.controlled.sprite
    if (!car) return
    if (a !== car && b !== car) return
    const other = a === car ? b : a
    const rel = Math.hypot(a.body.velocity.x - b.body.velocity.x, a.body.velocity.y - b.body.velocity.y)
    const contacts = car._contacts || (car._contacts = new Set())
    if (rel > 30 && !contacts.has(other)) {
      contacts.add(other)
      playCrash(Phaser.Math.Clamp(rel / 100, 0.3, 1))
    } else if (rel <= 30) {
      contacts.delete(other)
    }
    if (rel > 80 && this.canOffense()) {
      this.health = Math.max(0, this.health - 12)
      this.updateHud()
      if (this.health <= 0) this.triggerBusted()
      this.offense()
    }
  }

  detectCarImpact() {
    const car = this.controlled
    if (!car) return
    const body = car.sprite.body
    const faces = { up: !!body.blocked.up, down: !!body.blocked.down, left: !!body.blocked.left, right: !!body.blocked.right }
    const prev = car._prevBlocked || (car._prevBlocked = { up: false, down: false, left: false, right: false })
    const sp = Math.abs(car.speed)
    if (sp > 110) {
      for (const f of ['up', 'down', 'left', 'right']) {
        if (faces[f] && !prev[f]) {
          playCrash(Phaser.Math.Clamp(sp / 170, 0.35, 1))
          break
        }
      }
    }
    Object.assign(prev, faces)
  }

  updateWanted(dt) {
    if (this.wantedLevel <= 0) return
    this.wantedTimer -= dt * 1000
    if (this.wantedTimer <= 0) {
      this.wantedLevel--
      this.wantedTimer = 6000
      this.syncCops()
      this.updateStars()
      if (this.wantedLevel === 0) this.showMessage('LOST THE HEAT')
    }
  }

  copsNeeded() {
    return this.wantedLevel === 0 ? 0 : this.wantedLevel >= 3 ? 2 : 1
  }

  syncCops() {
    const need = this.copsNeeded()
    while (this.cops.length > need) {
      const cop = this.cops.pop()
      this.tweens.add({
        targets: cop.sprite,
        alpha: 0,
        duration: 700,
        onComplete: () => cop.destroy()
      })
    }
    while (this.cops.length < need) this.spawnCop()
  }

  spawnCop() {
    const ref = this.controlled ? this.controlled.sprite : this.player
    let spot = null
    for (let i = 0; i < 60 && !spot; i++) {
      const r = this.roadTiles[Phaser.Math.Between(0, this.roadTiles.length - 1)]
      if (Phaser.Math.Distance.Between(ref.x, ref.y, r.x, r.y) > 320) spot = r
    }
    if (!spot) spot = this.roadTiles[Phaser.Math.Between(0, this.roadTiles.length - 1)]

    const cop = new Police(this, spot.x, spot.y, this.policeKey)
    this.cops.push(cop)
    cop.colliders.push(this.physics.add.collider(cop.sprite, this.buildings))
    cop.colliders.push(this.physics.add.collider(cop.sprite, this.carSprites.filter((s) => s !== cop.sprite)))
    this.showMessage('POLICE DISPATCHED')
    this.syncCams()
  }

  nearestCar() {
    let best = null
    let bestDist = ENTER_RADIUS
    for (const car of this.cars) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, car.sprite.x, car.sprite.y)
      if (d < bestDist) {
        bestDist = d
        best = car
      }
    }
    return best
  }

  enterCar(car) {
    this.controlled = car
    car.sprite.body.setImmovable(false)
    car.sprite.body.setVelocity(0, 0)
    car.speed = 0
    this.player.body.enable = false
    this.player.visible = false
    this.enterPrompt.setVisible(false)
    this.cameras.main.startFollow(car.sprite, true, 0.09, 0.09)
  }

  exitCar(car) {
    this.controlled = null
    car.sprite.body.setImmovable(true)
    car.sprite.body.setVelocity(0, 0)
    car.speed = 0

    const fx = Math.sin(car.sprite.rotation)
    const fy = -Math.cos(car.sprite.rotation)
    const doorX = -fy
    const doorY = fx
    const spot = this.nearestWalkable(car.sprite.x + doorX * 15, car.sprite.y + doorY * 15)
    this.player.setPosition(spot.x, spot.y)

    this.player.body.enable = true
    this.player.visible = true
    this.player.body.setVelocity(0, 0)
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08)
  }

  updateEInteraction() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      if (this.controlled) {
        this.exitCar(this.controlled)
      } else {
        const car = this.nearestCar()
        if (car) this.enterCar(car)
      }
    }

    if (!this.controlled) {
      const car = this.nearestCar()
      if (car) {
        this.enterPrompt.setVisible(true)
        this.enterPrompt.setPosition(car.sprite.x, car.sprite.y - 26)
      } else {
        this.enterPrompt.setVisible(false)
      }
    }
  }

  update() {
    const dt = Math.min(this.game.loop.delta, 50) / 1000
    this.updateEInteraction()
    this.updateWanted(dt)
    this.updateCops(dt)
    this.updatePeds(dt)
    this.updateMission(dt)

    if (Phaser.Input.Keyboard.JustDown(this.keys.T)) this.toggleNight()

    if (this.busted) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.scene.restart()
      return
    }

    if (this.controlled) {
      this.detectCarImpact()
      this.controlled.update(this, dt, this.keys)
      this.safetyRescue()
      const ratio = Math.min(1, Math.abs(this.controlled.speed) / this.controlled.maxSpeed)
      setEngine(ratio)
      this.cameras.main.setZoom(Phaser.Math.Clamp(this.baseZoom - ratio * 0.5, 1.25, CORNER_ZOOM_MAX))
      if (ratio > 0.55) this.cameras.main.shake(110, 0.0006 + ratio * 0.001)
      this.updateHud()
      this.updateMinimap()
      return
    }

    setEngine(0)
    this.cameras.main.setZoom(this.baseZoom)
    this.safetyRescue()

    const keys = this.keys
    let dx = 0
    let dy = 0
    dx -= (keys.A.isDown || keys.LEFT.isDown) ? 1 : 0
    dx += (keys.D.isDown || keys.RIGHT.isDown) ? 1 : 0
    dy -= (keys.W.isDown || keys.UP.isDown) ? 1 : 0
    dy += (keys.S.isDown || keys.DOWN.isDown) ? 1 : 0

    const sprinting = keys.SHIFT.isDown
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED
    const len = Math.hypot(dx, dy)
    if (len > 0) {
      dx /= len
      dy /= len
    }

    const body = this.player.body
    body.velocity.x += (dx * speed - body.velocity.x) * this.moveLerp
    body.velocity.y += (dy * speed - body.velocity.y) * this.moveLerp

    if (dx < 0) this.player.setFlipX(true)
    else if (dx > 0) this.player.setFlipX(false)

    this.updateHud()
    this.updateMinimap()
  }

  updatePeds(dt) {
    for (const ped of this.peds) ped.update(this, dt)
  }

  updateCops(dt) {
    if (this.cops.length === 0 || this.busted) return
    const target = this.controlled ? this.controlled.sprite : this.player
    for (const cop of this.cops) {
      cop.ai(this, dt, target)
      if (this.busted) return
      if (this.catchCooldown > 0) {
        this.catchCooldown -= dt
        continue
      }
      if (Phaser.Math.Distance.Between(target.x, target.y, cop.sprite.x, cop.sprite.y) < 62) {
        this.catchCooldown = 0.5
        this.triggerBusted()
      }
    }
  }

  playerRef() {
    return this.controlled ? this.controlled.sprite : this.player
  }

  nearestWalkable(x, y) {
    for (let r = 0; r <= 120; r += 8) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const nx = Phaser.Math.Clamp(x + Math.cos(a) * r, 8, this.map.widthInPixels - 8)
        const ny = Phaser.Math.Clamp(y + Math.sin(a) * r, 8, this.map.heightInPixels - 8)
        if (this.buildings.getTileAtWorldXY(nx, ny)) continue
        const inCar = this.cars.some((c) => Phaser.Math.Distance.Between(c.sprite.x, c.sprite.y, nx, ny) < 16)
        if (inCar) continue
        return { x: nx, y: ny }
      }
    }
    return { x, y }
  }

  safetyRescue() {
    const ref = this.playerRef()
    if (!ref) return
    const now = this.time.now
    if (now - this._lastUnstuck < 400) return
    this._lastUnstuck = now
    let tile = this.buildings.getTileAtWorldXY(ref.x, ref.y)
    if (!tile || tile.index < 1) return
    const spot = this.nearestWalkable(ref.x, ref.y)
    ref.setPosition(spot.x, spot.y)
    ref.body.setVelocity(0, 0)
  }

  pickMissionTarget() {
    const ref = this.playerRef()
    const tw = this.map.tileWidth
    const open = []
    for (const r of this.roadTiles) {
      const gx = Math.floor(r.x / tw)
      const gy = Math.floor(r.y / tw)
      if (this.buildings.getTileAt(gx, gy)) continue
      const n = [
        [gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]
      ]
      const reachable = n.some(([nx, ny]) => {
        const gt = this.ground.getTileAt(nx, ny)
        if (!gt) return false
        if (this.buildings.getTileAt(nx, ny)) return false
        return true
      })
      if (reachable) open.push(r)
    }
    const pool = open.length ? open : this.roadTiles
    for (let i = 0; i < 50; i++) {
      const r = pool[Phaser.Math.Between(0, pool.length - 1)]
      if (Phaser.Math.Distance.Between(ref.x, ref.y, r.x, r.y) > MISSION_MIN_DISTANCE) return r
    }
    return pool[Phaser.Math.Between(0, pool.length - 1)]
  }

  startMission() {
    this.missionActive = true
    this.missionTarget = this.pickMissionTarget()
    this.missionMarker.setPosition(this.missionTarget.x, this.missionTarget.y).setVisible(true)
    this.tweens.add({
      targets: this.missionMarker,
      scaleX: 1.6,
      scaleY: 1.6,
      yoyo: true,
      repeat: -1,
      duration: 900,
      ease: 'Sine.easeInOut'
    })
    this.showMessage('MISSION STARTED — DRIVE TO THE WAYPOINT')
  }

  completeMission() {
    this.missionActive = false
    this.missionMarker.setVisible(false)
    this.tweens.killTweensOf(this.missionMarker)
    this.missionMarker.setScale(1, 1)
    this.money += MISSION_REWARD
    this.missionTimer = MISSION_RESTART_MS
    this.showMessage(`MISSION COMPLETE  +$${MISSION_REWARD}`)
    this.cameras.main.flash(120, 255, 226, 74, false)
  }

  updateMission(dt) {
    if (this.missionActive && this.missionTarget) {
      const ref = this.playerRef()
      const d = Phaser.Math.Distance.Between(ref.x, ref.y, this.missionTarget.x, this.missionTarget.y)
      if (d < MISSION_CLAIM_RADIUS) this.completeMission()
      return
    }
    if (this.missionTimer > 0) {
      this.missionTimer -= dt * 1000
      if (this.missionTimer <= 0) this.startMission()
    }
  }

  updateHud() {
    const lines = ['[ PROJECT VI ]', `CASH  $${this.money.toLocaleString()}`]
    if (this.controlled) {
      lines.push(`VEHICLE  ${this.controlled.speedKmh} km/h`)
    } else {
      lines.push(`POS   ${Math.floor(this.player.x)}, ${Math.floor(this.player.y)}`)
    }
    if (this.missionActive && this.missionTarget) {
      const ref = this.playerRef()
      const d = Phaser.Math.Distance.Between(ref.x, ref.y, this.missionTarget.x, this.missionTarget.y)
      lines.push(`WAYPOINT  ${Math.max(0, Math.round(d / 20))} m`)
    }
    lines.push(`TIME  ${this.isNight ? 'NIGHT' : 'DAY'}  ·  [T]`)
    const blocks = Math.round((this.health / 100) * 12)
    lines.push(`MED  ${'█'.repeat(blocks)}${'░'.repeat(12 - blocks)}  ${this.health}%`)
    if (this.controlled) lines.push('[E] exit  ·  arrows drive')
    this.hudText.setText(lines.join('\n'))
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 640,
  backgroundColor: '#0c0e12',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: [CityScene]
}

const game = new Phaser.Game(config)
window.game = game