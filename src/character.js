export function makeCharacterTexture(scene, key, shirt = '#3fae6a') {
  if (scene.textures.exists(key)) return key
  const t = scene.textures.createCanvas(key, 14, 20)
  const c = t.getContext()

  // ground shadow
  c.fillStyle = 'rgba(0,0,0,0.35)'
  c.beginPath()
  c.ellipse(7, 18, 6, 2.6, 0, 0, Math.PI * 2)
  c.fill()

  // legs (two distinct, with shoes)
  c.fillStyle = '#2a3038'
  c.fillRect(3, 12, 3, 5)
  c.fillRect(8, 12, 3, 5)
  c.fillStyle = '#171b21'
  c.fillRect(2, 15, 5, 5)
  c.fillRect(7, 15, 5, 5)

  // arms (skin) + hands
  c.fillStyle = '#f0ab7d'
  c.fillRect(1, 6, 2, 4)
  c.fillRect(11, 6, 2, 4)
  c.fillStyle = '#e39a6c'
  c.fillRect(1, 9, 2, 2)
  c.fillRect(11, 9, 2, 2)

  // torso (shirt) with shading + outline
  c.fillStyle = shirt
  c.fillRect(3, 9, 8, 4)
  c.fillStyle = 'rgba(255,255,255,0.18)'
  c.fillRect(3, 9, 8, 1)
  c.fillStyle = 'rgba(0,0,0,0.2)'
  c.fillRect(3, 9, 2, 4)
  c.strokeStyle = 'rgba(0,0,0,0.4)'
  c.strokeRect(3, 9, 8, 4)

  // neck
  c.fillStyle = '#f0ab7d'
  c.fillRect(6, 7, 2, 2)

  // head
  c.fillStyle = '#f0ab7d'
  c.beginPath()
  c.arc(7, 3.6, 3.8, 0, Math.PI * 2)
  c.fill()
  c.fillRect(4, 3, 1, 2)
  c.fillRect(9, 3, 1, 2)

  // hair cap + side locks
  c.fillStyle = '#3d2f20'
  c.beginPath()
  c.arc(7, 3.4, 3.9, Math.PI, 0)
  c.closePath()
  c.fill()
  c.fillRect(4, 2, 2, 2)
  c.fillRect(8, 2, 2, 2)

  // face
  c.fillStyle = '#1a1712'
  c.fillRect(6, 3, 1, 1)
  c.fillRect(8, 3, 1, 1)
  c.fillRect(7, 5, 1, 1)

  t.refresh()
  return key
}