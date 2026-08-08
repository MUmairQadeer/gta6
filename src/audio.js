let ctx = null
let master = null
let engineOsc = null
let engineOsc2 = null
let engineFilter = null
let engineGain = null

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return false
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.3
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return true
  } catch (e) {
    return false
  }
}

export function setEngine(intensity) {
  if (!ctx) return
  try {
    if (intensity <= 0.01) {
      if (engineGain) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.12)
      return
    }
    if (!engineGain) {
      engineGain = ctx.createGain()
      engineGain.gain.value = 0
      master.connect(engineGain)
      engineFilter = ctx.createBiquadFilter()
      engineFilter.type = 'lowpass'
      engineFilter.frequency.value = 320
      engineOsc = ctx.createOscillator()
      engineOsc.type = 'sawtooth'
      engineOsc.frequency.value = 55
      engineOsc2 = ctx.createOscillator()
      engineOsc2.type = 'square'
      engineOsc2.frequency.value = 27
      const sub = ctx.createGain()
      sub.gain.value = 0.55
      engineOsc.connect(engineFilter)
      engineOsc2.connect(sub)
      sub.connect(engineFilter)
      engineFilter.connect(engineGain)
      engineOsc.start()
      engineOsc2.start()
    }
    const t = ctx.currentTime
    const rpm = 50 + intensity * 85
    engineOsc.frequency.setTargetAtTime(rpm, t, 0.08)
    engineOsc2.frequency.setTargetAtTime(rpm * 0.5, t, 0.08)
    engineFilter.frequency.setTargetAtTime(280 + intensity * 800, t, 0.08)
    engineGain.gain.setTargetAtTime(0.05 + intensity * 0.3, t, 0.1)
  } catch (e) {}
}

export function playCrash(intensity = 1) {
  if (!ctx) return
  try {
    const t = ctx.currentTime
    const k = Math.max(0.2, Math.min(1, intensity))

    // low sub thump: the body of the impact
    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(105, t)
    thump.frequency.exponentialRampToValueAtTime(28, t + 0.4)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0.0001, t)
    tg.gain.exponentialRampToValueAtTime(0.9 * k, t + 0.012)
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    thump.connect(tg)
    tg.connect(master)
    thump.start(t)
    thump.stop(t + 0.5)

    // sheet-metal resonance
    const body = ctx.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(72, t)
    body.frequency.exponentialRampToValueAtTime(34, t + 0.28)
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(0.0001, t)
    bg.gain.exponentialRampToValueAtTime(0.28 * k, t + 0.01)
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    body.connect(bg)
    bg.connect(master)
    body.start(t)
    body.stop(t + 0.36)

    // crumple: low-passed noise crunch
    const dur = 0.5
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.6)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(2200, t)
    lp.frequency.exponentialRampToValueAtTime(260, t + dur)
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.0001, t)
    ng.gain.exponentialRampToValueAtTime(0.55 * k, t + 0.008)
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(lp)
    lp.connect(ng)
    ng.connect(master)
    src.start(t)

    // sharp shatter tick for the very first instant
    const tick = ctx.createOscillator()
    tick.type = 'square'
    tick.frequency.value = 180
    const tk = ctx.createGain()
    tk.gain.setValueAtTime(0.0001, t)
    tk.gain.exponentialRampToValueAtTime(0.12 * k, t + 0.004)
    tk.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    tick.connect(tk)
    tk.connect(master)
    tick.start(t)
    tick.stop(t + 0.08)
  } catch (e) {}
}

export function playBusted() {
  if (!ctx) return
  try {
    const t = ctx.currentTime
    const notes = [392, 311, 233]
    let start = t
    for (const f of notes) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.001, start)
      g.gain.exponentialRampToValueAtTime(0.2, start + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.28)
      o.connect(g)
      g.connect(master)
      o.start(start)
      o.stop(start + 0.3)
      start += 0.18
    }
  } catch (e) {}
}