import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'assets', 'map')
mkdirSync(OUT_DIR, { recursive: true })

const TILE = 16
const MAP_W = 176
const MAP_H = 288
const SEED = Number(process.env.SEED) || Math.floor(Math.random() * 1e9)
console.log('seed:', SEED)

// tile local ids (gid in JSON = local + 1)
const T = {
  GRASS: 0,
  SIDEWALK: 1,
  ROAD: 2,
  CROSSWALK: 3,
  BLD_A: 4,
  BLD_B: 5,
  BLD_C: 6,
  TREE: 7,
  WATER: 8,
  PARKING: 9,
  PLAZA: 10,
  DIRT: 11,
  BLD_D: 12
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(SEED)
const rand = (min, max) => min + rng() * (max - min)
const randInt = (min, max) => Math.floor(rand(min, max + 1))
const pick = (arr) => arr[Math.floor(rng() * arr.length)]

// ---------------------------------------------------------------------------
// minimal PNG encoder (RGBA, 8-bit, no deps)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(width, height, rgba) {
  const rgbaBuf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgbaBuf.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------------------
// tiny RGBA canvas helpers
// ---------------------------------------------------------------------------
function makeCanvas(w, h, fill = [0, 0, 0, 0]) {
  return { w, h, data: new Uint8Array(w * h * 4), fill }
}
function px(c, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return
  const i = (y * c.w + x) * 4
  c.data[i] = r
  c.data[i + 1] = g
  c.data[i + 2] = b
  c.data[i + 3] = a
}
function rect(c, x, y, w, h, color) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(c, i, j, ...color)
}
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ---------------------------------------------------------------------------
// tileset art (16x16 tiles)
// ---------------------------------------------------------------------------
const TILE_COUNT = 13
const tiles = Array.from({ length: TILE_COUNT }, () => makeCanvas(TILE, TILE))

function noise(c, color, amount = 60, offset = 30) {
  for (let n = 0; n < amount; n++) {
    const x = randInt(0, TILE - 1)
    const y = randInt(0, TILE - 1)
    const f = rand(-1, 1)
    px(c, x, y,
      Math.max(0, Math.min(255, color[0] + f * offset)),
      Math.max(0, Math.min(255, color[1] + f * offset)),
      Math.max(0, Math.min(255, color[2] + f * offset)))
  }
}

// GRASS
;(() => {
  const c = tiles[T.GRASS]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#3f7c3f'))
  noise(c, hexToRgb('#3f7c3f'), 70, 24)
  for (let i = 0; i < 6; i++) {
    const x = randInt(0, TILE - 1)
    const y = randInt(0, TILE - 1)
    rect(c, x, y, 1, 3, hexToRgb('#57a057'))
  }
})()

// SIDEWALK
;(() => {
  const c = tiles[T.SIDEWALK]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#9d9d99'))
  noise(c, hexToRgb('#9d9d99'), 45, 12)
  // top lit edge
  rect(c, 0, 0, TILE, 1, hexToRgb('#c2c2bd'))
  rect(c, 0, TILE - 1, TILE, 1, hexToRgb('#8f8f8b'))
  // concrete slab seams in a 4px grid
  for (const p of [4, 8, 12]) {
    rect(c, 0, p, TILE, 1, hexToRgb('#8a8a86'))
    rect(c, p, 0, 1, TILE, hexToRgb('#8a8a86'))
  }
  // grout joint ticks
  rect(c, 3, 5, 2, 1, hexToRgb('#82827e'))
  rect(c, 10, 13, 2, 1, hexToRgb('#82827e'))
})()

// ROAD
;(() => {
  const c = tiles[T.ROAD]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#30333a'))
  noise(c, hexToRgb('#30333a'), 55, 9)
  // curbs
  rect(c, 0, 0, TILE, 1, hexToRgb('#23262b'))
  rect(c, 0, TILE - 1, TILE, 1, hexToRgb('#23262b'))
  // lane markings: dashed center + solid edge lines
  for (let y = 2; y < 14; y += 4) {
    rect(c, 7, y, 2, 2, hexToRgb('#c8cbd0'))
  }
  rect(c, 3, 0, 1, TILE, hexToRgb('#c8cbd0'))
  rect(c, 12, 0, 1, TILE, hexToRgb('#9aa038'))
  // worn patches
  rect(c, 2, 8, 2, 2, hexToRgb('#3a3d45'))
  rect(c, 11, 3, 2, 2, hexToRgb('#282a30'))
  rect(c, 13, 9, 2, 2, hexToRgb('#3a3d45'))
})()

// CROSSWALK
;(() => {
  const c = tiles[T.CROSSWALK]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#2c2e33'))
  for (let y = 1; y < TILE; y += 3) {
    rect(c, 2, y, 12, 1, hexToRgb('#c9c9c9'))
    rect(c, 2, y + 1, 12, 1, hexToRgb('#b4b4b4'))
  }
})()

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  return [
    clamp(((n >> 16) & 255) + amt),
    clamp(((n >> 8) & 255) + amt),
    clamp((n & 255) + amt)
  ]
}

function buildingTile(base, border, roofAccent) {
  const c = makeCanvas(TILE, TILE)
  rect(c, 0, 0, TILE, TILE, base)
  rect(c, 0, 0, TILE, 1, border)
  rect(c, 0, TILE - 1, TILE, 1, border)
  rect(c, 0, 0, 1, TILE, border)
  rect(c, TILE - 1, 0, 1, TILE, border)
  // sun-lit top edge + shaded bottom edge
  rect(c, 0, 0, TILE, 1, lighten(base, 34))
  rect(c, 0, TILE - 1, TILE, 1, lighten(border, -45))
  noise(c, base, 45, 14)
  // rooftop facilities (AC units + vents)
  rect(c, 3, 4, 4, 3, roofAccent)
  rect(c, 3, 5, 4, 2, roofAccent.map((v) => Math.max(0, v - 35)))
  rect(c, 9, 4, 4, 3, roofAccent)
  rect(c, 6, 9, 4, 3, roofAccent)
  rect(c, 7, 10, 2, 2, roofAccent.map((v) => Math.max(0, v - 35)))
  rect(c, 2, 2, 2, 2, hexToRgb('#00000055'))
  // antenna
  rect(c, 11, 1, 1, 3, hexToRgb('#1b1e23'))
  rect(c, 10, 1, 3, 1, hexToRgb('#1b1e23'))
  return c
}

// BLD_A gray
tiles[T.BLD_A] = buildingTile(hexToRgb('#6d7078'), hexToRgb('#43454c'), hexToRgb('#565a63'))
// BLD_B brick
tiles[T.BLD_B] = buildingTile(hexToRgb('#a5533f'), hexToRgb('#5c2a1f'), hexToRgb('#7f4032'))
// BLD_C tan
tiles[T.BLD_C] = buildingTile(hexToRgb('#c8b290'), hexToRgb('#6f5d43'), hexToRgb('#a58b63'))
// BLD_D teal tower
tiles[T.BLD_D] = buildingTile(hexToRgb('#2e7d86'), hexToRgb('#17434a'), hexToRgb('#3c9aa6'))

// TREE
;(() => {
  const c = tiles[T.TREE]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#2e5b23'))
  // canopy
  rect(c, 3, 3, 10, 10, hexToRgb('#2f6e27'))
  rect(c, 2, 4, 12, 8, hexToRgb('#377e2b'))
  rect(c, 4, 2, 8, 12, hexToRgb('#377e2b'))
  rect(c, 4, 4, 8, 8, hexToRgb('#44903a'))
  noise(c, hexToRgb('#44903a'), 40, 22)
  rect(c, 1, 12, 14, 3, hexToRgb('#2e5b23'))
  rect(c, 7, 4, 2, 2, hexToRgb('#56a849'))
  // trunk
  rect(c, 7, 11, 2, 4, hexToRgb('#5c4325'))
})()

// WATER
;(() => {
  const c = tiles[T.WATER]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#2a6fb0'))
  noise(c, hexToRgb('#2a6fb0'), 50, 18)
  for (let y = 2; y < TILE; y += 4) {
    rect(c, 3 + (y % 8), y, 6, 1, hexToRgb('#3d86c8'))
    rect(c, 10, y + 2, 4, 1, hexToRgb('#3d86c8'))
  }
})()

// PARKING
;(() => {
  const c = tiles[T.PARKING]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#33353b'))
  noise(c, hexToRgb('#33353b'), 40, 8)
  rect(c, 0, 0, TILE, 1, hexToRgb('#24262b'))
  rect(c, 0, TILE - 1, TILE, 1, hexToRgb('#24262b'))
  // parked car
  rect(c, 2, 3, 5, 3, hexToRgb('#b03a34'))
  rect(c, 3, 2, 3, 2, hexToRgb('#c94a44'))
  rect(c, 3, 3, 3, 1, hexToRgb('#2c3138'))
  rect(c, 2, 4, 5, 1, hexToRgb('#8f2f2a'))
  // stall lines
  rect(c, 9, 1, 1, 14, hexToRgb('#8f9399'))
  rect(c, 13, 1, 1, 14, hexToRgb('#8f9399'))
})()

// PLAZA
;(() => {
  const c = tiles[T.PLAZA]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#bcb8ae'))
  noise(c, hexToRgb('#bcb8ae'), 45, 14)
  rect(c, 0, 0, TILE, 1, hexToRgb('#a3a096'))
  rect(c, 0, TILE - 1, TILE, 1, hexToRgb('#a3a096'))
  // fountain
  rect(c, 4, 4, 8, 8, hexToRgb('#6c8fb5'))
  rect(c, 5, 5, 6, 6, hexToRgb('#7fa6cc'))
  rect(c, 7, 7, 2, 2, hexToRgb('#9cc2e0'))
})()

// DIRT
;(() => {
  const c = tiles[T.DIRT]
  rect(c, 0, 0, TILE, TILE, hexToRgb('#6b5633'))
  noise(c, hexToRgb('#6b5633'), 80, 22)
})()

// ---------------------------------------------------------------------------
// city map generation
// ---------------------------------------------------------------------------
function idx(x, y) {
  return y * MAP_W + x
}

function buildCity() {
  const ground = new Array(MAP_W * MAP_H).fill(T.GRASS)
  const buildings = new Array(MAP_W * MAP_H).fill(-1)
  const gid = (local) => (local < 0 ? 0 : local + 1)

  const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H

  // water border
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (x < 2 || x >= MAP_W - 2 || y < 2 || y >= MAP_H - 2) ground[idx(x, y)] = T.WATER
    }
  }

  const isRoad = (x, y) => x % 8 === 0 || y % 8 === 0

  // roads (skip water border)
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (isRoad(x, y)) ground[idx(x, y)] = T.ROAD
    }
  }

  // crosswalks at a few intersections spread across the whole city
  for (let i = 0; i < 36; i++) {
    const x = (1 + randInt(1, Math.floor(MAP_W / 8) - 2)) * 8
    const y = (1 + randInt(1, Math.floor(MAP_H / 8) - 2)) * 8
    if (inMap(x, y)) ground[idx(x, y)] = T.CROSSWALK
    if (inMap(x + 1, y)) ground[idx(x + 1, y)] = T.CROSSWALK
  }

  // sidewalk: 1-tile frame around each block interior
  const isSidewalk = (x, y) => {
    const xr = x % 8
    const yr = y % 8
    return xr === 1 || xr === 6 || xr === 7 || yr === 1 || yr === 6 || yr === 7
  }
  const isInterior = (x, y) => {
    const xr = x % 8
    const yr = y % 8
    return xr >= 2 && xr <= 5 && yr >= 2 && yr <= 5
  }

  // fill each block's 4x4 interior with varied layouts so the city never repeats
  const setCell = (bx, by, lotX, lotY, dx, dy, g, b) => {
    const x = bx * 8 + 2 + lotX * 2 + dx
    const y = by * 8 + 2 + lotY * 2 + dy
    ground[idx(x, y)] = g
    if (b === undefined) return
    buildings[idx(x, y)] = b
  }
  const rollLot = (bx, by, lotX, lotY) => {
    const h = Math.abs(Math.sin(bx * 12.9898 + lotX * 12.9898 + lotY * 78.233) * 43758.5453) % 1
    const park1 = h < 0.12
    const typeRoll = rng()
    const isBuilding = !park1 && typeRoll < 0.55
    const isTreeLot = !park1 && typeRoll >= 0.55 && typeRoll < 0.72
    const isParking = !park1 && typeRoll >= 0.72 && typeRoll < 0.85
    const isPlaza = !park1 && typeRoll >= 0.85
    const btypes = [T.BLD_A, T.BLD_B, T.BLD_A, T.BLD_C]
    if (rng() < 0.06) btypes.push(T.BLD_D)
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (isBuilding) {
          setCell(bx, by, lotX, lotY, dx, dy, T.DIRT, pick(btypes))
        } else if (isTreeLot) {
          setCell(bx, by, lotX, lotY, dx, dy, T.GRASS, T.TREE)
        } else if (isParking) {
          setCell(bx, by, lotX, lotY, dx, dy, T.PARKING, -1)
        } else if (isPlaza) {
          setCell(bx, by, lotX, lotY, dx, dy, T.PLAZA, -1)
        } else {
          setCell(bx, by, lotX, lotY, dx, dy, T.GRASS, -1)
        }
      }
    }
  }
  const rollBig = (bx, by) => {
    const t = rng()
    const x0 = bx * 8 + 2
    const y0 = by * 8 + 2
    if (t < 0.48) {
      const btype = pick([T.BLD_A, T.BLD_B, T.BLD_C, T.BLD_D])
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) setCell(bx, by, 0, 0, dx, dy, T.DIRT, btype)
      }
    } else if (t < 0.78) {
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const edge = dx === 0 || dy === 0 || dx === 3 || dy === 3
          if (edge) setCell(bx, by, 0, 0, dx, dy, T.DIRT, T.TREE)
          else setCell(bx, by, 0, 0, dx, dy, T.GRASS, -1)
        }
      }
    } else {
      // plaza with fountain core
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const core = dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2
          setCell(bx, by, 0, 0, dx, dy, core ? T.PLAZA : T.GRASS, -1)
        }
      }
    }
  }
  const rollRow = (bx, by) => {
    // 4 houses in a row with lawns + trees
    for (let i = 0; i < 4; i++) {
      setCell(bx, by, i % 2 === 0 ? 1 : 0, i < 2 ? 0 : 1, 0, 0, T.DIRT, pick([T.BLD_B, T.BLD_C]))
      setCell(bx, by, i % 2 === 0 ? 1 : 0, i < 2 ? 0 : 1, 1, 0, T.GRASS, -1)
      setCell(bx, by, i % 2 === 0 ? 1 : 0, i < 2 ? 0 : 1, 0, 1, T.GRASS, -1)
      setCell(bx, by, i % 2 === 0 ? 1 : 0, i < 2 ? 0 : 1, 1, 1, T.GRASS, rng() < 0.4 ? T.TREE : -1)
    }
  }
  const rollTower = (bx, by) => {
    // skyscraper core on a plaza apron
    const btype = pick([T.BLD_A, T.BLD_D, T.BLD_C])
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const core = dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2
        if (core) setCell(bx, by, 0, 0, dx, dy, T.DIRT, btype)
        else setCell(bx, by, 0, 0, dx, dy, T.PLAZA, -1)
      }
    }
  }
  const rollPark = (bx, by) => {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const edge = dx === 0 || dy === 0 || dx === 3 || dy === 3
        if (edge) setCell(bx, by, 0, 0, dx, dy, T.GRASS, T.TREE)
        else setCell(bx, by, 0, 0, dx, dy, T.GRASS, -1)
      }
    }
  }
  for (let blockY = 0; blockY < Math.floor(MAP_H / 8); blockY++) {
    for (let blockX = 0; blockX < Math.floor(MAP_W / 8); blockX++) {
      const r = blockX * 7 + blockY * 13
      if (r % 23 === 0) {
        // occasional empty green block
        for (let y = blockY * 8 + 2; y < blockY * 8 + 6; y++) {
          for (let x = blockX * 8 + 2; x < blockX * 8 + 6; x++) ground[idx(x, y)] = T.GRASS
        }
      } else if ((r % 29) < 4) {
        rollBig(blockX, blockY)
      } else if ((r % 29) < 9) {
        rollRow(blockX, blockY)
      } else if ((r % 31) === 30 && r > 200) {
        rollTower(blockX, blockY)
      } else if ((blockX + blockY) % 7 === 3) {
        rollPark(blockX, blockY)
      } else {
        for (let lotY = 0; lotY < 2; lotY++) {
          for (let lotX = 0; lotX < 2; lotX++) rollLot(blockX, blockY, lotX, lotY)
        }
      }
    }
  }

  // sidewalk ring around interiors
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (isSidewalk(x, y) && !isRoad(x, y) && !isInterior(x, y)) {
        ground[idx(x, y)] = T.SIDEWALK
      }
    }
  }

  // a few street trees on sidewalk corners
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (ground[idx(x, y)] === T.SIDEWALK && rng() < 0.045) {
        buildings[idx(x, y)] = T.TREE
        ground[idx(x, y)] = T.GRASS
      }
    }
  }

  // parking spots become drivable cars, each facing an open escape route
  const cars = []
  const DIRS = [
    [0, -1, 0], [1, 0, 90], [0, 1, 180], [-1, 0, 270]
  ]
  const isCarBlocker = (tx, ty) => {
    const v = buildings[ty * MAP_W + tx]
    return v === T.BLD_A || v === T.BLD_B || v === T.BLD_C || v === T.TREE
  }
  const clearAhead = (tx, ty, dx, dy) => {
    let n = 0
    for (let k = 1; k <= 5; k++) {
      const cx = tx + dx * k
      const cy = ty + dy * k
      if (!inMap(cx, cy) || isCarBlocker(cx, cy)) break
      n++
    }
    return n
  }
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (ground[idx(x, y)] === T.PARKING) {
        if (rng() < 0.5) continue
        const taken = cars.some((c) => Math.abs(c.tx - x) <= 3 && Math.abs(c.ty - y) <= 3)
        if (!taken) {
          let bestDir = DIRS[0]
          let bestClear = -1
          for (const [dx, dy, rot] of DIRS) {
            const c = clearAhead(x, y, dx, dy)
            if (c > bestClear) {
              bestClear = c
              bestDir = [dx, dy, rot]
            }
          }
          cars.push({
            tx: x,
            ty: y,
            x: x * TILE + 8,
            y: y * TILE + 8,
            width: 0,
            height: 0,
            name: 'car',
            rotation: bestDir[2]
          })
        }
      }
    }
  }

  // clear the spawn area (center of map)
  const spawn = { x: Math.floor(MAP_W / 2), y: Math.floor(MAP_H / 2) }
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = spawn.x + dx
      const y = spawn.y + dy
      if (inMap(x, y)) {
        buildings[idx(x, y)] = -1
        ground[idx(x, y)] = T.SIDEWALK
      }
    }
  }

  const data = (layer) => {
    const arr = []
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) arr.push(gid(layer[idx(x, y)]))
    return arr
  }

  const spawnPx = { x: spawn.x * TILE + 8, y: spawn.y * TILE + 8 }

  return { ground: data(ground), buildings: data(buildings), spawn: spawnPx, cars }
}

const city = buildCity()

// ---------------------------------------------------------------------------
// write tileset spritesheet PNG
// ---------------------------------------------------------------------------
const atlas = makeCanvas(TILE * TILE_COUNT, TILE)
for (let t = 0; t < TILE_COUNT; t++) {
  const src = tiles[t].data
  const dst = atlas.data
  const srcW = TILE
  for (let y = 0; y < TILE; y++) {
    const srcStart = y * srcW * 4
    const dstStart = (y * atlas.w + t * TILE) * 4
    dst.set(src.subarray(srcStart, srcStart + TILE * 4), dstStart)
  }
}

// ---------------------------------------------------------------------------
// write Tiled JSON
// ---------------------------------------------------------------------------
const mapJson = {
  compressionlevel: -1,
  height: MAP_H,
  infinite: false,
  layers: [
    {
      data: city.ground,
      height: MAP_H,
      id: 1,
      name: 'ground',
      opacity: 1,
      type: 'tilelayer',
      visible: true,
      width: MAP_W,
      x: 0,
      y: 0
    },
    {
      data: city.buildings,
      height: MAP_H,
      id: 2,
      name: 'buildings',
      opacity: 1,
      type: 'tilelayer',
      visible: true,
      width: MAP_W,
      x: 0,
      y: 0
    },
    {
      draworder: 'topdown',
      id: 3,
      name: 'cars',
      objects: city.cars,
      opacity: 1,
      type: 'objectgroup',
      visible: true,
      x: 0,
      y: 0
    },
    {
      draworder: 'topdown',
      id: 4,
      name: 'spawns',
      objects: [
        {
          height: 0,
          id: 1,
          name: 'player',
          point: true,
          rotation: 0,
          type: '',
          visible: true,
          width: 0,
          x: city.spawn.x,
          y: city.spawn.y
        }
      ],
      opacity: 1,
      type: 'objectgroup',
      visible: true,
      x: 0,
      y: 0
    }
  ],
  nextlayerid: 5,
  nextobjectid: 2,
  orientation: 'orthogonal',
  properties: [],
  renderorder: 'right-down',
  tiledversion: '1.10.2',
  tileheight: TILE,
  tilesets: [
    {
      columns: TILE_COUNT,
      firstgid: 1,
      image: 'tiles.png',
      imageheight: TILE,
      imagewidth: TILE * TILE_COUNT,
      margin: 0,
      name: 'tiles',
      spacing: 0,
      tilecount: TILE_COUNT,
      tileheight: TILE,
      tilewidth: TILE
    }
  ],
  tilewidth: TILE,
  type: 'map',
  version: '1.10',
  width: MAP_W
}

writeFileSync(join(OUT_DIR, 'tiles.png'), encodePNG(atlas.w, atlas.h, atlas.data))
writeFileSync(join(OUT_DIR, 'city.json'), JSON.stringify(mapJson))

console.log(`wrote public/assets/map/tiles.png (${atlas.w}x${atlas.h})`)
console.log(`wrote public/assets/map/city.json (${MAP_W}x${MAP_H}, spawn ${city.spawn.x},${city.spawn.y})`)

// optional visual preview: node tools/generate-assets.js --preview
if (process.argv.includes('--preview')) {
  const SCALE = 2
  const prev = makeCanvas(MAP_W * TILE * SCALE, MAP_H * TILE * SCALE)
  const layers = [city.ground, city.buildings]
  for (let l = 0; l < layers.length; l++) {
    const arr = layers[l]
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const gid = arr[ty * MAP_W + tx]
        if (gid < 1) continue
        const local = gid - 1
        const src = tiles[local].data
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const si = (y * TILE + x) * 4
            const a = src[si + 3]
            if (a === 0) continue
            for (let sy = 0; sy < SCALE; sy++) {
              for (let sx = 0; sx < SCALE; sx++) {
                const dx = tx * TILE * SCALE + x * SCALE + sx
                const dy = ty * TILE * SCALE + y * SCALE + sy
                const di = (dy * prev.w + dx) * 4
                prev.data[di] = src[si]
                prev.data[di + 1] = src[si + 1]
                prev.data[di + 2] = src[si + 2]
                prev.data[di + 3] = 255
              }
            }
          }
        }
      }
    }
  }
  writeFileSync(join(__dirname, 'city-preview.png'), encodePNG(prev.w, prev.h, prev.data))
  console.log(`wrote tools/city-preview.png (${prev.w}x${prev.h})`)
}