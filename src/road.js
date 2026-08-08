// High-res seamless asphalt + crisp vector lane markings for the 2D city.
// The base road tiles in tiles.png are 16px with baked noise/markings, which
// breaks apart when the camera zooms in. Here we cover every road tile with a
// window into one 1024x1024 seamless asphalt texture and re-draw all markings
// as clean vector shapes, so the road stays smooth at any zoom level.

const TILE = 16
const ROAD = 3
const CROSSWALK = 4

const hash2 = (a, b, seed) => {
  let h = (a * 374761393 + b * 668265263 + seed * 2246822519) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---------------------------------------------------------------------------
// seamless 1024x1024 asphalt (toroidal value noise, no baked markings)
// ---------------------------------------------------------------------------
export function makeAsphaltTexture(scene) {
  if (scene.textures.exists('road-asphalt')) return 'road-asphalt'
  const S = 1024
  const tex = scene.textures.createCanvas('road-asphalt', S, S)
  const ctx = tex.getContext()
  const img = ctx.createImageData(S, S)
  const px = img.data

  const grids = [64, 16, 4].map((cell) => {
    const n = S / cell
    const g = new Float32Array(n * n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) g[j * n + i] = hash2(i, j, cell)
    }
    return { cell, n, g }
  })
  const sample = (grid, x, y) => {
    const c = grid.cell
    const gx0 = Math.floor(x / c)
    const gy0 = Math.floor(y / c)
    const fx = (x - gx0 * c) / c
    const fy = (y - gy0 * c) / c
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const i = gy0 * grid.n + gx0
    const A = grid.g[i]
    const B = grid.g[i + 1]
    const C = grid.g[i + grid.n]
    const D = grid.g[i + grid.n + 1]
    return A + (B - A) * sx + (C - A) * sy + (A - B - C + D) * sx * sy
  }

  const smooth = (x, y) =>
    (sample(grids[0], x, y) - 0.5) * 9 +
    (sample(grids[1], x, y) - 0.5) * 5 +
    (sample(grids[2], x, y) - 0.5) * 2.5

  // 2x2 coarse pass keeps generation cheap; noise is smooth so this is lossless
  const st = (x, y, v) => {
    const xm = ((x % S) + S) % S
    const ym = ((y % S) + S) % S
    const i = (ym * S + xm) * 4
    const c0 = Math.max(0, Math.min(255, px[i] + v))
    px[i] = c0
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + v))
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + v))
    return c0
  }
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const n = smooth(x, y)
      const r = Math.max(0, Math.min(255, 47 + n))
      const g = Math.max(0, Math.min(255, 50 + n))
      const b = Math.max(0, Math.min(255, 57 + n))
      for (let j = 0; j < 2; j++) {
        const yy = y + j
        if (yy >= S) break
        for (let i = 0; i < 2; i++) {
          const xx = x + i
          if (xx >= S) break
          const k = (yy * S + xx) * 4
          px[k] = r; px[k + 1] = g; px[k + 2] = b; px[k + 3] = 255
        }
      }
    }
  }

  // sparse long cracks (wrapped across edges) for a little character
  for (let k = 0; k < 16; k++) {
    if (hash2(k, 7, 5) > 0.8) continue
    const x0 = Math.floor(hash2(k, 1, 51) * S)
    const y0 = Math.floor(hash2(k, 2, 52) * S)
    const len = 26 + Math.floor(hash2(k, 3, 53) * 46)
    const vert = hash2(k, 4, 54) < 0.5
    for (let i = 0; i < len; i++) {
      st(x0 + (vert ? 0 : i), y0 + (vert ? i : 0), -11)
      if (hash2(k, i, 55) < 0.22) st(x0 + (vert ? 1 : i + 1), y0 + (vert ? i + 1 : 1), -9)
    }
  }

  ctx.putImageData(img, 0, 0)
  tex.refresh()
  return 'road-asphalt'
}

// ---------------------------------------------------------------------------
// asphalt overlay + crisp vector markings, drawn above the baked tiles
// ---------------------------------------------------------------------------
export function makeRoadOverlay(scene) {
  console.log('ROAD: begin')
  const key = makeAsphaltTexture(scene)
  console.log('ROAD: tex ok', key)
  const ground = scene.ground
  const W = scene.map.width
  const H = scene.map.height
  const gid = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return 0
    const t = ground.getTileAt(tx, ty)
    return t ? t.index : 0
  }
  const isRoad = (g) => g === ROAD || g === CROSSWALK

  const children = []
  const lines = scene.add.graphics().setDepth(0.5)
  lines.fillStyle(0xf0f2f6, 1)

  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const gv = gid(tx, ty)
      if (gv !== ROAD && gv !== CROSSWALK) continue
      console.log('ROAD: tile', tx, ty)
      const x0 = tx * TILE
      const y0 = ty * TILE
      children.push(scene.add.tileSprite(x0 + TILE / 2, y0 + TILE / 2, TILE, TILE, key).setDepth(0.5))

      if (gv === CROSSWALK) {
        // clean zebra stripes, full tile width
        for (let j = 0; j < TILE; j++) {
          if (j % 5 < 3) lines.fillRect(x0 + 1.5, y0 + j, TILE - 3, 1)
        }
        continue
      }

      // edge lines where a neighbour isn't road
      if (!isRoad(gid(tx - 1, ty))) lines.fillRect(x0, y0, 1.4, TILE)
      if (!isRoad(gid(tx + 1, ty))) lines.fillRect(x0 + TILE - 1.4, y0, 1.4, TILE)
      if (!isRoad(gid(tx, ty - 1))) lines.fillRect(x0, y0, TILE, 1.4)
      if (!isRoad(gid(tx, ty + 1))) lines.fillRect(x0, y0 + TILE - 1.4, TILE, 1.4)

      // dashed center line on road runs (skips intersections), world-aligned
      if (tx % 8 === 0 && ty % 8 !== 0) {
        for (let y = y0; y < y0 + TILE; ) {
          const p = y % 28
          if (p >= 14) { y += 28 - p; continue }
          const len = Math.min(14 - p, y0 + TILE - y)
          lines.fillRect(x0 + 8 - 0.7, y, 1.4, len)
          y += len
        }
      } else if (tx % 8 !== 0 && ty % 8 === 0) {
        for (let x = x0; x < x0 + TILE; ) {
          const p = x % 28
          if (p >= 14) { x += 28 - p; continue }
          const len = Math.min(14 - p, x0 + TILE - x)
          lines.fillRect(x, y0 + 8 - 0.7, len, 1.4)
          x += len
        }
      }
    }
  }

  children.push(lines)
  return scene.add.group(children)
}