import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { unlockAudio, setEngine, playCrash, playBusted } from './audio.js'

const TILE = 16
const WALK = 280
const SPRINT = 460
const MAX_SPEED = 280
const DRIVE = {
  REVERSE_MAX: 95,
  OFFROAD_FACTOR: 0.72,
  ACCEL: 430,
  ACCEL_CURVE: 1.25,
  BRAKE: 590,
  REVERSE_ACCEL: 150,
  COAST_ROAD: 0.45,
  COAST_OFFROAD: 2.6,
  STEER: 2.4,
  STEER_RESPONSE: 4.0,
  MIN_STEER_SPEED: 8
}
const ENTER_RADIUS = 48
const CATCH_RADIUS = 66
const PED_COUNT = 46
const PED_SHIRTS = ['#3fae6a', '#d33a3a', '#2f6fe0', '#e8b84b', '#c65bc8', '#ffffff', '#7bcb47', '#e07b2c', '#4ab5a0', '#e8de8f']
const CAR_PALETTES = [0xd33a3a, 0x2f6fe0, 0x3a3a3a, 0xe8b84b, 0x7bcb47, 0xc65bc8, 0xe8de8f, 0x4ab5a0, 0xe07b2c]
const MISSION_REWARD = 250
const MISSION_CLAIM = 80
const MISSION_MIN = 420
const MISSION_RESTART = 5000
const MISSION_TIMER = 1200

let scene, camera, renderer, hemi, dirLight
const clock = new THREE.Clock()

const keys = new Set()
let lastOffenseAt = 0
let crashCooldown = 0

let groundGids = null
let bldGids = null
let solidTiles = null
let roadTiles = []
let parkedData = []
let mapW = 0
let mapH = 0

const player = { x: 0, y: 0, r: 0, mesh: null, moving: false }
const car = { inCar: false, speed: 0, r: 0, x: 0, y: 0, mesh: null, cur: null, _steer: 0 }
const peds = []
const cops = []

const state = {
  money: 300,
  wanted: 0,
  wantedTimer: 0,
  health: 100,
  missionActive: false,
  missionTarget: null,
  missionTimer: MISSION_TIMER,
  isNight: false,
  busted: false,
  cameraDist: 170
}

let minimapCtx = null
let minimapBg = null
let hudTimer = 0
let miniTimer = 0
let camTarget = new THREE.Vector3()
let markerObj = null

function rand(min, max) { return min + Math.random() * (max - min) }
function dist2(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2) }
function el(id) { return document.getElementById(id) }
function hue(x, y, a) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return Math.abs((s - Math.floor(s)) + a) % 1
}

// ---------------------------------------------------------------------------
// HUD (DOM overlay — never affected by camera zoom)
// ---------------------------------------------------------------------------
function initHud() {
  const hud = document.createElement('div')
  hud.id = 'hud'
  hud.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:none;user-select:none;'
  hud.innerHTML = `
    <style>
      #hud { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
      #hud-top {
        position:absolute;top:12px;left:12px;min-width:236px;
        background:linear-gradient(180deg, rgba(18,24,33,.78), rgba(10,13,20,.66));
        backdrop-filter:blur(10px) saturate(1.25); -webkit-backdrop-filter:blur(10px) saturate(1.25);
        border:1px solid rgba(255,255,255,.09); border-radius:14px;
        box-shadow:0 10px 28px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.07);
        padding:12px 15px 13px;
      }
      #hud-title {
        font-size:11px; font-weight:700; letter-spacing:2.6px; text-transform:uppercase;
        color:#9fe8ff; text-shadow:0 1px 3px rgba(0,0,0,.9);
        padding-bottom:9px; margin-bottom:9px;
        border-bottom:1px solid rgba(255,255,255,.09);
      }
      .hud-row {
        display:flex; align-items:center; gap:9px; padding:3px 0;
        text-shadow:0 1px 2px rgba(0,0,0,.85);
      }
      .hud-row + .hud-row { margin-top:5px; }
      .hud-ic { width:15px; height:15px; flex:0 0 15px; opacity:.85; }
      .hud-ic path { fill:none; stroke:#b8c6d4; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
      .hud-l {
        font-size:10px; font-weight:600; letter-spacing:1.4px; text-transform:uppercase;
        color:#8fa0b1; width:44px; flex:0 0 44px;
      }
      .hud-val { font-size:14px; font-weight:600; color:#f4f8fc; letter-spacing:.3px; }
      .hud-val.money { color:#ffd76a; }
      .hud-val.pos { color:#c9d6e4; font-size:13px; font-variant-numeric:tabular-nums; }
      .medwrap { display:flex; align-items:center; gap:8px; flex:1; }
      .medbar {
        flex:1; max-width:118px; height:8px; border-radius:99px;
        background:rgba(255,255,255,.13); box-shadow:inset 0 1px 2px rgba(0,0,0,.5);
        overflow:hidden;
      }
      #med-bar {
        height:100%; width:100%; border-radius:99px;
        background:linear-gradient(90deg, #16b06a, #53e88f, #8dffad);
        box-shadow:0 0 9px rgba(83,232,143,.85), inset 0 1px 0 rgba(255,255,255,.35);
        transition:width .6s cubic-bezier(.2,.8,.3,1);
      }
      #med-pct { font-size:12.5px; font-weight:700; color:#8dffad; font-variant-numeric:tabular-nums; }
    </style>
    <div id="hud-top">
      <div id="hud-title">Project&nbsp;VI</div>
      <div class="hud-row">
        <svg class="hud-ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 6.8v10.4M14.6 8.6h-4a2.4 2.4 0 0 0 0 4.8h2.8a2.4 2.4 0 0 1 0 4.8H9.4"/></svg>
        <span class="hud-l">CASH</span><span id="hud-cash" class="hud-val money">$300</span>
      </div>
      <div class="hud-row">
        <svg class="hud-ic" viewBox="0 0 24 24"><path d="M12 20.5S4.6 15.7 3.2 11.4C2.4 8.7 4.2 5.6 7 5.6c2 0 3.6 1.2 5 3.4 1.4-2.2 3-3.4 5-3.4 2.8 0 4.6 3.1 3.8 5.8C19.4 15.7 12 20.5 12 20.5z"/></svg>
        <span class="hud-l">Med</span>
        <div class="medwrap"><div class="medbar" id="med-bar-wrap"><div id="med-bar"></div></div><span id="med-pct" style="color:#8dffad">100%</span></div>
      </div>
      <div class="hud-row">
        <svg class="hud-ic" viewBox="0 0 24 24"><path d="M12 21.5S5.5 15.6 5.5 9.7a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21.5 12 21.5z"/><circle cx="12" cy="9.6" r="2.5"/></svg>
        <span class="hud-l">Pos</span><span id="hud-pos" class="hud-val pos">--, --</span>
      </div>
      <div class="hud-row" id="hud-veh-row" style="display:none">
        <svg class="hud-ic" viewBox="0 0 24 24"><path d="M4.2 15.5 5.6 11a2.6 2.6 0 0 1 2.5-1.8h7.8a2.6 2.6 0 0 1 2.5 1.8l1.4 4.5"/><circle cx="7.3" cy="16.8" r="1.9"/><circle cx="16.7" cy="16.8" r="1.9"/></svg>
        <span class="hud-l">Vehicles</span><span id="hud-veh" class="hud-val">0 km/h</span>
      </div>
      <div class="hud-row">
        <svg class="hud-ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 1.9"/></svg>
        <span class="hud-l">Time</span><span id="hud-way" class="hud-val">DAY · [T]</span>
      </div>
    </div>
    <div id="hud-stars" style="position:absolute;top:12px;right:14px;font-size:24px;color:#ffe24a;letter-spacing:3px;text-shadow:0 2px 4px #000"></div>
    <div id="hud-msg" style="position:absolute;top:112px;left:50%;transform:translateX(-50%);font-size:19px;font-weight:bold;color:#fff;background:rgba(0,0,0,.55);padding:8px 16px;border-radius:6px;opacity:0;transition:opacity .2s"></div>
    <div id="hud-prompt" style="position:absolute;bottom:30%;left:50%;transform:translateX(-50%);font-size:13px;color:#ffe08c;background:rgba(0,0,0,.55);padding:6px 12px;border-radius:6px;display:none"></div>
    <div id="hud-mini-wrap" style="position:absolute;bottom:12px;right:12px;background:rgba(10,13,19,.62);border:1px solid rgba(255,255,255,.1);border-radius:12px;box-shadow:0 10px 26px rgba(0,0,0,.45);padding:7px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)">
      <canvas id="hud-mini" width="144" height="144" style="display:block;border-radius:7px"></canvas>
      <div style="font-size:9px;color:#aeb9c4;text-align:center;letter-spacing:2.5px;margin-top:5px">MINIMAP</div>
    </div>
    <div id="hud-hint" style="position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:12px;color:#d2f0d2;background:rgba(0,0,0,.35);padding:4px 10px;border-radius:6px;white-space:nowrap">WASD walk · E enter/exit · arrows drive · SHIFT sprint · scroll zoom · T night</div>
    <div id="hud-night" style="position:absolute;inset:0;background:rgba(18,26,90,.42);opacity:0;transition:opacity .5s"></div>
    <div id="hud-busted" style="position:absolute;inset:0;background:rgba(0,0,0,.62);display:none;pointer-events:auto;align-items:center;justify-content:center;flex-direction:column">
      <div style="font-size:44px;font-weight:bold;color:#ff5a4a">BUSTED</div>
      <div style="font-size:16px;color:#fff;margin-top:14px;background:rgba(0,0,0,.55);padding:7px 14px;border-radius:6px">PRESS [ R ] TO RESTART</div>
    </div>
  `
  document.body.appendChild(hud)
  minimapCtx = el('hud-mini').getContext('2d')
}

function showMsg(text, dur = 2600) {
  const m = el('hud-msg')
  m.textContent = text
  m.style.opacity = 1
  clearTimeout(m._t)
  m._t = setTimeout(() => (m.style.opacity = 0), Math.max(300, dur))
}

function updateStars() {
  el('hud-stars').textContent = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted)
}

function updateHud() {
  el('hud-cash').textContent = `$${state.money.toLocaleString()}`
  const hp = Math.max(0, Math.min(100, Math.round(state.health)))
  el('med-bar').style.width = `${hp}%`
  el('med-pct').textContent = `${hp}%`
  const ref = car.inCar ? car : player
  el('hud-pos').textContent = `${Math.floor(ref.x)}, ${Math.floor(ref.y)}`
  if (car.inCar) {
    el('hud-veh-row').style.display = 'flex'
    el('hud-veh').textContent = `${Math.round(Math.abs(car.speed) * 0.72)} km/h`
  } else {
    el('hud-veh-row').style.display = 'none'
  }
  if (state.missionActive && state.missionTarget) {
    el('hud-way').textContent = `WAYPOINT ${Math.max(0, Math.round(dist2(ref.x, ref.y, state.missionTarget.x, state.missionTarget.y) / 20))} m`
  } else {
    el('hud-way').textContent = `${state.isNight ? 'NIGHT' : 'DAY'} · [T]`
  }
  updateStars()
}

// ---------------------------------------------------------------------------
// 3D models
// ---------------------------------------------------------------------------
const CAR_MATS = {
  tire: new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.9, metalness: 0.05 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.28, metalness: 0.85 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x1c1f25, roughness: 0.62, metalness: 0.2 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd3d9df, roughness: 0.2, metalness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x26354f, roughness: 0.12, metalness: 0.85, transparent: true, opacity: 0.86, depthWrite: false }),
  head: new THREE.MeshLambertMaterial({ color: 0xfff8d9, emissive: 0xffeeb0, emissiveIntensity: 1.15 }),
  tail: new THREE.MeshLambertMaterial({ color: 0xff4a3d, emissive: 0xff241a, emissiveIntensity: 1.15 }),
  plate: new THREE.MeshBasicMaterial({ color: 0xf4f4f0 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  sirenR: new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0xff3030, emissiveIntensity: 1.4 }),
  sirenB: new THREE.MeshLambertMaterial({ color: 0x3661ff, emissive: 0x3661ff, emissiveIntensity: 1.4 })
}

const paintCache = new Map()
function paintMats(hex) {
  let m = paintCache.get(hex)
  if (!m) {
    const dark = new THREE.Color(hex).multiplyScalar(0.58).getHex()
    m = {
      main: new THREE.MeshStandardMaterial({ color: hex, roughness: 0.42, metalness: 0.62 }),
      dark: new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.5 })
    }
    paintCache.set(hex, m)
  }
  return m
}

const geoCache = {}
function boxG(w, h, d) {
  const k = `b${w}_${h}_${d}`
  if (!geoCache[k]) geoCache[k] = new THREE.BoxGeometry(w, h, d)
  return geoCache[k]
}

function makeCarModel(bodyHex, isPolice) {
  const g = new THREE.Group()
  const p = paintMats(bodyHex)
  const M = CAR_MATS
  const parts = []
  const push = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4()
    if (rx || ry || rz) m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz))
    m.setPosition(px, py, pz)
    parts.push({ geo, mat, m })
  }
  const box = (w, h, d, mat, px, py, pz, rx = 0, ry = 0) => push(boxG(w, h, d), mat, px, py, pz, rx, ry)

  // contact shadow on the ground
  const shadowGeo = new THREE.CircleGeometry(15, 20)
  shadowGeo.rotateX(-Math.PI / 2)
  shadowGeo.scale(0.52, 1, 1)
  push(shadowGeo, M.shadow, 0, 0.03, 0)

  // wheels — rubber tire cylinder + metal rim, axle along X
  const tireGeo = new THREE.CylinderGeometry(1.9, 1.9, 2.5, 14)
  const rimGeo = new THREE.CylinderGeometry(1.0, 1.0, 2.6, 8)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z = sz * 10.4
      push(tireGeo, M.tire, sx * 6.5, 1.9, z, 0, 0, Math.PI / 2)
      push(rimGeo, M.rim, sx * 6.5, 1.9, z, 0, 0, Math.PI / 2)
    }
  }

  // wheel arch flares (dark plastic over each wheel)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(5.2, 1.8, 5.4, M.trim, sx * 4.8, 3.3, sz * 10.4)
  }

  // lower rocker panels
  box(12.6, 2.2, 24.4, p.dark, 0, 3.1, 0)
  // main body slab
  box(12.6, 2.2, 25.0, p.main, 0, 5.4, 0)
  // hood — sloped down toward the nose
  box(11.2, 1.3, 6.8, p.main, 0, 7.05, -9.5, 0.12)
  // cowl line at the base of the windshield
  box(10.6, 0.28, 0.6, M.trim, 0, 7.6, -6.0)
  // hood power bulges — V lines converging on the nose (front reads as hood)
  for (const sx of [-1, 1]) box(0.35, 0.2, 6.2, M.trim, sx * 3.0, 7.74, -9.4, 0, -sx * 0.38)
  // trunk deck
  box(11.2, 1.3, 6.4, p.main, 0, 7.05, 8.0)
  box(10.6, 0.28, 0.5, M.trim, 0, 7.6, 5.4)
  // roof panel
  box(8.8, 1.0, 6.2, p.main, 0, 10.05, -0.9)

  // windshield — slanted glass, top tips back toward the roof
  box(10.6, 3.4, 0.9, M.glass, 0, 8.1, -5.2, 0.85)
  // rear window — slanted the other way
  box(9.8, 3.0, 0.8, M.glass, 0, 8.1, 3.3, -0.8)
  // side windows
  for (const sx of [-1, 1]) box(0.35, 3.0, 8.8, M.glass, sx * 5.5, 8.2, -0.7)

  // door seams + chrome handles + mirrors
  for (const sx of [-1, 1]) {
    box(0.16, 3.6, 4.8, M.trim, sx * 6.32, 5.1, -4.4)
    box(0.16, 3.6, 4.0, M.trim, sx * 6.32, 5.1, 3.9)
    box(0.5, 0.55, 2.0, M.chrome, sx * 6.55, 6.5, -4.6)
    box(0.5, 0.55, 2.0, M.chrome, sx * 6.55, 6.5, 3.6)
    box(0.4, 0.7, 0.5, M.trim, sx * 6.45, 8.35, -6.3)
    box(0.5, 0.8, 1.4, p.main, sx * 6.3, 8.35, -6.3)
  }

  // ---------- FRONT (nose at -z, faces the direction of travel) ----------
  box(12.6, 2.9, 1.4, p.dark, 0, 3.4, -12.9) // bumper fascia
  box(9.5, 1.6, 0.35, M.trim, 0, 3.2, -13.45) // grille
  for (const sx of [-1, 1]) {
    box(2.9, 1.0, 0.5, M.head, sx * 4.1, 4.0, -13.35) // headlight units
    box(3.6, 0.32, 0.9, M.head, sx * 4.0, 7.78, -12.55) // big bright lenses on the hood nose
    box(0.7, 0.7, 0.5, M.head, sx * 5.95, 3.85, -13.0) // outboard daylight lamps
  }
  box(7.8, 0.55, 0.7, M.trim, 0, 1.75, -13.35) // front splitter lip
  box(2.4, 1.0, 0.2, M.plate, 0, 3.0, -13.5) // license plate

  // ---------- REAR (at +z): red taillights + trunk ----------
  box(12.6, 2.9, 1.4, p.dark, 0, 3.4, 12.9) // rear fascia
  for (const sx of [-1, 1]) {
    box(3.3, 1.0, 0.5, M.tail, sx * 4.0, 4.0, 13.35) // taillight units
    box(3.6, 0.32, 0.9, M.tail, sx * 4.35, 7.78, 11.3) // lit strips on trunk lip
  }
  box(9.0, 0.45, 0.3, M.tail, 0, 3.6, 13.55) // full-width brake light
  box(9.4, 0.5, 1.1, p.dark, 0, 8.15, 11.2) // ducktail spoiler lip — marks the trunk
  box(6.4, 1.2, 0.5, M.trim, 0, 1.6, 13.45) // rear diffuser
  box(2.4, 1.0, 0.2, M.plate, 0, 3.0, 13.5)
  for (const sx of [-1, 1]) box(1.0, 0.7, 0.8, M.chrome, sx * 3.4, 1.5, 13.3) // exhaust tips

  // police light bar mounted on the roof
  if (isPolice) {
    box(4.4, 0.9, 2.4, M.trim, 0, 10.9, -0.9)
    box(1.7, 1.2, 2.2, M.sirenR, -1.15, 11.65, -0.9)
    box(1.7, 1.2, 2.2, M.sirenB, 1.15, 11.65, -0.9)
  }

  // merge everything into one draw call per material
  const byMat = new Map()
  for (const part of parts) {
    let list = byMat.get(part.mat)
    if (!list) byMat.set(part.mat, (list = []))
    list.push(part)
  }
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list.map((part) => part.geo.clone().applyMatrix4(part.m)), false)
    if (merged) g.add(new THREE.Mesh(merged, mat))
  }
  g.traverse((o) => { if (o.isMesh && o.material !== M.shadow) o.castShadow = true })
  return g
}

function makeCanvasTex(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const rigTextures = {}
function rigTex(name, make) {
  if (!rigTextures[name]) rigTextures[name] = make()
  return rigTextures[name]
}
function texSkin() {
  return rigTex('skin', () => makeCanvasTex(64, 64, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, '#f8c196')
    g.addColorStop(0.55, '#f0aa7c')
    g.addColorStop(1, '#d98c5f')
    c.fillStyle = g
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 260; i++) {
      c.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,25,10,0.06)'
      c.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4)
    }
  }))
}
function texCloth() {
  return rigTex('cloth', () => makeCanvasTex(64, 64, (c, w, h) => {
    c.fillStyle = 'rgba(255,255,255,0.96)'
    c.fillRect(0, 0, w, h)
    const g = c.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, 'rgba(25,20,16,0.5)')
    g.addColorStop(0.3, 'rgba(255,255,255,0.22)')
    g.addColorStop(0.7, 'rgba(20,15,10,0.14)')
    g.addColorStop(1, 'rgba(30,24,18,0.5)')
    c.fillStyle = g
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 220; i++) {
      c.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(15,12,10,0.1)'
      c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5)
    }
  }))
}
function texPants() {
  return rigTex('pants', () => makeCanvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#5c6170'
    c.fillRect(0, 0, w, h)
    const g = c.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(255,255,255,0.4)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.06)')
    g.addColorStop(1, 'rgba(0,0,0,0.3)')
    c.fillStyle = g
    c.fillRect(0, 0, w, h)
    c.globalAlpha = 0.18
    for (let i = 0; i < h; i += 2) {
      c.fillStyle = i % 4 ? 'rgba(255,255,255,0.6)' : 'rgba(8,8,12,0.6)'
      c.fillRect(0, i, w, 1)
    }
    c.globalAlpha = 1
  }))
}
function texHair() {
  return rigTex('hair', () => makeCanvasTex(64, 64, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, '#5c3d22')
    g.addColorStop(0.5, '#44311e')
    g.addColorStop(1, '#2a1d10')
    c.fillStyle = g
    c.fillRect(0, 0, w, h)
    c.fillStyle = 'rgba(255,255,255,0.1)'
    for (let i = 0; i < 90; i++) c.fillRect(Math.random() * w, Math.random() * h, 2.5, 1.1)
  }))
}
function texShoe() {
  return rigTex('shoe', () => makeCanvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#181b21'
    c.fillRect(0, 0, w, h)
    c.fillStyle = 'rgba(255,255,255,0.13)'
    for (let i = 0; i < 140; i++) c.fillRect(Math.random() * w, Math.random() * h, 2, 1.2)
  }))
}

function boxGeo(w, h, d, x, y, z) {
  const b = new THREE.BoxGeometry(w, h, d)
  b.translate(x, y, z)
  return b
}
function sphGeo(r, x, y, z, sx = 1, sy = 1, sz = 1) {
  const s = new THREE.SphereGeometry(r, 12, 9)
  s.scale(sx, sy, sz)
  s.translate(x, y, z)
  return s
}

let rigGeoCache = null
function buildRigGeo() {
  if (rigGeoCache) return rigGeoCache
  const torso = mergeGeometries([
    boxGeo(2.9, 1.5, 1.9, 0, 0.35, 0),
    boxGeo(3.6, 3.2, 2.0, 0, 3.05, 0),
    sphGeo(0.85, -1.95, 3.8, 0),
    sphGeo(0.85, 1.95, 3.8, 0),
    boxGeo(0.95, 1.1, 0.95, 0, 4.55, 0),
    sphGeo(1.9, 0, 5.35, 0),
    sphGeo(2.05, 0, 5.85, 0, 1.05, 0.55, 1.05),
    sphGeo(0.18, -0.6, 5.75, -2.05),
    sphGeo(0.18, 0.6, 5.75, -2.05),
    boxGeo(0.34, 0.4, 0.42, 0, 5.32, -1.98),
    sphGeo(0.28, 0, 4.98, -2.12)
  ])
  const legL = mergeGeometries([
    boxGeo(1.6, 3.0, 1.7, 0, -1.55, 0),
    boxGeo(1.35, 3.0, 1.4, 0, -4.55, 0),
    boxGeo(1.5, 1.7, 2.4, 0, -6.9, -0.45)
  ])
  const legR = legL.clone()
  const armL = mergeGeometries([
    boxGeo(1.45, 2.1, 1.5, 0, -1.05, 0),
    boxGeo(1.3, 1.8, 1.35, 0, -2.7, 0),
    sphGeo(0.5, 0, -3.7, 0)
  ])
  const armR = armL.clone()
  return (rigGeoCache = { torso, legL, legR, armL, armR })
}

let rigSkinM = null
let rigPantsM = null
let rigHairM = null
let rigShoeM = null
let rigDarkM = null
let rigNoseM = null
let rigMouthM = null
const rigShirtMats = {}

function getSkinM() { return (rigSkinM ||= new THREE.MeshLambertMaterial({ map: texSkin() })) }
function getPantsM() { return (rigPantsM ||= new THREE.MeshLambertMaterial({ map: texPants() })) }
function getHairM() { return (rigHairM ||= new THREE.MeshLambertMaterial({ map: texHair() })) }
function getShoeM() { return (rigShoeM ||= new THREE.MeshLambertMaterial({ map: texShoe() })) }
function getDarkM() { return (rigDarkM ||= new THREE.MeshLambertMaterial({ color: 0x131018 })) }
function getNoseM() { return (rigNoseM ||= new THREE.MeshLambertMaterial({ color: 0xdda074 })) }
function getMouthM() { return (rigMouthM ||= new THREE.MeshLambertMaterial({ color: 0x7a3b30 })) }
function getShirtM(color) {
  const key = color + ''
  if (!rigShirtMats[key]) rigShirtMats[key] = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), map: texCloth() })
  return rigShirtMats[key]
}

let rigShadowGeo = null
const rigShadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })

function makePed(shirtColor) {
  if (typeof window !== 'undefined' && window.__SIMPLE_PED) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.8, 6.4, 3, 8), new THREE.MeshLambertMaterial({ color: shirtColor }))
    body.position.y = 6.2
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.5, 8, 6), new THREE.MeshLambertMaterial({ color: 0xf0ab7d }))
    head.position.y = 12.9
    const hair = new THREE.Mesh(new THREE.SphereGeometry(2.5, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3d2f20 }))
    hair.position.y = 14.3
    hair.scale.set(1, 0.7, 1)
    g.add(body, head, hair)
    return g
  }
  const g = new THREE.Group()
  const geo = buildRigGeo()
  const skinM = getSkinM()
  const shirtM = getShirtM(shirtColor)
  const pantsM = getPantsM()
  const hairM = getHairM()
  const shoeM = getShoeM()
  const darkM = getDarkM()
  const noseM = getNoseM()
  const mouthM = getMouthM()

  const torso = new THREE.Group()
  torso.position.y = 7.6
  torso.add(new THREE.Mesh(geo.torso, [
    pantsM, shirtM, shirtM, shirtM, skinM, skinM, hairM, darkM, darkM, noseM, mouthM
  ]))
  g.add(torso)

  const legL = new THREE.Group()
  legL.position.set(-1.55, 7.6, 0)
  legL.add(new THREE.Mesh(geo.legL, [pantsM, pantsM, shoeM]))
  g.add(legL)

  const legR = new THREE.Group()
  legR.position.set(1.55, 7.6, 0)
  legR.add(new THREE.Mesh(geo.legR, [pantsM, pantsM, shoeM]))
  g.add(legR)

  const armL = new THREE.Group()
  armL.position.set(-2.05, 11.0, 0)
  armL.add(new THREE.Mesh(geo.armL, [shirtM, skinM, skinM]))
  g.add(armL)

  const armR = new THREE.Group()
  armR.position.set(2.05, 11.0, 0)
  armR.add(new THREE.Mesh(geo.armR, [shirtM, skinM, skinM]))
  g.add(armR)

  if (!rigShadowGeo) rigShadowGeo = new THREE.CircleGeometry(3.9, 18)
  const shadow = new THREE.Mesh(rigShadowGeo, rigShadowMat)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.04
  g.add(shadow)

  g.userData.rig = { phase: rand(0, 6.28), legL, legR, armL, armR, torso }
  return g
}

function animatePed(g, moving, speed, dt) {
  const rig = g.userData.rig
  if (!rig) return
  if (!rig) { g.position.y = 0; return }
  if (moving) rig.phase += speed * dt * 0.09
  const k = Math.min(1, dt * 12)
  const amp = moving ? Math.min(1.05, 0.34 + speed * 0.0018) : 0
  const sw = Math.sin(rig.phase) * amp
  rig.legL.rotation.x += (sw - rig.legL.rotation.x) * k
  rig.legR.rotation.x += (-sw - rig.legR.rotation.x) * k
  rig.armL.rotation.x += (-sw * 0.62 - rig.armL.rotation.x) * k
  rig.armR.rotation.x += (sw * 0.62 - rig.armR.rotation.x) * k
  const lean = moving ? Math.min(0.12, speed * 0.00045) : 0
  rig.torso.rotation.x += (lean - rig.torso.rotation.x) * k
  g.position.y = moving ? Math.abs(Math.cos(rig.phase)) * (0.1 + Math.min(0.28, speed * 0.0009)) : 0
}

// ---------------------------------------------------------------------------
// city geometry
// ---------------------------------------------------------------------------
const GROUND_PX = 8
const SW_H = 0.46
const CURB_W = 1.15

function buildGround() {
  const PX = GROUND_PX
  const W = mapW * PX
  const H = mapH * PX
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(W, H)
  const b = img.data

  const PAL = {
    1: [63, 124, 63], 2: [157, 157, 153], 3: [48, 51, 58], 4: [44, 46, 51],
    5: [109, 112, 120], 6: [165, 83, 63], 7: [200, 178, 144], 8: [46, 91, 35],
    9: [42, 111, 176], 10: [51, 53, 59], 11: [188, 184, 174], 12: [107, 86, 51], 13: [46, 125, 134]
  }
  const EDGE = [232, 233, 237]
  const CENTER = [178, 166, 92]
  const CROSS = [240, 240, 243]

  const set = (x, y, r, g, bl) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    b[i] = r; b[i + 1] = g; b[i + 2] = bl; b[i + 3] = 255
  }
  const dith = (i, v) => {
    b[i] = Math.max(0, Math.min(255, b[i] + v))
    b[i + 1] = Math.max(0, Math.min(255, b[i + 1] + v))
    b[i + 2] = Math.max(0, Math.min(255, b[i + 2] + v))
  }
  const lineV = (x, y0, len, col) => {
    for (let j = 0; j < len; j++) set(x, y0 + j, col[0], col[1], col[2])
  }
  const lineH = (y, x0, len, col) => {
    for (let j = 0; j < len; j++) set(x0 + j, y, col[0], col[1], col[2])
  }
  const speckle = (x0, y0, n, amp) => {
    for (let k = 0; k < n; k++) {
      const sx = x0 + (Math.random() * PX) | 0
      const sy = y0 + (Math.random() * PX) | 0
      dith((sy * W + sx) * 4, (Math.random() - 0.5) * 2 * amp)
    }
  }
  const clump = (x0, y0, w, h, v) => {
    const sx = x0 + (Math.random() * (PX - w)) | 0
    const sy = y0 + (Math.random() * (PX - h)) | 0
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        dith(((sy + j) * W + sx + i) * 4, v)
  }

  // ---- base fill: flat tile colors with a slight per-tile tint ------------
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const gid = groundGids[ty * mapW + tx]
      const col = PAL[gid] || PAL[1]
      const t = (hue(tx, ty, 0.3) - 0.5) * 12
      const r0 = col[0] + t
      const g0 = col[1] + t
      const b0 = col[2] + t
      const x0 = tx * PX
      const y0 = ty * PX
      for (let j = 0; j < PX; j++) {
        let i = ((y0 + j) * W + x0) * 4
        const e = i + PX * 4
        for (; i < e; i += 4) {
          b[i] = r0; b[i + 1] = g0; b[i + 2] = b0; b[i + 3] = 255
        }
      }
    }
  }

  // ---- per-tile detail pass ------------------------------------------------
  const gidAt = (gx, gy) =>
    gx < 0 || gy < 0 || gx >= mapW || gy >= mapH ? 0 : groundGids[gy * mapW + gx]
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const gid = groundGids[ty * mapW + tx]
      const x0 = tx * PX
      const y0 = ty * PX
      if (gid === 3 || gid === 4) {
        // ---- road / intersection -----------------------------------------
        speckle(x0, y0, 22, 26)
        if (Math.random() < 0.85) clump(x0, y0, 2 + (Math.random() * 2) | 0, 1 + (Math.random() * 2) | 0, Math.random() < 0.5 ? -20 : 15)
        if (Math.random() < 0.35) clump(x0, y0, 3, 2, -14)
        const dirV = tx % 8 === 0 && ty % 8 !== 0
        const dirH = ty % 8 === 0 && tx % 8 !== 0
        if (gid === 3) {
          if (dirV) {
            lineV(x0 + 1, y0, PX, EDGE)
            lineV(x0 + PX - 2, y0, PX, EDGE)
            for (let j = 0; j < PX; j++) {
              const g = y0 + j
              if (g % 28 < 14) set(x0 + (PX >> 1), g, CENTER[0], CENTER[1], CENTER[2])
            }
            for (let j = 0; j < PX; j++) {
              dith(((y0 + j) * W + x0 + 2) * 4, -16)
              dith(((y0 + j) * W + x0 + 3) * 4, -16)
              dith(((y0 + j) * W + x0 + PX - 4) * 4, -16)
              dith(((y0 + j) * W + x0 + PX - 3) * 4, -16)
            }
          } else if (dirH) {
            lineH(y0 + 1, x0, PX, EDGE)
            lineH(y0 + PX - 2, x0, PX, EDGE)
            for (let j = 0; j < PX; j++) {
              const g = x0 + j
              if (g % 28 < 14) set(g, y0 + (PX >> 1), CENTER[0], CENTER[1], CENTER[2])
            }
            for (let j = 0; j < PX; j++) {
              dith(((y0 + 2) * W + x0 + j) * 4, -16)
              dith(((y0 + 3) * W + x0 + j) * 4, -16)
              dith(((y0 + PX - 4) * W + x0 + j) * 4, -16)
              dith(((y0 + PX - 3) * W + x0 + j) * 4, -16)
            }
          } else {
            // intersection: keep edge lines, drop center dashes
            lineV(x0 + 1, y0, PX, EDGE)
            lineV(x0 + PX - 2, y0, PX, EDGE)
            lineH(y0 + 1, x0, PX, EDGE)
            lineH(y0 + PX - 2, x0, PX, EDGE)
          }
        } else {
          // crosswalk stripes
          for (let j = 0; j < PX; j++) {
            if ((j % 5) < 3) lineH(y0 + j, x0 + 1, PX - 2, CROSS)
          }
          lineV(x0 + 1, y0, PX, EDGE)
          lineV(x0 + PX - 2, y0, PX, EDGE)
        }
      } else if (gid === 2) {
        // ---- sidewalk ------------------------------------------------------
        speckle(x0, y0, 10, 8)
        lineV(x0 + (PX >> 1), y0, PX, [86, 87, 92])
        lineH(y0 + (PX >> 1), x0, PX, [86, 87, 92])
        set(x0 + (PX >> 1) + 1, y0 + (PX >> 1) + 1, 128, 129, 134)
        if (gidAt(tx - 1, ty) === 3 || gidAt(tx - 1, ty) === 4) lineV(x0, y0, PX, [38, 40, 46])
        if (gidAt(tx + 1, ty) === 3 || gidAt(tx + 1, ty) === 4) lineV(x0 + PX - 1, y0, PX, [38, 40, 46])
        if (gidAt(tx, ty - 1) === 3 || gidAt(tx, ty - 1) === 4) lineH(y0, x0, PX, [38, 40, 46])
        if (gidAt(tx, ty + 1) === 3 || gidAt(tx, ty + 1) === 4) lineH(y0 + PX - 1, x0, PX, [38, 40, 46])
      } else if (gid === 1) {
        speckle(x0, y0, 16, 14)
        for (let k = 0; k < 4; k++) {
          const sx = x0 + (Math.random() * PX) | 0
          const sy = y0 + (Math.random() * (PX - 2)) | 0
          dith((sy * W + sx) * 4, -22)
          dith(((sy + 1) * W + sx) * 4, -22)
        }
        for (let k = 0; k < 2; k++) {
          const sx = x0 + (Math.random() * PX) | 0
          const sy = y0 + (Math.random() * (PX - 2)) | 0
          dith((sy * W + sx) * 4, 18)
          dith(((sy + 1) * W + sx) * 4, 18)
        }
      } else if (gid === 9) {
        speckle(x0, y0, 12, 18)
        for (let k = 0; k < 3; k++) {
          const sx = x0 + (Math.random() * (PX - 3)) | 0
          const sy = y0 + (Math.random() * (PX - 2)) | 0
          for (let j = 0; j < 2; j++) {
            dith(((sy + j) * W + sx) * 4, 20)
            dith(((sy + j) * W + sx + 1) * 4, 20)
          }
        }
      } else if (gid === 10) {
        speckle(x0, y0, 10, 12)
        lineV(x0 + 2, y0, PX, [159, 163, 169])
        lineV(x0 + PX - 3, y0, PX, [159, 163, 169])
        clump(x0, y0, 2, 2, -18)
      } else if (gid === 11) {
        speckle(x0, y0, 16, 10)
        if (Math.random() < 0.5) {
          const sx = x0 + (Math.random() * (PX - 3)) | 0
          const sy = y0 + (Math.random() * (PX - 3)) | 0
          lineV(sx, sy, 2 + (Math.random() * 2) | 0, [140, 137, 128])
        }
      } else if (gid === 12) {
        speckle(x0, y0, 26, 20)
        clump(x0, y0, 3, 2, 18)
      }
    }
  }

  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(mapW * TILE, mapH * TILE),
    new THREE.MeshBasicMaterial({ map: tex })
  )
  plane.rotation.x = -Math.PI / 2
  plane.position.set((mapW * TILE) / 2, 0, (mapH * TILE) / 2)
  plane.receiveShadow = true
  scene.add(plane)
}

// raised sidewalk slabs + curbs along every road edge
function buildCurbs() {
  const gidAt = (gx, gy) =>
    gx < 0 || gy < 0 || gx >= mapW || gy >= mapH ? 0 : groundGids[gy * mapW + gx]

  const sw = []
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (gidAt(x, y) === 2) sw.push([x * TILE + TILE / 2, y * TILE + TILE / 2])
    }
  }
  if (sw.length) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, SW_H, TILE),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      sw.length
    )
    const m = new THREE.Matrix4()
    const col = new THREE.Color()
    for (let i = 0; i < sw.length; i++) {
      m.makeTranslation(sw[i][0], SW_H / 2, sw[i][1])
      mesh.setMatrixAt(i, m)
      const v = 0.86 + hue(sw[i][0], sw[i][1], 0.7) * 0.18
      col.setRGB(0.72 * v, 0.72 * v, 0.69 * v)
      mesh.setColorAt(i, col)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    scene.add(mesh)
  }

  const curbs = []
  const pushRun = (px, pz, sx, sz) => {
    curbs.push({ x: px, z: pz, sx, sz })
  }
  // vertical road columns: curb along the left/right boundary of each road
  for (let cx = 0; cx < mapW; cx += 8) {
    for (const side of [-1, 1]) {
      const gx = cx + side
      let run = null
      for (let y = 0; y <= mapH; y++) {
        const ok = y < mapH && (gidAt(gx, y) === 2)
        if (ok && run === null) run = y
        else if (!ok && run !== null) {
          const z0 = run * TILE
          const z1 = y * TILE
          if (z1 - z0 > 2) pushRun(cx * TILE + (side < 0 ? 0 : TILE), (z0 + z1) / 2, CURB_W, z1 - z0)
          run = null
        }
      }
    }
  }
  // horizontal road rows
  for (let cy = 0; cy < mapH; cy += 8) {
    for (const side of [-1, 1]) {
      const gy = cy + side
      let run = null
      for (let x = 0; x <= mapW; x++) {
        const ok = x < mapW && (gidAt(x, gy) === 2)
        if (ok && run === null) run = x
        else if (!ok && run !== null) {
          const x0 = run * TILE
          const x1 = x * TILE
          if (x1 - x0 > 2) pushRun((x0 + x1) / 2, cy * TILE + (side < 0 ? 0 : TILE), x1 - x0, CURB_W)
          run = null
        }
      }
    }
  }
  if (curbs.length) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      curbs.length
    )
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    for (let i = 0; i < curbs.length; i++) {
      const cb = curbs[i]
      m.compose(
        new THREE.Vector3(cb.x, SW_H / 2, cb.z),
        q,
        new THREE.Vector3(cb.sx, SW_H, cb.sz)
      )
      mesh.setMatrixAt(i, m)
      const v = 0.84 + hue(cb.x, cb.z, 0.5) * 0.2
      col.setRGB(0.66 * v, 0.66 * v, 0.63 * v)
      mesh.setColorAt(i, col)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    scene.add(mesh)
  }
}

function buildBuildings() {
  const types = {
    5: { base: 22, jit: 36, col: 0x6d7078 },
    6: { base: 13, jit: 22, col: 0xa5533f },
    7: { base: 30, jit: 42, col: 0xc8b290 },
    13: { base: 44, jit: 46, col: 0x2e7d86 }
  }
  const cenX = (mapW * TILE) / 2
  const cenY = (mapH * TILE) / 2
  const mats = {}
  const buckets = {}
  for (const k of Object.keys(types)) {
    mats[k] = new THREE.MeshLambertMaterial({ color: types[k].col })
    buckets[k] = []
  }
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const b = bldGids[y * mapW + x]
      if (!b || !types[b]) continue
      const px = x * TILE + 8
      const py = y * TILE + 8
      const d = Math.hypot(px - cenX, py - cenY)
      const boost = d < 700 ? 24 * (1 - d / 700) : 0
      const h = Math.min(92, Math.max(6, types[b].base + hue(x, y, 0.2) * types[b].jit + boost))
      buckets[b].push({ x: px, z: py, h })
    }
  }
  const mat = new THREE.Matrix4()
  const tcol = new THREE.Color()
  for (const k of Object.keys(buckets)) {
    const list = buckets[k]
    if (!list.length) continue
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 1, TILE), mats[k], list.length)
    inst.castShadow = true
    inst.receiveShadow = true
    list.forEach((it, i) => {
      mat.makeTranslation(it.x, it.h / 2, it.z)
      inst.setMatrixAt(i, mat)
      inst.setColorAt(i, tcol.setHex(types[k].col).multiplyScalar(0.95 + hue(it.x, it.z, 0.5) * 0.1))
    })
    inst.instanceMatrix.needsUpdate = true
    inst.instanceColor.needsUpdate = true
    scene.add(inst)
  }
}

let barkTex = null
function texBark() {
  if (barkTex) return barkTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')
  const base = g.createLinearGradient(0, 0, 0, 128)
  base.addColorStop(0, '#6b4826')
  base.addColorStop(1, '#4c3115')
  g.fillStyle = base
  g.fillRect(0, 0, 64, 128)
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 64
    const y0 = Math.random() * 128
    const len = 14 + Math.random() * 90
    g.strokeStyle = Math.random() < 0.55
      ? `rgba(128,82,52,${(0.18 + Math.random() * 0.3).toFixed(2)})`
      : `rgba(28,17,6,${(0.22 + Math.random() * 0.3).toFixed(2)})`
    g.lineWidth = 0.8 + Math.random() * 2.4
    g.beginPath()
    g.moveTo(x, y0)
    g.quadraticCurveTo(x + (Math.random() * 7 - 3.5), y0 + len * 0.5, x + (Math.random() * 9 - 4.5), y0 + len)
    g.stroke()
  }
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `rgba(28,19,8,${(0.3 + Math.random() * 0.25).toFixed(2)})`
    g.beginPath()
    g.ellipse(Math.random() * 64, Math.random() * 128, 1.3 + Math.random(), 2 + Math.random() * 1.6, Math.random() * 1.5, 0, Math.PI * 2)
    g.fill()
  }
  barkTex = new THREE.CanvasTexture(c)
  barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping
  barkTex.colorSpace = THREE.SRGBColorSpace
  return barkTex
}

let leafTex = null
function texLeaves() {
  if (leafTex) return leafTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#14381a'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 340; i++) {
    const shade = Math.random()
    g.fillStyle = shade < 0.45
      ? `rgba(28,72,34,${(0.35 + Math.random() * 0.4).toFixed(2)})`
      : shade < 0.8
        ? `rgba(56,122,38,${(0.3 + Math.random() * 0.4).toFixed(2)})`
        : `rgba(88,142,52,${(0.25 + Math.random() * 0.35).toFixed(2)})`
    const r = 1.2 + Math.random() * 3.2
    g.beginPath()
    g.arc(Math.random() * 64, Math.random() * 64, r, 0, Math.PI * 2)
    g.fill()
  }
  leafTex = new THREE.CanvasTexture(c)
  leafTex.colorSpace = THREE.SRGBColorSpace
  return leafTex
}

function buildTrees() {
  const list = []
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (bldGids[y * mapW + x] === 8) list.push({ x: x * TILE + 8, z: y * TILE + 8 })
    }
  }
  if (!list.length) return
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.25, 1.9, 8, 7), new THREE.MeshLambertMaterial({ map: texBark() }), list.length)
  const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4.6, 1), new THREE.MeshLambertMaterial({ map: texLeaves() }), list.length)
  const lobe = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.9, 1), new THREE.MeshLambertMaterial({ map: texLeaves() }), list.length)
  trunk.castShadow = true
  canopy.castShadow = true
  lobe.castShadow = true
  const mat = new THREE.Matrix4()
  const col = new THREE.Color()
  const zero = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const sc = new THREE.Vector3()
  list.forEach((it, i) => {
    const v = hue(it.x, it.z, 0.1)
    const h = 0.72 + v * 0.5
    const r = 0.85 + hue(it.x, it.z, 0.37) * 0.35
    const cs = 0.8 + hue(it.x, it.z, 0.71) * 0.45
    const sq = 0.86 + hue(it.x, it.z, 0.53) * 0.26
    const cy = h * 8 + 3.1 * cs * sq
    pos.set(it.x, h * 4, it.z)
    sc.set(r, h, r)
    mat.compose(pos, zero, sc)
    trunk.setMatrixAt(i, mat)
    trunk.setColorAt(i, col.setHSL(0.075, 0.32, 0.22 + v * 0.09))
    pos.set(it.x, cy, it.z)
    sc.set(cs, cs * sq, cs)
    mat.compose(pos, zero, sc)
    canopy.setMatrixAt(i, mat)
    canopy.setColorAt(i, col.setHSL(0.29 + (hue(it.x, it.z, 0.9) - 0.5) * 0.07, 0.5 + hue(it.x, it.z, 0.9) * 0.22, 0.24 + hue(it.x, it.z, 0.3) * 0.16))
    if (hue(it.x, it.z, 0.19) > 0.45) {
      pos.set(it.x + (hue(it.x, it.z, 0.23) - 0.5) * 3.9, cy + 1.2 + hue(it.x, it.z, 0.31) * 2.2, it.z + (hue(it.x, it.z, 0.41) - 0.5) * 3.9)
      sc.set(cs * 0.62, cs * 0.5, cs * 0.62)
      mat.compose(pos, zero, sc)
      lobe.setMatrixAt(i, mat)
      lobe.setColorAt(i, col.setHSL(0.3 + (hue(it.x, it.z, 0.99) - 0.5) * 0.08, 0.52, 0.4 + hue(it.x, it.z, 0.13) * 0.16))
    } else {
      mat.makeScale(0.0001, 0.0001, 0.0001)
      lobe.setMatrixAt(i, mat)
    }
  })
  trunk.instanceMatrix.needsUpdate = true
  trunk.instanceColor.needsUpdate = true
  canopy.instanceMatrix.needsUpdate = true
  canopy.instanceColor.needsUpdate = true
  lobe.instanceMatrix.needsUpdate = true
  lobe.instanceColor.needsUpdate = true
  scene.add(trunk, canopy, lobe)
}

function buildStaticCars() {
  let i = 0
  for (const obj of parkedData) {
    const g = makeCarModel(CAR_PALETTES[i % CAR_PALETTES.length], false)
    g.position.set(obj.x, 0, obj.y)
    g.rotation.y = THREE.MathUtils.degToRad(obj.rotation)
    scene.add(g)
    parkedCars.push({ mesh: g, x: obj.x, y: obj.y, r: obj.rotation, speed: 0 })
    i++
  }
}
const parkedCars = []

// ---------------------------------------------------------------------------
// collision helpers
// ---------------------------------------------------------------------------
function solid(x, y) {
  if (x < 2 || y < 2 || x >= mapW * TILE - 2 || y >= mapH * TILE - 2) return true
  const gx = Math.floor(x / TILE)
  const gy = Math.floor(y / TILE)
  return !!solidTiles[gy * mapW + gx]
}

function circleHits(x, y, r) {
  const x0 = Math.floor((x - r) / TILE)
  const x1 = Math.floor((x + r) / TILE)
  const y0 = Math.floor((y - r) / TILE)
  const y1 = Math.floor((y + r) / TILE)
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      if (gx < 0 || gy < 0 || gx >= mapW || gy >= mapH || solidTiles[gy * mapW + gx]) {
        const cx = Math.max(gx * TILE, Math.min(x, gx * TILE + TILE))
        const cy = Math.max(gy * TILE, Math.min(y, gy * TILE + TILE))
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true
      }
    }
  }
  return false
}

function moveCircle(o, r, dx, dy) {
  if (!circleHits(o.x + dx, o.y, r)) o.x += dx
  if (!circleHits(o.x, o.y + dy, r)) o.y += dy
}

function shifted(r) {
  return { fx: Math.sin(r), fy: -Math.cos(r) }
}

function groundAt(x, y) {
  const gx = Math.floor(x / TILE)
  const gy = Math.floor(y / TILE)
  if (gx < 0 || gy < 0 || gx >= mapW || gy >= mapH) return 0
  return groundGids[gy * mapW + gx]
}

// ---------------------------------------------------------------------------
// gameplay
// ---------------------------------------------------------------------------
function offensive() {
  state.wanted = Math.min(5, state.wanted + 1)
  state.wantedTimer = 9000
  syncCops()
  updateStars()
  showMsg(state.wanted === 1 ? 'POLICE ARE ON YOUR TAIL' : `WANTED LEVEL ${state.wanted}`)
}

function knockPed(ped) {
  if (ped.knocked) return
  if (Date.now() - lastOffenseAt < 380) return
  lastOffenseAt = Date.now()
  ped.knocked = true
  ped.mesh.rotation.z = Math.PI / 2
  setTimeout(() => {
    scene.remove(ped.mesh)
    const idx = peds.indexOf(ped)
    if (idx >= 0) peds.splice(idx, 1)
    spawnPed()
  }, 2600)
  playCrash(0.4)
  offense()
}

function spawnPed() {
  const g = makePed(PED_SHIRTS[Math.floor(rand(0, PED_SHIRTS.length))])
  scene.add(g)
  let x = 0
  let y = 0
  for (let i = 0; i < 50; i++) {
    const t = roadTiles[Math.floor(rand(0, roadTiles.length))]
    x = t.x + rand(-8, 8)
    y = t.y + rand(-8, 8)
    if (!circleHits(x, y, 6)) break
  }
  g.position.set(x, 0, y)
  peds.push({ mesh: g, x, y, tx: 0, ty: 0, timer: rand(0.5, 4), knocked: false })
}

function copsNeeded() {
  return state.wanted === 0 ? 0 : state.wanted >= 3 ? 2 : 1
}

function syncCops() {
  const need = copsNeeded()
  while (cops.length > need) {
    const c = cops.pop()
    scene.remove(c.mesh)
  }
  while (cops.length < need) {
    const g = makeCarModel(0xf2f5f8, true)
    scene.add(g)
    let x = player.x
    let y = player.y
    for (let i = 0; i < 90; i++) {
      const t = roadTiles[Math.floor(rand(0, roadTiles.length))]
      if (dist2(player.x, player.y, t.x, t.y) > 400) {
        x = t.x
        y = t.y
        break
      }
    }
    g.position.set(x, 0, y)
    cops.push({ mesh: g, x, y, r: rand(0, Math.PI * 2), speed: 0 })
  }
}

function offense() {
  offensive()
}

function nearestCar() {
  let best = null
  let bestD = ENTER_RADIUS
  for (const c of parkedCars) {
    const d = dist2(player.x, player.y, c.x, c.y)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

function enterCar(c) {
  car.inCar = true
  car.cur = c
  car.x = c.x
  car.y = c.y
  car.r = THREE.MathUtils.degToRad(c.r)
  car.speed = 0
  player.mesh.visible = false
  el('hud-prompt').style.display = 'none'
  updateHud()
}

function exitCar() {
  let px = car.x + 0
  let py = car.y - 20
  for (let a = 0; a < 12; a++) {
    const ang = a / 12 * Math.PI * 2
    const dx = Math.sin(ang) * 20
    const dy = -Math.cos(ang) * 20
    if (!circleHits(car.x + dx, car.y + dy, 7)) {
      px = car.x + dx
      py = car.y + dy
      break
    }
  }
  player.x = px
  player.y = py
  player.mesh.visible = true
  car.inCar = false
  car.speed = 0
}

function startMission() {
  state.missionActive = true
  state.missionTarget = null
  const ref = car.inCar ? car : player
  const pool = roadTiles.filter((t) => dist2(ref.x, ref.y, t.x, t.y) > MISSION_MIN)
  if (pool.length) {
    const t = pool[Math.floor(rand(0, pool.length))]
    state.missionTarget = { x: t.x, y: t.y }
  }
  if (state.missionTarget) showMsg('MISSION — DRIVE TO THE WAYPOINT')
  else {
    state.missionActive = false
    state.missionTimer = MISSION_RESTART
    showMsg('NO MISSION TARGETS, RETRYING', 1300)
  }
}

function completeMission() {
  state.missionActive = false
  state.missionTimer = MISSION_RESTART
  state.money += MISSION_REWARD
  showMsg(`MISSION COMPLETE  +$${MISSION_REWARD}`)
}

function updateMission(dt) {
  if (state.missionActive && state.missionTarget) {
    const ref = car.inCar ? car : player
    if (dist2(ref.x, ref.y, state.missionTarget.x, state.missionTarget.y) < MISSION_CLAIM) completeMission()
    return
  }
  state.missionTimer -= dt
  if (state.missionTimer <= 0) {
    state.missionTimer = MISSION_TIMER
    startMission()
  }
}

function busted() {
  if (state.busted) return
  state.busted = true
  setEngine(0)
  playBusted()
  el('hud-busted').style.display = 'flex'
  showMsg('BUSTED')
}

function damage(n) {
  state.health = Math.max(0, state.health - n)
  if (state.health <= 0) busted()
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
function updateMovement(dt) {
  if (car.inCar) return
  let dx = 0
  let dy = 0
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1
  if (keys.has('d') || keys.has('arrowright')) dx += 1
  if (keys.has('w') || keys.has('arrowup')) dy -= 1
  if (keys.has('s') || keys.has('arrowdown')) dy += 1
  const sp = keys.has('shift') ? SPRINT : WALK
  const len = Math.hypot(dx, dy)
  player.moving = len > 0
  if (len > 0) {
    dx /= len
    dy /= len
    player.r = Math.atan2(dx, -dy)
  }
  moveCircle(player, 7, dx * sp * dt, dy * sp * dt)
  player.mesh.position.set(player.x, 0, player.y)
  player.mesh.rotation.y = player.r
  animatePed(player.mesh, len > 0, sp, dt)

  for (const p of peds) {
    if (p.knocked) continue
    if (dist2(player.x, player.y, p.x, p.y) < 11 && len > 0) knockPed(p)
  }
}

function updateDrive(dt) {
  const throttle = keys.has('arrowup') || keys.has('w') ? 1 : 0
  const back = keys.has('arrowdown') || keys.has('s') ? 1 : 0
  const steerIn = (keys.has('arrowleft') || keys.has('a') ? 1 : 0) - (keys.has('arrowright') || keys.has('d') ? 1 : 0)
  const D = DRIVE

  const gid = groundAt(car.x, car.y)
  const onRoad = gid === 3 || gid === 4 || gid === 10
  const maxSpeed = MAX_SPEED * (onRoad ? 1 : D.OFFROAD_FACTOR)

  // ---- longitudinal: throttle eases off near top speed, brakes bite, coast keeps momentum ----
  let v = car.speed
  if (throttle && !back) {
    if (v < -0.5) v = Math.min(0, v + D.BRAKE * dt)
    else v += D.ACCEL * Math.pow(Math.max(0, 1 - v / maxSpeed), D.ACCEL_CURVE) * dt
  } else if (back && !throttle) {
    if (v > 0.5) v = Math.max(0, v - D.BRAKE * dt)
    else v -= D.REVERSE_ACCEL * Math.pow(Math.max(0, 1 + v / D.REVERSE_MAX), D.ACCEL_CURVE) * dt
  } else if (throttle && back) {
    v = Math.max(0, v - D.BRAKE * dt)
  } else {
    v *= Math.exp(-(onRoad ? D.COAST_ROAD : D.COAST_OFFROAD) * dt)
    if (Math.abs(v) < 1.5) v = 0
  }
  v = Math.max(-D.REVERSE_MAX, Math.min(maxSpeed, v))
  car.speed = v

  // ---- steering: smoothed input + speed-shaped authority, no snapping ----
  const d = Math.min(1, D.STEER_RESPONSE * dt)
  car._steer += (steerIn - car._steer) * d
  const sp = Math.abs(v)
  const frac = Math.min(1, sp / maxSpeed)
  if (sp > D.MIN_STEER_SPEED) {
    const turn = frac * (1 - 0.32 * frac) * D.STEER
    car.r += car._steer * turn * dt * (v > 0 ? 1 : -1)
  }

  const { fx, fy } = shifted(car.r)

  const oldX = car.x
  const oldY = car.y
  moveCircle(car, 9, fx * sp * dt, fy * sp * dt)
  const moved = dist2(oldX, oldY, car.x, car.y)
  if (sp > 110 && moved < sp * dt * 0.3 && crashCooldown <= 0) {
    crashCooldown = 0.5
    playCrash(Math.min(1, sp / 220))
    damage(8)
  }
  if (crashCooldown > 0) crashCooldown -= dt
  if (car.cur) {
    car.cur.mesh.position.set(car.x, 0, car.y)
    car.cur.mesh.rotation.y = car.r
    car.cur.mesh.rotation.z = -car._steer * Math.min(1, sp / 150) * 0.05 // body roll while cornering
  }

  for (const p of peds) {
    if (p.knocked) continue
    if (dist2(car.x, car.y, p.x, p.y) < 15 && sp > 70) {
      knockPed(p)
    }
  }
}

function updatePeds(dt) {
  for (const p of peds) {
    if (p.knocked) continue
    p.timer -= dt
    if (p.timer <= 0) {
      p.timer = rand(2, 7)
      for (let i = 0; i < 12; i++) {
        const t = roadTiles[Math.floor(rand(0, roadTiles.length))]
        const d = dist2(p.x, p.y, t.x, t.y)
        if (d > 120 && d < 900) {
          p.tx = t.x
          p.ty = t.y
          break
        }
      }
    }
    if (!p.tx) continue
    const d = dist2(p.x, p.y, p.tx, p.ty)
    if (d < 8) {
      p.tx = 0
      animatePed(p.mesh, false, 0, dt)
      continue
    }
    const sp = 45 * dt
    const ux = (p.tx - p.x) / d
    const uy = (p.ty - p.y) / d
    const nx = p.x + ux * sp
    const ny = p.y + uy * sp
    if (!solid(nx, ny)) {
      p.x = nx
      p.y = ny
      p.mesh.position.set(nx, 0, ny)
      const wantR = Math.atan2(ux, -uy)
      let dr = wantR - p.mesh.rotation.y
      dr = ((dr + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      p.mesh.rotation.y += dr * dt * 6
      animatePed(p.mesh, true, 45, dt)
    } else {
      animatePed(p.mesh, false, 0, dt)
    }
  }
}

function updateCops(dt) {
  if (!cops.length || state.wanted <= 0 || state.busted) return
  const tx = car.inCar ? car.x : player.x
  const ty = car.inCar ? car.y : player.y
  for (const cop of cops) {
    const d = dist2(cop.x, cop.y, tx, ty)
    const wantR = Math.atan2(tx - cop.x, -(ty - cop.y))
    let dr = wantR - cop.r
    dr = ((dr + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    cop.r += dr * 0.05
    cop.speed = Math.min(155, cop.speed + (d > 110 ? 90 : -140) * dt)
    cop.speed *= Math.exp(-22 * dt)
    const { fx, fy } = shifted(cop.r)
    moveCircle(cop, 9, fx * cop.speed * dt, fy * cop.speed * dt)
    cop.mesh.position.set(cop.x, 0, cop.y)
    cop.mesh.rotation.y = cop.r
    if (d < CATCH_RADIUS) busted()
  }
}

function updateMarker() {
  if (!state.missionActive || !state.missionTarget) {
    if (markerObj) markerObj.visible = false
    return
  }
  if (!markerObj) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(8, 12, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe24a, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 1.4
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 70, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe24a, transparent: true, opacity: 0.5 }))
    shaft.position.y = 35
    markerObj = new THREE.Group()
    markerObj.add(ring, shaft)
    scene.add(markerObj)
  }
  markerObj.visible = true
  markerObj.position.set(state.missionTarget.x, 0, state.missionTarget.y)
  markerObj.children[0].rotation.z = performance.now() / 1500
}

function drawMinimap() {
  const ctx = minimapCtx
  const s = 144
  if (!minimapBg) {
    minimapBg = document.createElement('canvas')
    minimapBg.width = s * 2
    minimapBg.height = s * 2
    const bg = minimapBg.getContext('2d')
    bg.fillStyle = '#10141b'
    bg.fillRect(0, 0, s * 2, s * 2)
    const PAL = { 1: '#3f7c3f', 2: '#2e343e', 3: '#525d6d', 4: '#525d6d', 9: '#2a6fb0', 10: '#2b2f37', 11: '#3a3f48' }
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const i = y * mapW + x
        const b = bldGids[i]
        if (b > 0 && b !== 8) {
          bg.fillStyle = '#636d79'
        } else {
          const gid = groundGids[i]
          if (gid === 0) continue
          bg.fillStyle = PAL[gid] || '#3a4048'
        }
        bg.fillRect(Math.floor((x * s * 2) / mapW), Math.floor((y * s * 2) / mapH), Math.ceil((s * 2) / mapW) + 1, Math.ceil((s * 2) / mapH) + 1)
      }
    }
  }
  ctx.clearRect(0, 0, s, s)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(minimapBg, 0, 0, s * 2, s * 2, 0, 0, s, s)
  const k = s / (mapW * TILE)
  const ref = car.inCar ? car : player
  const rim = (x, y, r) => {
    ctx.fillStyle = 'rgba(0,0,0,.6)'
    ctx.beginPath()
    ctx.arc(x, y, r + 1.6, 0, 7)
    ctx.fill()
  }
  for (const cop of cops) {
    if (dist2(ref.x, ref.y, cop.x, cop.y) > 1100) continue
    const x = cop.x * k
    const y = cop.y * k
    rim(x, y, 2.3)
    ctx.fillStyle = '#ff3b30'
    ctx.beginPath()
    ctx.arc(x, y, 2.3, 0, 7)
    ctx.fill()
  }
  if (state.missionActive && state.missionTarget) {
    const x = state.missionTarget.x * k
    const y = state.missionTarget.y * k
    rim(x, y, 3.4)
    const pulse = 1 + Math.sin(performance.now() / 220) * 0.6
    ctx.strokeStyle = '#ffe24a'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(x, y, 3.4 + pulse, 0, 7)
    ctx.stroke()
    ctx.fillStyle = '#ffe24a'
    ctx.beginPath()
    ctx.arc(x, y, 2, 0, 7)
    ctx.fill()
  }
  const px = ref.x * k
  const py = ref.y * k
  ctx.fillStyle = 'rgba(0,0,0,.6)'
  ctx.beginPath()
  ctx.arc(px, py, 5, 0, 7)
  ctx.fill()
  const ang = car.inCar ? car.r : player.r
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(ang)
  ctx.fillStyle = '#5eff5e'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.moveTo(0, -3.6)
  ctx.lineTo(2.8, 2.6)
  ctx.lineTo(0, 1.1)
  ctx.lineTo(-2.8, 2.6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
function loop() {
  requestAnimationFrame(loop)
  const dt = Math.min(clock.getDelta(), 0.05)

  if (state.busted) {
    if (keys.has('r')) window.location.reload()
    renderer.render(scene, camera)
    return
  }

  if (state.wanted > 0) {
    state.wantedTimer -= dt * 1000
    if (state.wantedTimer <= 0) {
      state.wanted--
      state.wantedTimer = 6000
      syncCops()
      updateStars()
      if (state.wanted === 0) showMsg('LOST THE HEAT')
    }
  }

  if (car.inCar) {
    updateDrive(dt)
    setEngine(Math.min(1, Math.abs(car.speed) / MAX_SPEED))
  } else {
    setEngine(0)
    updateMovement(dt)
    const nc = nearestCar()
    const prompt = el('hud-prompt')
    if (nc) {
      prompt.style.display = 'block'
      prompt.textContent = '[ E ]  ENTER VEHICLE'
    } else {
      prompt.style.display = 'none'
    }
  }

  updatePeds(dt)
  updateCops(dt)
  updateMission(dt)
  updateMarker()

  const ref = car.inCar ? car : player
  const { fx, fy } = shifted(car.inCar ? car.r : (player.moving ? player.r : 0))
  const d = state.cameraDist
  camTarget.set(ref.x - fx * d, 0, ref.y - fy * d)
  camTarget.y = d * 0.62
  camera.position.lerp(camTarget, 0.07)
  camera.lookAt(ref.x, 0, ref.y)
  dirLight.position.set(ref.x + 360, 740, ref.y - 240)
  dirLight.target.position.set(ref.x, 0, ref.y)

  hudTimer += dt
  if (hudTimer > 0.15) {
    hudTimer = 0
    updateHud()
  }
  miniTimer += dt
  if (miniTimer > 0.4) {
    miniTimer = 0
    drawMinimap()
  }

  renderer.render(scene, camera)
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
  if (!keys.size) unlockAudio()
  keys.add(k)
  if (state.busted) return
  if (k === 'e') {
    if (car.inCar) exitCar()
    else {
      const c = nearestCar()
      if (c) {
        enterCar(c)
        showMsg('ENTERED VEHICLE · [E] exit', 1300)
      }
    }
  }
  if (k === 't') {
    state.isNight = !state.isNight
    el('hud-night').style.opacity = state.isNight ? 1 : 0
    hemi.intensity = state.isNight ? 0.3 : 0.95
    dirLight.intensity = state.isNight ? 0.25 : 0.9
    scene.background = new THREE.Color(state.isNight ? 0x0a1030 : 0x87b7d8)
    scene.fog = new THREE.Fog(state.isNight ? 0x0a1030 : 0x87b7d8, state.isNight ? 140 : 420, state.isNight ? 1500 : 3300)
  }
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function boot() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87b7d8)
  scene.fog = new THREE.Fog(0x87b7d8, 420, 3300)
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 6000)
  hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a4634, 0.95)
  dirLight = new THREE.DirectionalLight(0xfff2d9, 0.9)
  dirLight.position.set(300, 600, -200)
  dirLight.castShadow = true
  const sh = 950
  dirLight.shadow.mapSize.set(2048, 2048)
  dirLight.shadow.camera.left = -sh
  dirLight.shadow.camera.right = sh
  dirLight.shadow.camera.top = sh
  dirLight.shadow.camera.bottom = -sh
  dirLight.shadow.camera.near = 100
  dirLight.shadow.camera.far = 2500
  dirLight.shadow.bias = -0.0004
  dirLight.shadow.normalBias = 1.1
  scene.add(hemi, dirLight, dirLight.target)

  initHud()

  const res = await fetch('assets/map/city.json')
  const map = await res.json()
  mapW = map.width
  mapH = map.height
  const gl = map.layers.find((l) => l.name === 'ground').data
  const bl = map.layers.find((l) => l.name === 'buildings').data
  groundGids = gl
  bldGids = bl
  solidTiles = new Uint8Array(mapW * mapH)
  roadTiles = []
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const i = y * mapW + x
      const gid = gl[i]
      if (gid === 3 || gid === 4) roadTiles.push({ x: x * TILE + 8, y: y * TILE + 8 })
      solidTiles[i] = (bl[i] > 0 || gid === 9) ? 1 : 0
    }
  }
  parkedData = map.layers.find((l) => l.type === 'objectgroup')?.objects || []
  const spawn = map.layers.find((l) => l.name === 'spawns')?.objects?.[0] || { x: mapW * TILE / 2, y: mapH * TILE / 2 }

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.domElement.id = 'gl'
  renderer.domElement.style.cssText = 'position:fixed;inset:0'
  document.body.insertBefore(renderer.domElement, document.body.firstChild)

  buildGround()
  buildCurbs()
  buildBuildings()
  buildTrees()
  buildStaticCars()

  const pMesh = makePed('#3fae6a')
  pMesh.scale.setScalar(1.3)
  scene.add(pMesh)
  player.mesh = pMesh
  player.x = spawn.x
  player.y = spawn.y
  player.mesh.position.set(spawn.x, 0, spawn.y)

  for (let i = 0; i < PED_COUNT; i++) spawnPed()

  window.addEventListener('wheel', (e) => {
    state.cameraDist = Math.max(55, Math.min(360, state.cameraDist + Math.sign(e.deltaY) * 18))
  }, { passive: true })
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  window.__GAME3D = {
    get player() { return { x: Math.round(player.x), y: Math.round(player.y) } },
    get inCar() { return car.inCar },
    get speed() { return Math.round(car.speed) },
    get money() { return state.money },
    get wanted() { return state.wanted },
    get health() { return Math.round(state.health) },
    get missionActive() { return state.missionActive },
    get missionTarget() { return state.missionTarget },
    get hudCash() { return el('hud-cash').textContent },
    get hudMed() { return el('med-pct').textContent },
    get hullStars() { return el('hud-stars').textContent },
    enterCar: () => { const c = nearestCar(); if (c) enterCar(c) },
    startMission,
    cars: () => parkedCars.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) })),
    roadTilesLen: roadTiles.length,
    teleport: (x, y) => {
      player.x = x
      player.y = y
      player.mesh.position.set(x, 0, y)
      if (player.tx) player.tx = 0
    },
    bustedTrigger: () => busted(),
    probe: (gx, gy) => ({ g: groundGids[gy * mapW + gx], b: bldGids[gy * mapW + gx], solid: solidTiles[gy * mapW + gx] }),
    debug: () => {
      if (!player.mesh) return null
      const tmp = new THREE.Vector3()
      const bb = new THREE.Box3().setFromObject(player.mesh)
      let tris = 0
      let culled = 0
      let total = 0
      const stack = [player.mesh]
      while (stack.length) {
        const o = stack.pop()
        if (o.isMesh) {
          const g = o.geometry
          const n = g ? (g.index ? g.index.count / 3 : g.attributes.position.count / 3) : 0
          tris += n
          total++
          const f = new THREE.Frustum()
          o.getWorldPosition(tmp)
          if (o.frustumCulled !== false && f.intersectsObject(o) === false) culled++
        }
        if (o.children) for (const c of o.children) stack.push(c)
      }
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      return {
        camPos: camera.position.toArray().map((v) => Math.round(v)),
        look: camera.getWorldDirection(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)),
        bbIntersects: fr.intersectsBox(bb),
        bb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((v) => Math.round(v)),
        worldPos: player.mesh.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Math.round(v)),
        totalTris: tris,
        totalMeshes: total,
        rendererInfo: renderer ? { tris: renderer.info.render.triangles, calls: renderer.info.render.calls } : null
      }
    },
    rideEnd: null,
    testPaint: (on) => {
      if (!player.mesh) return false
      const stack = [player.mesh]
      while (stack.length) {
        const o = stack.pop()
        if (o.isMesh && o.material) {
          const m = Array.isArray(o.material) ? o.material : [o.material]
          for (const mat of m) {
            if (on) {
              mat.emissive = new THREE.Color(0xff00ff)
              mat.emissiveIntensity = 1
              mat.map = null
              mat.color = new THREE.Color(0xff00ff)
            }
          }
        }
        if (o.children) for (const c of o.children) stack.push(c)
      }
      return true
    },
    get rigState() {
      const m = player.mesh
      const r = m && m.userData.rig
      if (!r) return null
      let parts = 0
      const stack = [m]
      while (stack.length) {
        const o = stack.pop()
        if (o.isMesh) parts++
        if (o.children) for (const c of o.children) stack.push(c)
      }
      return {
        phase: +r.phase.toFixed(3),
        legL: +r.legL.rotation.x.toFixed(3),
        legR: +r.legR.rotation.x.toFixed(3),
        armL: +r.armL.rotation.x.toFixed(3),
        armR: +r.armR.rotation.x.toFixed(3),
        torso: +r.torso.rotation.x.toFixed(3),
        bob: +m.position.y.toFixed(3),
        parts
      }
    },
    circle: (x, y, r) => circleHits(x, y, r),
    aimRot: (r) => { car.r = r },
    carPos: () => ({ x: car.x, y: car.y }),
    ready: true
  }

  updateHud()
  showMsg('WELCOME TO PROJECT VI', 2000)
  loop()
}

boot()