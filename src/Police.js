import Phaser from 'phaser'
import { Car } from './Car.js'

export class Police {
  constructor(scene, x, y, textureKey) {
    this.car = new Car(scene, x, y, 0, textureKey)
    this.car.sprite.setDepth(4)
    this.car.maxSpeed = 310
    this.light = scene.add.circle(x, y, 3.5, 0xff3b30).setDepth(4.5)
    this.lightTimer = 0
    this.colliders = []
    this.stallPos = null
    this.stallAt = 0
    this.avoidUntil = 0
    this.avoidDir = 1
  }

  get sprite() {
    return this.car.sprite
  }

  ai(scene, dt, target) {
    const s = this.sprite
    const now = scene.time.now
    const fx = Math.sin(s.rotation)
    const fy = -Math.cos(s.rotation)

    if (!this.stallPos) {
      this.stallPos = { x: s.x, y: s.y }
      this.stallAt = now
    }
    if (Math.hypot(s.x - this.stallPos.x, s.y - this.stallPos.y) > 18) {
      this.stallPos = { x: s.x, y: s.y }
      this.stallAt = now
    }

    const ahead = 30
    const side = 13
    const probe = (ox, oy) => !!scene.buildings.getTileAtWorldXY(ox, oy)
    const hx = s.x + fx * ahead
    const hy = s.y + fy * ahead
    const lx = s.x + fx * ahead - fy * side
    const ly = s.y + fy * ahead + fx * side
    const rx = s.x + fx * ahead + fy * side
    const ry = s.y + fy * ahead - fx * side
    const bAhead = probe(hx, hy) || (probe(lx, ly) && probe(rx, ry))
    const lOpen = !probe(lx, ly)
    const rOpen = !probe(rx, ry)

    const stuck = now - this.stallAt > 900
    if (stuck && now > this.avoidUntil) {
      this.avoidDir = lOpen ? 1 : rOpen ? -1 : Math.random() < 0.5 ? 1 : -1
      this.avoidUntil = now + 700
    }

    const dx = target.x - s.x
    const dy = target.y - s.y
    const dist = Math.hypot(dx, dy)
    const desired = Math.atan2(dx, -dy)
    const diff = Phaser.Math.Angle.Wrap(desired - s.rotation)
    let steer = Phaser.Math.Clamp(diff * 2.4, -1, 1)

    let up = Math.abs(diff) < 1.4
    let down = Math.abs(diff) > 2.4 && this.car.speed > 40
    if (dist < 55) up = false

    if (now < this.avoidUntil) {
      up = false
      down = true
      steer = this.avoidDir
    } else if (bAhead) {
      up = false
      down = this.car.speed > 8
      steer = lOpen ? 1 : rOpen ? -1 : this.avoidDir
    }

    this.car.update(scene, dt, {
      UP: { isDown: up },
      DOWN: { isDown: down },
      LEFT: { isDown: steer < 0 },
      RIGHT: { isDown: steer > 0 }
    })

    this.lightTimer += dt
    if (this.lightTimer > 0.32) {
      this.lightTimer = 0
      this.light.setFillStyle(this.light.fillColor === 0xff3b30 ? 0x2c6cff : 0xff3b30)
    }
    this.light.setPosition(s.x + fx * 16, s.y + fy * 16)
  }

  destroy() {
    this.light.destroy()
    for (const c of this.colliders) c.destroy()
    this.sprite.destroy()
  }
}