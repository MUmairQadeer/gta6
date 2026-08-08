import Phaser from 'phaser'

export const PED_SHIRTS = ['#f58f5f', '#5fa7e0', '#f0c24a', '#b08be0', '#57b8a8', '#e0789f']

export class Pedestrian {
  constructor(scene, textureKey) {
    this.sprite = scene.physics.add.sprite(0, 0, textureKey)
    this.sprite.setDepth(3)
    this.sprite.body.setSize(9, 13, 2, 4)
    scene.pedGroup.add(this.sprite)

    this.speed = Phaser.Math.Between(42, 68)
    this.target = null
    this.timer = Phaser.Math.Between(0.3, 1.2)
    this.idle = false
  }

  randomSpot(scene) {
    const p = this.sprite
    for (let i = 0; i < 24; i++) {
      const spot = scene.walkableTiles[Phaser.Math.Between(0, scene.walkableTiles.length - 1)]
      const d = Phaser.Math.Distance.Between(p.x, p.y, spot.x, spot.y)
      if (d > 240) return spot
    }
    return scene.walkableTiles[Phaser.Math.Between(0, scene.walkableTiles.length - 1)]
  }

  pickTarget(scene) {
    this.target = this.randomSpot(scene)
  }

  update(scene, dt) {
    const s = this.sprite
    if (!s.active || !s.body.enable) return

    this.timer -= dt
    if (this.timer <= 0) {
      if (this.idle > 0) {
        this.timer = Phaser.Math.Between(0.2, 1.4)
        this.idle = 0
        this.pickTarget(scene)
      } else {
        this.idle = Phaser.Math.Between(1, 3)
        this.timer = Phaser.Math.Between(0.6, 2.2)
      }
      s.setVelocity(0, 0)
      return
    }

    if (this.idle > 0) {
      s.setVelocity(0, 0)
      return
    }

    if (!this.target) this.pickTarget(scene)

    const dx = this.target.x - s.x
    const dy = this.target.y - s.y
    const d = Math.hypot(dx, dy)

    if (d < 6) {
      this.timer = Phaser.Math.Between(0.3, 1.2)
      this.idle = Phaser.Math.Between(1, 3)
      this.target = null
      s.setVelocity(0, 0)
      return
    }

    const ux = dx / d
    const uy = dy / d
    const frontX = s.x + ux * 12
    const frontY = s.y + uy * 12
    if (scene.buildings.hasTileAtWorldXY(frontX, frontY)) {
      this.pickTarget(scene)
      s.setVelocity(0, 0)
      return
    }

    s.setVelocity(ux * this.speed, uy * this.speed)
    s.setFlipX(ux < 0)
  }

  knock() {
    this.sprite.body.enable = false
    this.sprite.setVelocity(0, 0)
    this.sprite.setFlipY(true)
    this.sprite.setAlpha(0.6)
    this.sprite.setDepth(2.5)
  }
}

export function respawnPedestrian(scene) {
  const key = 'ped' + Phaser.Math.Between(0, PED_SHIRTS.length - 1)
  const ped = new Pedestrian(scene, key)
  const spot = ped.randomSpot(scene)
  ped.sprite.setPosition(spot.x, spot.y)
  scene.peds.push(ped)
  return ped
}