import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { unlockAudio, setEngine, playCrash, playBusted, playHorn } from './audio.js'

const TILE = 16
const WALK = 280
const SPRINT = 460
const TURN_RATE = 10
const MAX_SPEED = 280
const DRIVE = {
  REVERSE_MAX: 95,
  OFFROAD_FACTOR: 0.72,
  ACCEL: 430,
  ACCEL_CURVE: 1.25,
  BRAKE: 460,
  REVERSE_ACCEL: 150,
  COAST_ROAD: 0.4,
  COAST_OFFROAD: 2.4,
  STEER: 1.9,
  STEER_RESPONSE: 4.0,
  YAW_RESPONSE: 5.0,
  GRIP_LOW: 2.4,
  GRIP_HIGH: 5.2,
  MIN_STEER_SPEED: 10
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
const car = { inCar: false, speed: 0, r: 0, x: 0, y: 0, mesh: null, cur: null, _steer: 0, _yaw: 0, _sgn: 1, _vdx: 0, _vdy: -1, honk: false, _lastHonk: 0 }
const peds = []
const cops = []

const state = {
  frameNo: 0,
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
let camYaw = 0
let camPitch = 0.55
let camYawS = 0
let camPitchS = 0.55
let camLocked = false

function angLerp(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + d * Math.min(1, t)
}
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
    <div id="hud-hint" style="position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:12px;color:#d2f0d2;background:rgba(0,0,0,.35);padding:4px 10px;border-radius:6px;white-space:nowrap">click screen to lock mouse · WASD/arrows move · mouse look · E enter/exit · SPACE handbrake · H horn · SHIFT sprint · scroll zoom · T night</div>
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
  sirenB: new THREE.MeshLambertMaterial({ color: 0x3661ff, emissive: 0x3661ff, emissiveIntensity: 1.4 }),
  brake: new THREE.MeshLambertMaterial({ color: 0x2a0a06, emissive: 0xff241a, emissiveIntensity: 0.0 })
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
  const brakeM = M.brake.clone()
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
  box(9.0, 0.45, 0.3, brakeM, 0, 3.6, 13.55) // full-width brake light
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
    if (merged) {
      const m = new THREE.Mesh(merged, mat)
      if (mat === brakeM) g.userData.brake = m
      g.add(m)
    }
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
  const P = (w2, h2, d2, x, y, z) => new THREE.BoxGeometry(w2, h2, d2).translate(x, y, z)
  const S = (r, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const s = new THREE.SphereGeometry(r, 12, 8)
    s.scale(sx, sy, sz)
    s.translate(x, y, z)
    return s
  }
  const torso = {
    belt: P(2.9, 1.5, 1.9, 0, 0.35, 0),
    shirt: P(3.6, 3.2, 2.0, 0, 3.05, 0),
    shL: S(0.85, -1.95, 3.8, 0),
    shR: S(0.85, 1.95, 3.8, 0),
    neck: P(0.95, 1.1, 0.95, 0, 4.55, 0),
    head: S(1.9, 0, 5.35, 0),
    face: S(2.05, 0, 5.85, 0, 1.05, 0.55, 1.05),
    eyeL: S(0.18, -0.6, 5.75, -2.05),
    eyeR: S(0.18, 0.6, 5.75, -2.05),
    nose: P(0.34, 0.4, 0.42, 0, 5.32, -1.98),
    mouth: S(0.28, 0, 4.98, -2.12)
  }
  const legL = {
    thigh: P(1.6, 3.0, 1.7, 0, -1.55, 0),
    shin: P(1.35, 3.0, 1.4, 0, -4.55, 0),
    shoe: P(1.5, 1.7, 2.4, 0, -6.9, -0.45)
  }
  const armL = {
    upper: P(1.45, 2.1, 1.5, 0, -1.05, 0),
    fore: P(1.3, 1.8, 1.35, 0, -2.7, 0),
    hand: S(0.5, 0, -3.7, 0)
  }
  return (rigGeoCache = { torso, legL, armL })
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
  const tp = geo.torso
  torso.add(new THREE.Mesh(tp.belt, pantsM))
  torso.add(new THREE.Mesh(tp.shirt, shirtM))
  torso.add(new THREE.Mesh(tp.shL, skinM))
  torso.add(new THREE.Mesh(tp.shR, skinM))
  torso.add(new THREE.Mesh(tp.neck, skinM))
  torso.add(new THREE.Mesh(tp.head, hairM))
  torso.add(new THREE.Mesh(tp.face, skinM))
  torso.add(new THREE.Mesh(tp.eyeL, darkM))
  torso.add(new THREE.Mesh(tp.eyeR, darkM))
  torso.add(new THREE.Mesh(tp.nose, noseM))
  torso.add(new THREE.Mesh(tp.mouth, mouthM))
  g.add(torso)

  const legL = new THREE.Group()
  legL.position.set(-1.55, 7.6, 0)
  legL.add(new THREE.Mesh(geo.legL.thigh, pantsM))
  legL.add(new THREE.Mesh(geo.legL.shin, pantsM))
  legL.add(new THREE.Mesh(geo.legL.shoe, shoeM))
  g.add(legL)

  const legR = new THREE.Group()
  legR.position.set(1.55, 7.6, 0)
  legR.add(new THREE.Mesh(geo.legL.thigh, pantsM))
  legR.add(new THREE.Mesh(geo.legL.shin, pantsM))
  legR.add(new THREE.Mesh(geo.legL.shoe, shoeM))
  g.add(legR)

  const armL = new THREE.Group()
  armL.position.set(-2.05, 11.0, 0)
  armL.add(new THREE.Mesh(geo.armL.upper, shirtM))
  armL.add(new THREE.Mesh(geo.armL.fore, skinM))
  armL.add(new THREE.Mesh(geo.armL.hand, skinM))
  g.add(armL)

  const armR = new THREE.Group()
  armR.position.set(2.05, 11.0, 0)
  armR.add(new THREE.Mesh(geo.armL.upper, shirtM))
  armR.add(new THREE.Mesh(geo.armL.fore, skinM))
  armR.add(new THREE.Mesh(geo.armL.hand, skinM))
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
const GROUND_PX = 16
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

  // toroidal value-noise grids for smooth surfaces (cell divides W/H)
  const vnHash = (a, b, seed) => {
    let h = (a * 374761393 + b * 668265263 + seed * 2246822519) | 0
    h = (h ^ (h >>> 13)) | 0
    h = Math.imul(h, 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const vnGrids = [64, 16, 4].map((cell) => {
    const gw = Math.round(W / cell)
    const gh = Math.round(H / cell)
    const data = new Float32Array(gw * gh)
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) data[j * gw + i] = vnHash(i, j, cell)
    }
    return { cell, gw, gh, data }
  })
  const vsample = (g, x, y) => {
    const c = g.cell
    const gx0 = Math.floor(x / c)
    const gy0 = Math.floor(y / c)
    const fx = (x - gx0 * c) / c
    const fy = (y - gy0 * c) / c
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const gx1 = (gx0 + 1) % g.gw
    const gy1 = (gy0 + 1) % g.gh
    const i0 = gy0 % g.gh
    const A = g.data[i0 * g.gw + (gx0 % g.gw)]
    const B = g.data[i0 * g.gw + gx1]
    const C = g.data[gy1 * g.gw + (gx0 % g.gw)]
    const D = g.data[gy1 * g.gw + gx1]
    return A + (B - A) * sx + (C - A) * sy + (A - B - C + D) * sx * sy
  }
  const asphalt = (x, y, base) => {
    const n =
      (vsample(vnGrids[0], x, y) - 0.5) * 9 +
      (vsample(vnGrids[1], x, y) - 0.5) * 5 +
      (vsample(vnGrids[2], x, y) - 0.5) * 2.5
    return [
      Math.max(0, Math.min(255, base + n)),
      Math.max(0, Math.min(255, base + 3 + n)),
      Math.max(0, Math.min(255, base + 10 + n))
    ]
  }
  const fillRoad = (x0, y0) => {
    const base = gidAt(Math.floor(x0 / PX), Math.floor(y0 / PX)) === 4 ? 51 : 47
    for (let j = 0; j < PX; j += 2) {
      for (let i = 0; i < PX; i += 2) {
        const [r, g, bl] = asphalt(x0 + i, y0 + j)
        for (let dj = 0; dj < 2 && y0 + j + dj < H; dj++) {
          for (let di = 0; di < 2 && x0 + i + di < W; di++) {
            const p = ((y0 + j + dj) * W + x0 + i + di) * 4
            b[p] = r; b[p + 1] = g; b[p + 2] = bl; b[p + 3] = 255
          }
        }
      }
    }
  }
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const gid = groundGids[ty * mapW + tx]
      const x0 = tx * PX
      const y0 = ty * PX
      if (gid === 3 || gid === 4) {
        // smooth asphalt detail; lane markings are clean geometry (buildMarkings)
        fillRoad(x0, y0)
      } else if (gid === 2) {
        // ---- sidewalk ------------------------------------------------------
        speckle(x0, y0, 40, 8)
        lineV(x0 + (PX >> 1), y0, PX, [86, 87, 92])
        lineH(y0 + (PX >> 1), x0, PX, [86, 87, 92])
        set(x0 + (PX >> 1) + 1, y0 + (PX >> 1) + 1, 128, 129, 134)
        if (gidAt(tx - 1, ty) === 3 || gidAt(tx - 1, ty) === 4) lineV(x0, y0, PX, [38, 40, 46])
        if (gidAt(tx + 1, ty) === 3 || gidAt(tx + 1, ty) === 4) lineV(x0 + PX - 1, y0, PX, [38, 40, 46])
        if (gidAt(tx, ty - 1) === 3 || gidAt(tx, ty - 1) === 4) lineH(y0, x0, PX, [38, 40, 46])
        if (gidAt(tx, ty + 1) === 3 || gidAt(tx, ty + 1) === 4) lineH(y0 + PX - 1, x0, PX, [38, 40, 46])
      } else if (gid === 1) {
        speckle(x0, y0, 64, 14)
        for (let k = 0; k < 16; k++) {
          const sx = x0 + (Math.random() * PX) | 0
          const sy = y0 + (Math.random() * (PX - 2)) | 0
          dith((sy * W + sx) * 4, -22)
          dith(((sy + 1) * W + sx) * 4, -22)
        }
        for (let k = 0; k < 8; k++) {
          const sx = x0 + (Math.random() * PX) | 0
          const sy = y0 + (Math.random() * (PX - 2)) | 0
          dith((sy * W + sx) * 4, 18)
          dith(((sy + 1) * W + sx) * 4, 18)
        }
      } else if (gid === 9) {
        speckle(x0, y0, 48, 18)
        for (let k = 0; k < 12; k++) {
          const sx = x0 + (Math.random() * (PX - 3)) | 0
          const sy = y0 + (Math.random() * (PX - 2)) | 0
          for (let j = 0; j < 2; j++) {
            dith(((sy + j) * W + sx) * 4, 20)
            dith(((sy + j) * W + sx + 1) * 4, 20)
          }
        }
      } else if (gid === 10) {
        speckle(x0, y0, 40, 12)
        lineV(x0 + 2, y0, PX, [159, 163, 169])
        lineV(x0 + PX - 3, y0, PX, [159, 163, 169])
        clump(x0, y0, 4, 4, -18)
      } else if (gid === 11) {
        speckle(x0, y0, 64, 10)
        if (Math.random() < 0.5) {
          const sx = x0 + (Math.random() * (PX - 3)) | 0
          const sy = y0 + (Math.random() * (PX - 3)) | 0
          lineV(sx, sy, 4 + (Math.random() * 4) | 0, [140, 137, 128])
        }
      } else if (gid === 12) {
        speckle(x0, y0, 104, 20)
        clump(x0, y0, 6, 4, 18)
      }
    }
  }

  // ---- contact shading: darken ground at building bases and under trees ----
  const bIsB = (v) => v === 5 || v === 6 || v === 7 || v === 13
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const i = ty * mapW + tx
      const bld = bldGids[i]
      const x0 = tx * PX
      const y0 = ty * PX
      if (bld === 8) {
        const cc = PX / 2 - 0.5
        for (let j = 0; j < PX; j++) {
          for (let k = 0; k < PX; k++) {
            const dx = (k - cc) / cc
            const dy = (j - cc) / cc
            const ao = 30 * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy))
            if (ao > 2) dith(((y0 + j) * W + x0 + k) * 4, -ao)
          }
        }
        continue
      }
      if (bIsB(bld)) continue
      const ao = 42
      if (ty > 0 && bIsB(bldGids[(ty - 1) * mapW + tx])) for (let k = 0; k < PX; k++) dith(((y0) * W + x0 + k) * 4, -ao)
      if (ty < mapH - 1 && bIsB(bldGids[(ty + 1) * mapW + tx])) for (let k = 0; k < PX; k++) dith(((y0 + PX - 1) * W + x0 + k) * 4, -ao)
      if (tx > 0 && bIsB(bldGids[ty * mapW + tx - 1])) for (let j = 0; j < PX; j++) dith(((y0 + j) * W + x0) * 4, -ao)
      if (tx < mapW - 1 && bIsB(bldGids[ty * mapW + tx + 1])) for (let j = 0; j < PX; j++) dith(((y0 + j) * W + x0 + PX - 1) * 4, -ao)
    }
  }

  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy())
  const normalTex = makeAsphaltNormal(512)
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(mapW * TILE, mapH * TILE),
    new THREE.MeshLambertMaterial({ map: tex, normalMap: normalTex, normalScale: new THREE.Vector2(0.55, 0.55) })
  )
  plane.rotation.x = -Math.PI / 2
  plane.position.set((mapW * TILE) / 2, 0, (mapH * TILE) / 2)
  plane.receiveShadow = true
  scene.add(plane)
}

// subtle tileable normal map for asphalt surface roughness
function makeAsphaltNormal(size) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const d = img.data
  const hash = (a, b, seed) => {
    let h = (a * 374761393 + b * 668265263 + seed * 2246822519) | 0
    h = (h ^ (h >>> 13)) | 0
    h = Math.imul(h, 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const grids = [32, 8].map((cell) => {
    const n = size / cell
    const data = new Float32Array(n * n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) data[j * n + i] = hash(i, j, cell)
    }
    return { cell, n, data }
  })
  const hAt = (x, y) => {
    let v = 0
    for (const g of grids) {
      const c0 = g.cell
      const gx0 = ((Math.floor(x / c0) % g.n) + g.n) % g.n
      const gy0 = ((Math.floor(y / c0) % g.n) + g.n) % g.n
      const gx1 = (gx0 + 1) % g.n
      const gy1 = (gy0 + 1) % g.n
      const fx = (x - gx0 * c0) / c0
      const fy = (y - gy0 * c0) / c0
      const sx = fx * fx * (3 - 2 * fx)
      const sy = fy * fy * (3 - 2 * fy)
      const row = gy0 * g.n
      const A = g.data[row + gx0]
      const B = g.data[row + gx1]
      const C = g.data[gy1 * g.n + gx0]
      const D = g.data[gy1 * g.n + gx1]
      v += (A + (B - A) * sx + (C - A) * sy + (A - B - C + D) * sx * sy - 0.5) * (c0 === 32 ? 6 : 2.5)
    }
    return v
  }
  const STR = 0.07
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * STR
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * STR
      const l = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      d[i] = (dx / l) * 127 + 128
      d[i + 1] = (dy / l) * 127 + 128
      d[i + 2] = (1 / l) * 127 + 128
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(
    Math.max(1, Math.round((mapW * GROUND_PX) / size)),
    Math.max(1, Math.round((mapH * GROUND_PX) / size))
  )
  return tex
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

const BUILD_STYLE = {
  5: { base: 22, jit: 36, style: 'office', wall: [109, 112, 120], tiers: [13.2, 22, 30.8, 44, 57.2, 74.8] },
  6: { base: 13, jit: 22, style: 'brick', wall: [165, 83, 63], tiers: [8.8, 13.2, 17.6, 22, 26.4, 35.2] },
  7: { base: 30, jit: 42, style: 'shop', wall: [200, 178, 144], tiers: [13.2, 22, 30.8, 39.6, 52.8, 66] },
  13: { base: 44, jit: 46, style: 'tower', wall: [46, 125, 134], tiers: [30.8, 44, 57.2, 70.4, 85.8] }
}

const facadeCache = new Map()
function texFacade(gid, h) {
  const key = gid + ':' + h
  if (facadeCache.has(key)) return facadeCache.get(key)
  const W = 128
  const H = Math.max(48, Math.round(h * 8))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const wall = BUILD_STYLE[gid].wall
  const mix = (m) => `rgb(${Math.min(255, wall[0] * m) | 0},${Math.min(255, wall[1] * m) | 0},${Math.min(255, wall[2] * m) | 0})`
  const grad = g.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, mix(1.06))
  grad.addColorStop(0.8, mix(1))
  grad.addColorStop(1, mix(0.86))
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  if (BUILD_STYLE[gid].style === 'brick') {
    for (let y = 0; y < H; y += 8) {
      g.strokeStyle = 'rgba(60,26,18,0.55)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, y + 0.5)
      g.lineTo(W, y + 0.5)
      g.stroke()
      g.strokeStyle = 'rgba(120,64,44,0.5)'
      g.beginPath()
      g.moveTo(0, y + 3.5)
      g.lineTo(W, y + 3.5)
      g.stroke()
      g.fillStyle = 'rgba(60,26,18,0.5)'
      for (let x = ((y / 8) % 2 ? 4 : 0); x < W; x += 16) g.fillRect(x, y + 1, 1, 7)
    }
  }
  const floors = Math.max(1, Math.round(h / 4.4))
  const floorPx = H / floors
  const winH = floorPx * 0.62
  const cols = BUILD_STYLE[gid].style === 'tower' ? 6 : 5
  const cell = W / cols
  const winW = cell * 0.6
  const glassDark = BUILD_STYLE[gid].style === 'tower' ? [38, 70, 84] : [30, 42, 54]
  for (let f = 0; f < floors; f++) {
    const yTop = H - (f + 1) * floorPx
    const bandB = H - f * floorPx
    for (let xc = 0; xc < cols; xc++) {
      const x = xc * cell + cell * 0.08
      const v = ((gid * 31 + f * 97 + xc * 57) % 23) - 11
      g.fillStyle = mix(0.62)
      g.fillRect(x - 1.5, yTop - 1.5, winW + 3, winH + 3)
      const gl = g.createLinearGradient(0, yTop, 0, yTop + winH)
      const c1 = Math.min(255, Math.max(8, glassDark[0] + v * 2))
      const c2 = Math.min(255, Math.max(8, glassDark[1] + v * 2))
      const c3 = Math.min(255, Math.max(8, glassDark[2] + v * 2))
      gl.addColorStop(0, `rgb(${c1},${c2},${c3})`)
      gl.addColorStop(0.55, `rgb(${Math.min(255, c1 + 14)},${Math.min(255, c2 + 16)},${Math.min(255, c3 + 20)})`)
      gl.addColorStop(1, `rgb(${Math.max(0, c1 - 8)},${Math.max(0, c2 - 8)},${Math.max(0, c3 - 8)})`)
      g.fillStyle = gl
      g.fillRect(x, yTop, winW, winH)
      g.fillStyle = 'rgba(255,255,255,0.09)'
      g.fillRect(x + winW * 0.32, yTop, 1.5, winH)
    }
    if (f === 0 && BUILD_STYLE[gid].style !== 'office' && BUILD_STYLE[gid].style !== 'tower') {
      g.fillStyle = 'rgba(12,14,16,0.92)'
      g.fillRect(0, bandB - floorPx * 0.9, W, floorPx * 0.9)
      g.fillStyle = 'rgba(46,60,72,0.9)'
      g.fillRect(4, bandB - floorPx * 0.82, cell * 1.9, floorPx * 0.72)
      g.fillRect(W - cell * 1.9 - 4, bandB - floorPx * 0.82, cell * 1.9, floorPx * 0.72)
      g.fillStyle = mix(0.5)
      g.fillRect(cell * 1.9 + 4, bandB - floorPx * 0.82, cell * 0.32, floorPx * 0.72)
      g.fillStyle = 'rgba(160,120,84,0.75)'
      g.fillRect(0, bandB - floorPx * 1.0, W, floorPx * 0.1)
      g.fillStyle = 'rgba(0,0,0,0.25)'
      for (let sx = 0; sx < W; sx += 14) g.fillRect(sx, bandB - floorPx * 0.98, 5, floorPx * 0.07)
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'
    g.fillRect(0, bandB - 2.5, W, 2.5)
  }
  if (BUILD_STYLE[gid].style !== 'tower') {
    g.fillStyle = mix(0.78)
    g.fillRect(0, 0, W, 7)
    g.fillStyle = 'rgba(0,0,0,0.25)'
    g.fillRect(0, 6, W, 1.5)
  } else {
    g.fillStyle = 'rgba(20,30,36,0.55)'
    g.fillRect(0, 0, W, 4)
  }
  g.fillStyle = 'rgba(0,0,0,0.45)'
  g.fillRect(0, H - 2, W, 2)
  g.fillStyle = 'rgba(0,0,0,0.22)'
  g.fillRect(0, H - 5, W, 3)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
  facadeCache.set(key, tex)
  return tex
}

// crisp lane markings as clean geometry (edge lines, center dashes, crosswalks),
// drawn just above the ground so they stay sharp at any camera distance
function buildMarkings() {
  const gidAt = (gx, gy) =>
    gx < 0 || gy < 0 || gx >= mapW || gy >= mapH ? 0 : groundGids[gy * mapW + gx]
  const isRoad = (g) => g === 3 || g === 4
  const mat = new THREE.MeshLambertMaterial({
    color: 0xf2f3f7,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  })

  const edges = []
  const items = []
  const q = new THREE.Quaternion()

  // ---- edge lines: one full-length run along each side of every road strip --
  for (let cx = 0; cx < mapW; cx += 8) {
    for (const side of [-1, 1]) {
      let run = null
      const ex = cx * TILE + (side < 0 ? 2 : TILE - 2)
      for (let y = 0; y <= mapH; y++) {
        const ok = y < mapH && isRoad(gidAt(cx, y))
        if (ok && run === null) run = y
        else if (!ok && run !== null) {
          const z0 = run * TILE
          const z1 = y * TILE
          if (z1 - z0 > 2) edges.push({ x: ex, z: (z0 + z1) / 2, sx: 1.0, sz: z1 - z0 })
          run = null
        }
      }
    }
  }
  for (let cy = 0; cy < mapH; cy += 8) {
    for (const side of [-1, 1]) {
      let run = null
      const ey = cy * TILE + (side < 0 ? 2 : TILE - 2)
      for (let x = 0; x <= mapW; x++) {
        const ok = x < mapW && isRoad(gidAt(x, cy))
        if (ok && run === null) run = x
        else if (!ok && run !== null) {
          const x0 = run * TILE
          const x1 = x * TILE
          if (x1 - x0 > 2) edges.push({ x: (x0 + x1) / 2, z: ey, sx: x1 - x0, sz: 1.0 })
          run = null
        }
      }
    }
  }

  // 2. dashed center line (world-aligned 14/28 pattern, skips intersections)
  // 3. crosswalk zebra stripes (3-on / 5-off pattern per tile)
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const gid = gidAt(tx, ty)
      if (!isRoad(gid)) continue
      const x0 = tx * TILE
      const y0 = ty * TILE
      if (gid === 4) {
        for (let j = 0; j < TILE; j++) {
          if (j % 5 < 3) items.push({ x: x0 + TILE / 2, z: y0 + j + 0.5, sx: TILE - 3, sz: 1.0 })
        }
        continue
      }
      if (tx % 8 === 0 && ty % 8 !== 0) {
        for (let y = y0; y < y0 + TILE; ) {
          const p = y % 28
          if (p >= 14) { y += 28 - p; continue }
          const len = Math.min(14 - p, y0 + TILE - y)
          items.push({ x: x0 + TILE / 2, z: y + len / 2, sx: 1.0, sz: len })
          y += len
        }
      } else if (tx % 8 !== 0 && ty % 8 === 0) {
        for (let x = x0; x < x0 + TILE; ) {
          const p = x % 28
          if (p >= 14) { x += 28 - p; continue }
          const len = Math.min(14 - p, x0 + TILE - x)
          items.push({ x: x + len / 2, z: y0 + TILE / 2, sx: len, sz: 1.0 })
          x += len
        }
      }
    }
  }

  if (edges.length) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, edges.length)
    const m = new THREE.Matrix4()
    for (let i = 0; i < edges.length; i++) {
      m.compose(
        new THREE.Vector3(edges[i].x, 0.03, edges[i].z),
        q,
        new THREE.Vector3(edges[i].sx, 0.02, edges[i].sz)
      )
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
  }
  if (items.length) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, items.length)
    const m = new THREE.Matrix4()
    for (let i = 0; i < items.length; i++) {
      m.compose(
        new THREE.Vector3(items[i].x, 0.03, items[i].z),
        q,
        new THREE.Vector3(items[i].sx, 0.02, items[i].sz)
      )
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
  }
}

function buildBuildings() {
  const cenX = (mapW * TILE) / 2
  const cenY = (mapH * TILE) / 2
  const buckets = new Map()
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const b = bldGids[y * mapW + x]
      const st = BUILD_STYLE[b]
      if (!st) continue
      const px = x * TILE + 8
      const py = y * TILE + 8
      const d = Math.hypot(px - cenX, py - cenY)
      const boost = d < 700 ? 24 * (1 - d / 700) : 0
      const h = Math.min(92, Math.max(6, st.base + hue(x, y, 0.2) * st.jit + boost))
      let ht = st.tiers[0]
      let best = Infinity
      for (const t of st.tiers) {
        const df = Math.abs(t - h)
        if (df < best) { best = df; ht = t }
      }
      const key = b + ':' + ht
      let arr = buckets.get(key)
      if (!arr) buckets.set(key, (arr = []))
      arr.push({ x: px, z: py })
    }
  }
  const mat = new THREE.Matrix4()
  const tcol = new THREE.Color()
  const pos = new THREE.Vector3()
  const zero = new THREE.Quaternion()
  const sc = new THREE.Vector3()
  for (const [key, list] of buckets) {
    const [b, ht] = key.split(':').map(Number)
    const st = BUILD_STYLE[b]
    const wall = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, ht, TILE),
      new THREE.MeshStandardMaterial({ map: texFacade(b, ht), roughness: 0.9, metalness: 0.06 }),
      list.length
    )
    wall.castShadow = true
    wall.receiveShadow = true
    const crown = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, st.style === 'tower' ? 1.2 : 1.8, TILE),
      new THREE.MeshLambertMaterial(),
      list.length
    )
    crown.castShadow = true
    crown.receiveShadow = true
    const cap = st.style === 'shop'
      ? new THREE.InstancedMesh(new THREE.ConeGeometry(11.3, 3.4, 4), new THREE.MeshLambertMaterial(), list.length)
      : new THREE.InstancedMesh(new THREE.BoxGeometry(TILE + 2.2, 0.8, TILE + 2.2), new THREE.MeshLambertMaterial(), list.length)
    cap.castShadow = true
    if (st.style === 'shop') cap.rotation.y = Math.PI / 4
    list.forEach((it, i) => {
      const v = hue(it.x, it.z, 0.5)
      mat.makeTranslation(it.x, ht / 2, it.z)
      wall.setMatrixAt(i, mat)
      wall.setColorAt(i, tcol.setRGB(st.wall[0] / 255, st.wall[1] / 255, st.wall[2] / 255).multiplyScalar(0.94 + v * 0.12))
      mat.makeTranslation(it.x, ht + (st.style === 'tower' ? 0.6 : 0.9), it.z)
      crown.setMatrixAt(i, mat)
      crown.setColorAt(i, tcol.setRGB(st.wall[0] / 255, st.wall[1] / 255, st.wall[2] / 255).multiplyScalar(0.72 + v * 0.1))
      const cy = st.style === 'shop' ? ht + 1.7 : ht + (st.style === 'tower' ? 1.2 : 2.2)
      mat.makeTranslation(it.x, cy, it.z)
      cap.setMatrixAt(i, mat)
      cap.setColorAt(i, tcol.setRGB(st.wall[0] / 255, st.wall[1] / 255, st.wall[2] / 255).multiplyScalar(0.5 + v * 0.12))
    })
    wall.instanceMatrix.needsUpdate = true
    wall.instanceColor.needsUpdate = true
    crown.instanceMatrix.needsUpdate = true
    crown.instanceColor.needsUpdate = true
    cap.instanceMatrix.needsUpdate = true
    cap.instanceColor.needsUpdate = true
    scene.add(wall, crown, cap)
  }
}

let barkRes = null
function texBark() {
  if (barkRes) return barkRes
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const g = c.getContext('2d')
  const base = g.createLinearGradient(0, 0, 0, 256)
  base.addColorStop(0, '#7a5230')
  base.addColorStop(0.55, '#5d3c1e')
  base.addColorStop(1, '#43290f')
  g.fillStyle = base
  g.fillRect(0, 0, 128, 256)
  const ridge = () => Math.random() * 3 - 1.5
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 128
    const y0 = Math.random() * 256
    const len = 40 + Math.random() * 160
    g.strokeStyle = Math.random() < 0.5
      ? `rgba(148,105,64,${(0.3 + Math.random() * 0.4).toFixed(2)})`
      : `rgba(24,13,5,${(0.35 + Math.random() * 0.35).toFixed(2)})`
    g.lineWidth = 1 + Math.random() * 3
    g.beginPath()
    g.moveTo(x, y0)
    g.bezierCurveTo(x + ridge() * 10, y0 + len * 0.35, x + ridge() * 14, y0 + len * 0.7, x + ridge() * 16, y0 + len)
    g.stroke()
  }
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 256
    const x0 = Math.random() * 60
    g.strokeStyle = `rgba(20,11,4,${(0.25 + Math.random() * 0.25).toFixed(2)})`
    g.lineWidth = 0.6 + Math.random() * 1.2
    g.beginPath()
    g.moveTo(x0, y)
    g.lineTo(x0 + 14 + Math.random() * 40, y + (Math.random() * 5 - 2.5))
    g.stroke()
  }
  for (let i = 0; i < 7; i++) {
    const kx = Math.random() * 128
    const ky = Math.random() * 256
    g.fillStyle = `rgba(26,15,6,${(0.45 + Math.random() * 0.3).toFixed(2)})`
    g.beginPath()
    g.ellipse(kx, ky, 2 + Math.random() * 2.4, 3 + Math.random() * 3.4, Math.random() * 1.6, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(150,110,70,0.45)'
    g.lineWidth = 0.8
    g.beginPath()
    g.arc(kx, ky, 3 + Math.random() * 3, 0, Math.PI * 2)
    g.stroke()
  }
  const map = new THREE.CanvasTexture(c)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.colorSpace = THREE.SRGBColorSpace
  const bc = document.createElement('canvas')
  bc.width = 128
  bc.height = 256
  const bg = bc.getContext('2d')
  bg.drawImage(c, 0, 0)
  const id = bg.getImageData(0, 0, 128, 256)
  const d = id.data
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = d[i + 1] = d[i + 2] = l
    d[i + 3] = 255
  }
  bg.putImageData(id, 0, 0)
  const bump = new THREE.CanvasTexture(bc)
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping
  barkRes = { map, bump }
  return barkRes
}

let leafTex = null
function texLeaves() {
  if (leafTex) return leafTex
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')
  const tuft = (x, y, r, col) => {
    g.fillStyle = col
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(x + r * 0.55, y + r * 0.2, r * 0.6, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(x - r * 0.5, y + r * 0.35, r * 0.5, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(x + r * 0.15, y - r * 0.55, r * 0.55, 0, Math.PI * 2); g.fill()
  }
  const greens = ['#173d1d', '#1f5426', '#2a6b2f', '#3d7f33', '#4f9139', '#275d24']
  for (let i = 0; i < 90; i++) tuft(8 + Math.random() * 112, 8 + Math.random() * 112, 5 + Math.random() * 9, greens[i % 6])
  for (let i = 0; i < 130; i++) tuft(4 + Math.random() * 120, 4 + Math.random() * 120, 3 + Math.random() * 6, greens[(i + 2) % 6])
  for (let i = 0; i < 60; i++) tuft(Math.random() * 128, Math.random() * 128, 1.6 + Math.random() * 2.4, 'rgba(122,168,64,0.9)')
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * 128
    const y = Math.random() * 128
    const r = 2 + Math.random() * 5
    g.clearRect(x - r, y - r, r * 2, r * 2)
  }
  leafTex = new THREE.CanvasTexture(c)
  leafTex.colorSpace = THREE.SRGBColorSpace
  return leafTex
}

function treeTrunkGeo() {
  const SEG = 16
  const ROWS = 7
  const H = 8.6
  const topR = 0.55
  const midR = 1.3
  const baseR = 2.1
  const verts = []
  const uvs = []
  const idx = []
  const rAt = (v, a) => {
    const t = Math.min(1, v / 0.25)
    const prof = t < 1
      ? baseR - (baseR - midR) * t
      : midR - (midR - topR) * ((v - 0.25) / 0.75)
    const wob = 0.88 + 0.24 * Math.sin(a * 2.3 + v * 4.1) + 0.1 * Math.sin(a * 5.7 + v * 9.3)
    const toes = v < 0.3 ? 1 + 0.5 * Math.max(0, Math.sin(a * 3 + v * 24)) : 1
    return prof * wob * toes * 0.92
  }
  const mX = (v) => 0.34 * v * v + 0.1 * Math.sin(v * 6.3)
  const mZ = (v) => 0.16 * v * v * Math.sin(v * 3.7) + 0.06 * Math.sin(v * 11)
  for (let j = 0; j <= ROWS; j++) {
    const v = j / ROWS
    const y = v * H
    const cx = mX(v)
    const cz = mZ(v)
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2
      const r = rAt(v, a)
      verts.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)
      uvs.push(i / SEG, v)
    }
  }
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i
      idx.push(a, a + 1, a + SEG + 1, a, a + SEG + 1, a + SEG + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function buildTrees() {
  const list = []
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (bldGids[y * mapW + x] === 8) list.push({ x: x * TILE + 8, z: y * TILE + 8 })
    }
  }
  if (!list.length) return
  const bark = texBark()
  const leaf = texLeaves()
  const n = list.length
  const trunkMat = new THREE.MeshLambertMaterial({ map: bark.map, bumpMap: bark.bump, bumpScale: 0.55 })
  const leafMat = new THREE.MeshLambertMaterial({ map: leaf, alphaTest: 0.45, transparent: true })
  const trunk = new THREE.InstancedMesh(treeTrunkGeo(), trunkMat, n)
  const blob = []
  for (let bi = 0; bi < 2; bi++) {
    blob.push(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshLambertMaterial({ map: bark.map, bumpMap: bark.bump, bumpScale: 0.4 }), n))
  }
  const branch = []
  for (let bi = 0; bi < 4; bi++) {
    branch.push(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.36, 2.8, 6, 1), trunkMat, n))
  }
  const lobeDefs = [
    { r: 5.0, dark: 0.24, sat: 0.52, hue: 0.28 },
    { r: 3.3, dark: 0.4, sat: 0.55, hue: 0.24 },
    { r: 2.9, dark: 0.3, sat: 0.5, hue: 0.31 },
    { r: 2.3, dark: 0.19, sat: 0.5, hue: 0.34 }
  ]
  const lobe = lobeDefs.map((d) => new THREE.InstancedMesh(new THREE.IcosahedronGeometry(d.r, 1), leafMat, n))
  for (const m of [trunk, ...blob, ...branch, ...lobe]) {
    m.castShadow = true
    m.receiveShadow = true
  }
  const mat = new THREE.Matrix4()
  const col = new THREE.Color()
  const pos = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const eul = new THREE.Euler()
  const dir = new THREE.Vector3()
  const YAXIS = new THREE.Vector3(0, 1, 0)
  list.forEach((it, i) => {
    const v = hue(it.x, it.z, 0.1)
    const h = 0.7 + v * 0.55
    const r = 0.85 + hue(it.x, it.z, 0.37) * 0.4
    const cs = 0.75 + hue(it.x, it.z, 0.71) * 0.55
    const sq = 0.84 + hue(it.x, it.z, 0.53) * 0.3
    const yaw = hue(it.x, it.z, 0.61) * Math.PI * 2
    const lean = (hue(it.x, it.z, 0.83) - 0.5) * 0.12
    const tH = h * 4.3
    const tTop = h * 8.6
    eul.set(lean, yaw, 0)
    quat.setFromEuler(eul)
    pos.set(it.x, tH, it.z)
    sc.set(r, h, r)
    mat.compose(pos, quat, sc)
    trunk.setMatrixAt(i, mat)
    trunk.setColorAt(i, col.setHSL(0.08, 0.3, 0.3 + v * 0.1))
    for (let bi = 0; bi < 2; bi++) {
      const on = hue(it.x, it.z, 0.19 + bi * 0.13)
      if (on < 0.4) {
        mat.makeScale(0.0001, 0.0001, 0.0001)
        blob[bi].setMatrixAt(i, mat)
      } else {
        const ba = yaw + bi * 2.2 + on * 1.6
        pos.set(it.x + Math.cos(ba) * r * (1.5 + on * 0.9), 0.5 + on * 0.45, it.z + Math.sin(ba) * r * (1.5 + on * 0.9))
        sc.set(r * (1 + on * 0.6), 0.5 + on * 0.3, r * (0.8 + on * 0.4))
        mat.compose(pos, quat, sc)
        blob[bi].setMatrixAt(i, mat)
        blob[bi].setColorAt(i, col.setHSL(0.08, 0.3, 0.24 + v * 0.08))
      }
    }
    const nb = hue(it.x, it.z, 0.67)
    for (let bi = 0; bi < 4; bi++) {
      const on = nb - bi * 0.19
      if (on < 0.12) {
        mat.makeScale(0.0001, 0.0001, 0.0001)
        branch[bi].setMatrixAt(i, mat)
        continue
      }
      const ba = yaw + bi * 1.9 + hue(it.x, it.z, 0.21 + bi * 0.11) * 2.2
      const tilt = 0.5 + hue(it.x, it.z, 0.29 + bi * 0.13) * 0.55
      const blen = 0.7 + on * 0.85
      const bthk = 0.6 + hue(it.x, it.z, 0.43 + bi * 0.09) * 0.55
      const by = tTop - h * (1.2 + hue(it.x, it.z, 0.31 + bi * 0.17) * 1.6)
      pos.set(it.x + Math.cos(ba) * r * 0.7, by, it.z + Math.sin(ba) * r * 0.7)
      dir.set(Math.sin(tilt) * Math.cos(ba), Math.cos(tilt), Math.sin(tilt) * Math.sin(ba))
      quat.setFromUnitVectors(YAXIS, dir)
      sc.set(bthk * 0.8, blen, bthk * 0.8)
      mat.compose(pos, quat, sc)
      branch[bi].setMatrixAt(i, mat)
      branch[bi].setColorAt(i, col.setHSL(0.08, 0.28, 0.26 + v * 0.09))
    }
    const cy = tH + h * 2.2 + 2.6 * cs * sq
    for (let k = 0; k < 4; k++) {
      const ph = hue(it.x, it.z, 0.71 + k * 0.09)
      const d = lobeDefs[k]
      const aOff = yaw + (k === 0 ? 0 : [1.2, 3.6, 4.9][k - 1]) + (ph - 0.5) * 1.4
      const radOff = [0, 0.9, 2.2, 2.7][k] * cs
      const yOff = [0, 1.9, -0.5, -1.5][k] * cs + (ph - 0.5) * 1.6
      pos.set(it.x + Math.cos(aOff) * radOff, cy + yOff, it.z + Math.sin(aOff) * radOff)
      const ks = [1, 0.66, 0.58, 0.5][k]
      const ks2 = 0.94 + ph * 0.12
      sc.set(cs * ks * ks2, cs * ks * sq * ks2, cs * ks * ks2)
      eul.set(0, aOff * 1.3, lean * 1.4)
      quat.setFromEuler(eul)
      mat.compose(pos, quat, sc)
      lobe[k].setMatrixAt(i, mat)
      const lj = (hue(it.x, it.z, 0.4 + k * 0.13) - 0.5) * 0.1
      lobe[k].setColorAt(i, col.setHSL(d.hue + lj, d.sat, Math.max(0.14, d.dark + lj * 1.5)))
    }
  })
  for (const m of [trunk, ...blob, ...branch, ...lobe]) {
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    scene.add(m)
  }
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
  // heading unit vector (x, z). Mesh models face local -z, so at rotation.y = r the
  // nose points (-sin r, -cos r) — travel must always equal the nose direction.
  return { fx: -Math.sin(r), fy: -Math.cos(r) }
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
  car._steer = 0
  car._yaw = 0
  car._sgn = 1
  const { fx, fy } = shifted(car.r)
  car._vdx = fx
  car._vdy = fy
  if (document.pointerLockElement) {
    try { document.exitPointerLock() } catch { /* ignore */ }
  }
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
  camYaw = -car.r
  camYawS = camYaw
  try {
    const p = renderer.domElement.requestPointerLock()
    if (p && typeof p.catch === 'function') p.catch(() => { /* relock may be refused */ })
  } catch { /* relock may be refused; user can click */ }
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
  let ax = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)
  let ay = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0)
  const sp = keys.has('shift') ? SPRINT : WALK
  const fx = -Math.sin(camYawS)
  const fy = -Math.cos(camYawS)
  let dx = -ay * fx - ax * fy
  let dy = -ay * fy + ax * fx
  const len = Math.hypot(dx, dy)
  player.moving = len > 0
  if (len > 0) {
    dx /= len
    dy /= len
    player.r = angLerp(player.r, Math.atan2(dx, -dy), Math.min(1, TURN_RATE * dt))
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
  const handbrake = keys.has(' ')
  const steerIn = (keys.has('arrowleft') || keys.has('a') ? 1 : 0) - (keys.has('arrowright') || keys.has('d') ? 1 : 0)
  const D = DRIVE

  const gid = groundAt(car.x, car.y)
  const onRoad = gid === 3 || gid === 4 || gid === 10
  const maxSpeed = MAX_SPEED * (onRoad ? 1 : D.OFFROAD_FACTOR)

  // ---- longitudinal: power tapers to top speed (~1.5s 0→cruise), braking eases off smoothly ----
  let v = car.speed
  const sp0 = Math.abs(v)
  const brakeScale = 0.25 + 0.75 * Math.min(1, sp0 / maxSpeed)
  if (handbrake) {
    // handbrake: strong scrubbing decel regardless of throttle, ~2.5x harder than foot brake
    v = Math.sign(v) * Math.max(0, sp0 - D.BRAKE * 2.2 * brakeScale * dt)
  } else if (throttle && !back) {
    if (v < -0.5) v = Math.min(0, v + D.BRAKE * brakeScale * dt)
    else v += D.ACCEL * Math.pow(Math.max(0, 1 - v / maxSpeed), D.ACCEL_CURVE) * dt
  } else if (back && !throttle) {
    if (v > 0.5) v = Math.max(0, v - D.BRAKE * brakeScale * dt)
    else v -= D.REVERSE_ACCEL * Math.pow(Math.max(0, 1 + v / D.REVERSE_MAX), D.ACCEL_CURVE) * dt
  } else if (throttle && back) {
    v = Math.max(0, v - D.BRAKE * brakeScale * dt)
  } else {
    v *= Math.exp(-(onRoad ? D.COAST_ROAD : D.COAST_OFFROAD) * dt)
    if (Math.abs(v) < 1.2) v = 0
  }
  v = Math.max(-D.REVERSE_MAX, Math.min(maxSpeed, v))
  car.speed = v

  // ---- brake lights: foot brake, reversing out of forward motion, or handbrake ----
  const brakeLights = (throttle && back) || (back && sp0 > 0.5) || (handbrake && sp0 > 2)
  const bmesh = car.cur && car.cur.mesh.userData ? car.cur.mesh.userData.brake : null
  if (bmesh) {
    const bm = bmesh.material
    const target = brakeLights ? 1.9 : 0.0
    if (bm.emissiveIntensity !== target) {
      bm.emissiveIntensity = target
      bm.color.setHex(brakeLights ? 0xff241a : 0x2a0a06)
    }
  }

  // ---- steering: sharper at low speed, wide arcs at high speed, angular velocity eased ----
  const d = Math.min(1, D.STEER_RESPONSE * dt)
  car._steer += (steerIn - car._steer) * d
  const sp = Math.abs(v)
  const frac = Math.min(1, sp / maxSpeed)
  const authority = Math.max(0.45, 1 - 0.5 * frac)
  const targetYaw = sp > D.MIN_STEER_SPEED ? car._steer * D.STEER * authority * (v > 0 ? 1 : -1) : 0
  car._yaw += (targetYaw - car._yaw) * Math.min(1, D.YAW_RESPONSE * dt)
  car.r += car._yaw * dt

  // ---- momentum: actual motion direction lags the heading at speed (subtle drift) ----
  const { fx, fy } = shifted(car.r)
  const sgn = v >= 0 ? 1 : -1
  const sdx = fx * sgn
  const sdy = fy * sgn
  if (car._sgn !== sgn) {
    car._sgn = sgn
    car._vdx = sdx
    car._vdy = sdy
    car._yaw = 0
  }
  const grip = (D.GRIP_LOW + (D.GRIP_HIGH - D.GRIP_LOW) * frac) * (handbrake && sp > 30 ? 0.5 : 1) // handbrake = grip loss, rear slides out
  car._vdx += (sdx - car._vdx) * Math.min(1, grip * dt)
  car._vdy += (sdy - car._vdy) * Math.min(1, grip * dt)
  const vlen = Math.hypot(car._vdx, car._vdy) || 1
  const mvx = (car._vdx / vlen) * sp
  const mvy = (car._vdy / vlen) * sp

  const oldX = car.x
  const oldY = car.y
  moveCircle(car, 9, mvx * dt, mvy * dt)
  const moved = dist2(oldX, oldY, car.x, car.y)
  if (sp > 110 && moved < sp * dt * 0.3 && crashCooldown <= 0) {
    crashCooldown = 0.5
    playCrash(Math.min(1, sp / 220))
    damage(8)
    car.speed *= 0.82 // absorb impact — no springy bounce-back
  }
  if (crashCooldown > 0) crashCooldown -= dt
  if (car.cur) {
    car.cur.mesh.position.set(car.x, 0, car.y)
    car.cur.mesh.rotation.y = car.r
    const roll = Math.max(-1, Math.min(1, car._yaw / (D.STEER * 0.75)))
    car.cur.mesh.rotation.z = -roll * 0.05 * Math.min(1, sp / 150) // body roll while cornering
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
    const wantR = Math.atan2(-(tx - cop.x), -(ty - cop.y))
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
  state.frameNo++
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
    if (car.honk) {
      const now = performance.now()
      if (now - car._lastHonk > 900) {
        playHorn()
        car._lastHonk = now
      }
    }
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
  const d = state.cameraDist
  if (car.inCar) {
    camYaw = -car.r
    camYawS = camYaw
    camPitchS = 0.62
    const { fx, fy } = shifted(car.r)
    camTarget.set(ref.x - fx * d, 0, ref.y - fy * d)
    camTarget.y = d * 0.62
  } else {
    camYawS = angLerp(camYawS, camYaw, dt * 14)
    camPitchS += (camPitch - camPitchS) * Math.min(1, dt * 14)
    camTarget.set(
      ref.x + Math.sin(camYawS) * Math.cos(camPitchS) * d,
      0,
      ref.y + Math.cos(camYawS) * Math.cos(camPitchS) * d
    )
    camTarget.y = d * Math.sin(camPitchS)
  }
  camera.position.lerp(camTarget, 0.09)
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
  if (k === 'h' && car.inCar) {
    car.honk = true
    car._lastHonk = 0
    playHorn()
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
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase()
  if (k === 'h') car.honk = false
  keys.delete(k)
})

window.addEventListener('mousemove', (e) => {
  if (!camLocked || car.inCar) return
  camYaw -= e.movementX * 0.0026
  camPitch = Math.max(0.05, Math.min(1.05, camPitch + e.movementY * 0.0026))
})
document.addEventListener('pointerlockchange', () => {
  camLocked = document.pointerLockElement === renderer.domElement
})

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function boot() {
  scene = new THREE.Scene()
  window.__scene = scene
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
  renderer.domElement.addEventListener('click', () => {
    if (!car.inCar && document.pointerLockElement !== renderer.domElement) {
      try {
        const p = renderer.domElement.requestPointerLock()
        if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ })
      } catch { /* ignore */ }
    }
  })

  buildGround()
  buildCurbs()
  buildMarkings()
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
    get playerPos() { return { x: +player.x.toFixed(1), y: +player.y.toFixed(1) } },
    get carR() { return +car.r.toFixed(4) },
    get playerRot() { return player.mesh ? +player.mesh.rotation.y.toFixed(3) : null },
    get camYaw() { return +camYaw.toFixed(3) },
    setCam: (yaw, pitch) => {
      camYaw = yaw
      camYawS = yaw
      if (pitch != null) { camPitch = pitch; camPitchS = pitch }
    },
    get inCar() { return car.inCar },
    get speed() { return Math.round(car.speed) },
    get money() { return state.money },
    get wanted() { return state.wanted },
    get health() { return Math.round(state.health) },
    get missionActive() { return state.missionActive },
    get missionTarget() { return state.missionTarget },
    get brakeLight() {
      const bm = car.cur && car.cur.mesh.userData ? car.cur.mesh.userData.brake : null
      return bm ? +bm.material.emissiveIntensity.toFixed(2) : null
    },
    get honking() { return car.honk },
    get hudCash() { return el('hud-cash').textContent },
    get keysNow() { return [...keys].join(',') },
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
      const out = { player: [], ped: [] }
      const scan = (root) => {
        const stack = [root]
        const list = []
        while (stack.length) {
          const o = stack.pop()
          if (o.isMesh) {
            const g = o.geometry
            if (g && !g.boundingSphere) g.computeBoundingSphere()
            const bs = g ? g.boundingSphere || null : null
            let nan = false
            if (g.attributes.position) {
              const a = g.attributes.position.array
              for (let i = 0; i < Math.min(a.length, 300); i++) { if (a[i] !== a[i]) { nan = true; break } }
            }
            list.push({
              tris: g.index ? g.index.count / 3 : g.attributes.position.count / 3,
              bs: bs ? [bs.center.x, bs.center.y, bs.center.z, bs.radius].map((v) => +v.toFixed(2)) : null,
              nan,
              frustumCulled: o.frustumCulled
            })
          }
          if (o.children) for (const c of o.children) stack.push(c)
        }
        return list
      }
      out.player = scan(player.mesh)
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const bb = new THREE.Box3().setFromObject(player.mesh)
      out.frustumHasPlayer = fr.intersectsBox(bb)
      out.camera = { x: +camera.position.x.toFixed(0), y: +camera.position.y.toFixed(0), z: +camera.position.z.toFixed(0) }
      out.playerWorld = { x: +player.mesh.position.x.toFixed(0), y: +player.mesh.position.y.toFixed(0), z: +player.mesh.position.z.toFixed(0) }
      out.rendererCalls = renderer.info.render.calls
      out.rendererTris = renderer.info.render.triangles
      out.frameNo = state.frameNo
      out.night = state.isNight
      out.rendererState = {
        clear: renderer.getClearColor(new THREE.Color()).getHexString(),
        bg: scene.background ? '#' + scene.background.getHexString() : null,
        fog: scene.fog ? '#' + scene.fog.color.getHexString() : null,
        fogNear: scene.fog ? scene.fog.near : null,
        fogFar: scene.fog ? scene.fog.far : null,
        toneMapping: renderer.toneMapping,
        hemi: hemi.intensity,
        dir: dirLight.intensity,
        dirShadow: dirLight.castShadow
      }
      const v = new THREE.Vector3(0, 8, 0)
      player.mesh.localToWorld(v)
      v.project(camera)
      out.playerNdc = [v.x, v.y, v.z].map((n) => +n.toFixed(3))
      return out
    },
    rideEnd: null,
    testPaint: (on) => {
      if (!player.mesh) return false
      const stack = [player.mesh]
      while (stack.length) {
        const o = stack.pop()
        if (o.isMesh && o.material) {
          const n = Array.isArray(o.material) ? o.material.length : 1
          if (on) {
            o.material = Array.from({ length: n }, () => new THREE.MeshBasicMaterial({ color: 0x00ff00 }))
          } else {
            o.material = Array.from({ length: n }, () => new THREE.MeshLambertMaterial({ color: 0x00ff00 }))
          }
        }
        if (o.children) for (const c of o.children) stack.push(c)
      }
      return true
    },
    testFlat: (mode) => {
      const m = player.mesh
      if (!m) return false
      const stack = [m]
      while (stack.length) {
        const o = stack.pop()
        if (o.isMesh) {
          const old = o.userData._origMat
          if (mode === 'flat' && !old) {
            o.userData._origMat = o.material
            o.material = new THREE.MeshLambertMaterial({ color: 0xffffff })
          } else if (mode === 'flatMap' && !old) {
            o.userData._origMat = o.material
            o.material = new THREE.MeshLambertMaterial({ map: texSkin() })
          } else if (mode === 'orig' && old) {
            o.material = old
            o.userData._origMat = null
          }
        }
        if (o.children) for (const c of o.children) stack.push(c)
      }
      return true
    },
    testBox: (on) => {
      if (on && !window.__boxProbe) {
        window.__boxProbe = new THREE.Mesh(
          new THREE.BoxGeometry(6, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xff0000 })
        )
        window.__boxProbe.matrixAutoUpdate = false
        window.__boxProbe.position.set(player.mesh.position.x, 10, player.mesh.position.z)
        window.__boxProbe.updateMatrix()
        scene.add(window.__boxProbe)
      } else if (!on && window.__boxProbe) {
        scene.remove(window.__boxProbe)
        window.__boxProbe = null
      }
      return !!on
    },
    setOnlyPed: (on) => {
      const keep = new Set()
      if (player.mesh) {
        keep.add(player.mesh)
        const st = [player.mesh]
        while (st.length) {
          const o = st.pop()
          keep.add(o)
          if (o.children) for (const c of o.children) st.push(c)
        }
      }
      const st2 = [scene]
      while (st2.length) {
        const o = st2.pop()
        if (o !== scene && o.isMesh) o.visible = keep.has(o) ? true : !on
        if (o.children) for (const c of o.children) st2.push(c)
      }
      return on
    },
    setNight: (on) => {
      state.isNight = on
      el('hud-night').style.opacity = on ? 1 : 0
      hemi.intensity = on ? 0.3 : 0.95
      dirLight.intensity = on ? 0.25 : 0.9
      scene.background = new THREE.Color(on ? 0x0a1030 : 0x87b7d8)
      scene.fog = new THREE.Fog(on ? 0x0a1030 : 0x87b7d8, on ? 140 : 420, on ? 1500 : 3300)
      return true
    },
    testHide: (on) => {
      let n = 0
      const stack = [player.mesh]
      while (stack.length) {
        const o = stack.pop()
        if (o.isMesh) { o.visible = !on; n++ }
        if (o.children) for (const c of o.children) stack.push(c)
      }
      for (const p of peds) {
        const s = [p.mesh]
        while (s.length) {
          const o = s.pop()
          if (o.isMesh) { o.visible = !on; n++ }
          if (o.children) for (const c of o.children) s.push(c)
        }
      }
      return n
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
    aimRot: (r) => { car.r = r; const v = shifted(r); car._vdx = v.fx; car._vdy = v.fy },
    carPos: () => ({ x: car.x, y: car.y }),
    ready: true
  }

  updateHud()
  showMsg('WELCOME TO PROJECT VI', 2000)
  loop()
}

boot()