import * as THREE from 'three'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(1)
renderer.setSize(640, 480)
renderer.domElement.id = 'gl-test'
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87b7d8)
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3a4634, 0.95))
const dl = new THREE.DirectionalLight(0xfff2d9, 0.9)
dl.position.set(300, 600, -200)
scene.add(dl)

scene.add(new THREE.Mesh(
  new THREE.BoxGeometry(4, 4, 4),
  new THREE.MeshLambertMaterial({ color: 0xd33a3a })
))
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(2, 16, 12),
  new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture((() => {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const ctx = c.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 64, 64)
    g.addColorStop(0, '#f8c196')
    g.addColorStop(1, '#d98c5f')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    return c
  })()) })
))
scene.add(new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshLambertMaterial({ color: 0x3f7c3f })
).rotateX(-Math.PI / 2))

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000)
camera.position.set(10, 8, 14)
camera.lookAt(0, 1, 0)

let frames = 0
function draw() {
  requestAnimationFrame(draw)
  renderer.render(scene, camera)
  if (frames++ > 10) {
    window.__CUBE_INFO = {
      tris: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      w: renderer.domElement.width,
      h: renderer.domElement.height
    }
  }
}
draw()