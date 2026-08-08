import Phaser from 'phaser'

export const CAR_W = 20
export const CAR_H = 34

const PHYS = {
  MAX_SPEED: 260,
  ACC_REVERSE: 95,
  OFFROAD_MAX_FACTOR: 0.72,
  ACCEL: 380,
  ACCEL_CURVE: 1.25,
  BRAKE: 500,
  REVERSE_ACCEL: 140,
  DRAG_ROAD: 0.5,
  DRAG_OFFROAD: 2.4,
  STEER: 2.2,
  STEER_RESPONSE: 4.2,
  MIN_STEER_SPEED: 8
}

const PALETTES = [
  { body: '#d33a3a', dark: '#8a2323', roof: '#b02e2e', light: '#f7d94b' },
  { body: '#2f6fe0', dark: '#1d4b9e', roof: '#285cbd', light: '#bfe0ff' },
  { body: '#3a3a3a', dark: '#161616', roof: '#2b2b2b', light: '#9aa2ab' },
  { body: '#e8b84b', dark: '#a77c26', roof: '#c79c3a', light: '#fff1c0' },
  { body: '#7bcb47', dark: '#4b8a26', roof: '#62ae35', light: '#d6f2bf' },
  { body: '#c65bc8', dark: '#7e2f80', roof: '#a94bab', light: '#f0d6f1' },
  { body: '#e8de8f', dark: '#8a8344', roof: '#c9bf74', light: '#fff9d0' },
  { body: '#4ab5a0', dark: '#2b7c6c', roof: '#3aa38f', light: '#c2f0e6' },
  { body: '#e07b2c', dark: '#9c5315', roof: '#c26821', light: '#ffd9a8' }
]

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawCarTexture(scene, key, p, policeLayout) {
  if (scene.textures.exists(key)) return key
  const t = scene.textures.createCanvas(key, CAR_W, CAR_H)
  const c = t.getContext()

  // soft ground shadow
  c.fillStyle = 'rgba(0,0,0,0.4)'
  c.beginPath()
  c.ellipse(CAR_W / 2, CAR_H - 2, 9, 3.5, 0, 0, Math.PI * 2)
  c.fill()

  // four wheels peeking out (front pair near top, rear pair near bottom)
  c.fillStyle = '#101016'
  c.fillRect(0, 6, 3, 8)
  c.fillRect(CAR_W - 3, 6, 3, 8)
  c.fillRect(0, 23, 3, 8)
  c.fillRect(CAR_W - 3, 23, 3, 8)

  // main body panel
  c.fillStyle = p.body
  roundRectPath(c, 3, 4, CAR_W - 6, CAR_H - 8, 4)
  c.fill()
  c.strokeStyle = p.dark
  c.lineWidth = 1
  c.stroke()

  // ---------- FRONT (the nose of the car, at the top) ----------
  // dark grille strip
  c.fillStyle = '#191d24'
  c.fillRect(4, 4, CAR_W - 8, 2)
  // bright headlight lenses at the nose corners — unmistakable front
  c.fillStyle = '#fff9d0'
  c.fillRect(4, 6, 5, 3)
  c.fillRect(CAR_W - 9, 6, 5, 3)
  c.fillStyle = '#ffffff'
  c.fillRect(4, 6, 2, 3)
  c.fillRect(CAR_W - 6, 6, 2, 3)

  // hood with sheen + creases converging at the nose
  c.globalAlpha = 0.38
  c.fillStyle = p.light
  c.fillRect(4, 9, CAR_W - 8, 4)
  c.globalAlpha = 1
  c.fillStyle = 'rgba(0,0,0,0.3)'
  c.fillRect(7, 8, 1, 5)
  c.fillRect(CAR_W - 8, 8, 1, 5)

  // windshield (front) — slanted trapezoid
  c.fillStyle = p.glass || '#27324d'
  c.beginPath()
  c.moveTo(5, 10)
  c.lineTo(CAR_W - 5, 10)
  c.lineTo(CAR_W - 7, 15)
  c.lineTo(7, 15)
  c.closePath()
  c.fill()
  c.fillStyle = 'rgba(180,210,255,0.4)'
  c.fillRect(7, 11, 2, 3)

  // roof + forward chevron arrows (front is up)
  c.fillStyle = p.roof
  roundRectPath(c, 6, 15, CAR_W - 12, 7, 2)
  c.fill()
  const arrowC = p.dark === '#161616' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.75)'
  c.fillStyle = arrowC
  c.beginPath()
  c.moveTo(7, 17)
  c.lineTo(10, 17)
  c.lineTo(8.5, 15)
  c.closePath()
  c.fill()
  c.beginPath()
  c.moveTo(13, 17)
  c.lineTo(10, 17)
  c.lineTo(11.5, 15)
  c.closePath()
  c.fill()

  // rear glass (trapezoid, smaller than windshield)
  c.fillStyle = p.glass || '#1d273e'
  c.beginPath()
  c.moveTo(7, 22)
  c.lineTo(CAR_W - 7, 22)
  c.lineTo(CAR_W - 5, 26)
  c.lineTo(5, 26)
  c.closePath()
  c.fill()

  // trunk deck (darker folded panel + lip line)
  c.fillStyle = 'rgba(0,0,0,0.28)'
  c.fillRect(5, 26.5, CAR_W - 10, 3)
  c.fillStyle = p.dark
  c.fillRect(5, 29.5, CAR_W - 10, 0.5)

  // door seams through the cabin
  c.fillStyle = 'rgba(0,0,0,0.25)'
  c.fillRect(8, 15, 1, 13)
  c.fillRect(CAR_W - 9, 15, 1, 13)

  // ---------- REAR (the tail, at the bottom): corner taillights ----------
  c.fillStyle = '#2b0d0d'
  c.fillRect(4, 30, 7, 2)
  c.fillRect(CAR_W - 11, 30, 7, 2)
  c.fillStyle = '#ff3b30'
  c.fillRect(4, 30, 6, 2)
  c.fillRect(CAR_W - 10, 30, 6, 2)
  c.fillStyle = '#ffd7d2'
  c.fillRect(5, 30, 2, 1)
  c.fillRect(CAR_W - 7, 30, 2, 1)
  c.fillStyle = '#8f1a17'
  c.fillRect(7.5, 30, CAR_W - 15, 1)
  c.fillStyle = '#3a1210'
  c.fillRect(7.5, 31, CAR_W - 15, 1)

  // black bumper
  c.fillStyle = '#1b1e23'
  c.fillRect(3, 32, CAR_W - 6, 1)

  if (policeLayout) {
    c.fillStyle = '#e8edf3'
    roundRectPath(c, 5, 24, CAR_W - 10, 4, 1)
    c.fill()
    c.fillStyle = '#11141a'
    c.fillRect(8, 13, 2, 4)
    c.fillStyle = '#ff3b30'
    c.fillRect(7, 14, 3, 2)
    c.fillStyle = '#2c6cff'
    c.fillRect(10, 14, 3, 2)
  }

  t.refresh()
  return key
}

export function makeCarTextures(scene) {
  return PALETTES.map((p, i) => drawCarTexture(scene, 'car' + i, p))
}

export function makePoliceTexture(scene) {
  return drawCarTexture(scene, 'police', {
    body: '#f2f5f8',
    dark: '#6f7a86',
    roof: '#dbe4e7',
    light: '#cfe6ff'
  }, true)
}

export class Car {
  constructor(scene, x, y, rotation, textureKey) {
    this.sprite = scene.physics.add.sprite(x, y, textureKey)
    this.sprite.setDepth(3)
    this.sprite.rotation = rotation
    this.sprite.setCollideWorldBounds(true)
    const body = this.sprite.body
    body.setSize(14, 27, 3, 4)
    body.setImmovable(true)
    this.speed = 0
    this.onRoad = true
    this.maxSpeed = PHYS.MAX_SPEED
    this._steer = 0
  }

  updateSurface(scene) {
    const tile = scene.ground.getTileAtWorldXY(this.sprite.x, this.sprite.y)
    this.onRoad = tile ? tile.index === 3 || tile.index === 4 || tile.index === 10 || tile.index === 11 : false
  }

  update(scene, dt, input) {
    this.updateSurface(scene)

    const up = input.UP.isDown
    const down = input.DOWN.isDown
    const steerIn = (input.RIGHT.isDown ? 1 : 0) - (input.LEFT.isDown ? 1 : 0)

    const maxSpeed = this.maxSpeed * (this.onRoad ? 1 : PHYS.OFFROAD_MAX_FACTOR)

    // ---- longitudinal: power tapers near top speed, brakes bite, coast holds momentum ----
    let v = this.speed
    if (up && !down) {
      if (v < -0.5) {
        v = Math.min(0, v + PHYS.BRAKE * dt)
      } else {
        v = Math.min(maxSpeed, v + PHYS.ACCEL * Math.pow(Math.max(0, 1 - v / maxSpeed), PHYS.ACCEL_CURVE) * dt)
      }
    } else if (down && !up) {
      if (v > 0.5) {
        v = Math.max(0, v - PHYS.BRAKE * dt)
      } else {
        v = Math.max(-PHYS.ACC_REVERSE, v - PHYS.REVERSE_ACCEL * Math.pow(Math.max(0, 1 + v / PHYS.ACC_REVERSE), PHYS.ACCEL_CURVE) * dt)
      }
    } else if (up && down) {
      v = Math.max(0, v - PHYS.BRAKE * dt)
    } else {
      const drag = this.onRoad ? PHYS.DRAG_ROAD : PHYS.DRAG_OFFROAD
      v *= Math.exp(-drag * dt)
      if (Math.abs(v) < 1.5) v = 0
    }

    v = Phaser.Math.Clamp(v, -PHYS.ACC_REVERSE, maxSpeed)
    this.speed = v

    // ---- steering: smoothed input, speed-shaped authority ----
    this._steer += (steerIn - this._steer) * Math.min(1, PHYS.STEER_RESPONSE * dt)
    const sp = Math.abs(v)
    const frac = Math.min(1, sp / maxSpeed)
    if (sp > PHYS.MIN_STEER_SPEED) {
      const turn = frac * (1 - 0.32 * frac) * PHYS.STEER
      this.sprite.rotation += this._steer * turn * dt * (v > 0 ? 1 : -1)
    }

    const fx = Math.sin(this.sprite.rotation)
    const fy = -Math.cos(this.sprite.rotation)
    this.sprite.body.setVelocity(fx * v, fy * v)
  }

  get speedKmh() {
    return Math.round(Math.abs(this.speed) * 0.35)
  }
}
