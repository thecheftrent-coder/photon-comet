import Phaser from 'phaser'

// Photon Comet — slice v2.
// A comet of light in an Egyptian night temple. The crystal shows
// the color it wants (no words needed); mix it from the red / green / blue
// pools, carry it home. Closer matches score more. Crossing your own trail
// strengthens your color; shadow dims it; sparkles are bonus points.

type RGB = { r: number; g: number; b: number }

const ROUND_SECONDS = 120
const POOL_RATE = 0.55 // channel gain per second inside a pool
const SHADOW_RATE = 0.9 // channel decay per second inside shadow
const CROSS_BOOST = 1.35 // multiplier when crossing your own trail
const TOLERANCE = 0.18 // per-channel match tolerance at the home ring
const TRAIL_SPACING = 10 // px between trail points
const TRAIL_MAX_POINTS = 42 // comet tail, lengthened a touch on Trent's word
const GHOST_SPEED = 780 // px per second — the rock flies, it never teleports
const STAR_POINTS = 25

const TARGETS: { name: string; color: RGB; tier: number }[] = [
  { name: 'Sunbeam Yellow', color: { r: 1, g: 1, b: 0 }, tier: 1 },
  { name: 'Lagoon Cyan', color: { r: 0, g: 1, b: 1 }, tier: 1 },
  { name: 'Orchid Magenta', color: { r: 1, g: 0, b: 1 }, tier: 1 },
  { name: 'Pure White', color: { r: 1, g: 1, b: 1 }, tier: 1 },
  { name: 'Ember Red', color: { r: 1, g: 0.15, b: 0.1 }, tier: 1 },
  { name: 'Tangerine', color: { r: 1, g: 0.5, b: 0 }, tier: 2 },
  { name: 'Deep Violet', color: { r: 0.55, g: 0.25, b: 1 }, tier: 2 },
  { name: 'Mint', color: { r: 0.35, g: 1, b: 0.55 }, tier: 3 },
  { name: 'Sky', color: { r: 0.35, g: 0.65, b: 1 }, tier: 3 },
  { name: 'Rose', color: { r: 1, g: 0.45, b: 0.6 }, tier: 3 },
]

function toColor(c: RGB): number {
  return Phaser.Display.Color.GetColor(
    Math.round(Phaser.Math.Clamp(c.r, 0, 1) * 255),
    Math.round(Phaser.Math.Clamp(c.g, 0, 1) * 255),
    Math.round(Phaser.Math.Clamp(c.b, 0, 1) * 255),
  )
}

function v2list(pts: [number, number][]): Phaser.Math.Vector2[] {
  return pts.map(([x, y]) => new Phaser.Math.Vector2(x, y))
}

function tintTowardWhite(hex: number, f: number): number {
  const c = Phaser.Display.Color.IntegerToColor(hex)
  const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(
    c,
    new Phaser.Display.Color(255, 255, 255),
    100,
    Math.round(f * 100),
  )
  return Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b)
}

function segmentsCross(
  a: Phaser.Types.Math.Vector2Like,
  b: Phaser.Types.Math.Vector2Like,
  c: Phaser.Types.Math.Vector2Like,
  d: Phaser.Types.Math.Vector2Like,
): boolean {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denom = r.x * s.y - r.y * s.x
  if (denom === 0) return false
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom
  return t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95
}

// SoundFX — every sound is synthesized live with Web Audio. No files.
// The three suns sing one note each of a C major chord (red = root,
// green = third, blue = fifth): mixing light literally builds a chord,
// and full white is the whole chord sounding together.
class SoundFX {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sunGain: Record<'r' | 'g' | 'b', GainNode> | null = null
  private warmthOsc: OscillatorNode | null = null
  private warmthGain: GainNode | null = null
  private rumbleOsc: OscillatorNode[] = []
  private rumbleGain: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private moonTimer = 0
  private moonStep = 0
  private sighTimer = 0
  muted = false

  private static NOTES = { r: 261.63, g: 329.63, b: 392.0 }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    if (!window.AudioContext) return
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.5
    this.master.connect(ctx.destination)

    // Ambient bed: three low notes breathing at the edge of hearing
    const bed = ctx.createGain()
    bed.gain.value = 0.016
    bed.connect(this.master)
    for (const f of [130.81, 196.0, 261.63]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(bed)
      o.start()
    }
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.06
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.007
    lfo.connect(lfoGain)
    lfoGain.connect(bed.gain)
    lfo.start()

    // Sun tones
    const mkSun = (freq: number): GainNode => {
      const g = ctx.createGain()
      g.gain.value = 0
      g.connect(this.master!)
      const o1 = ctx.createOscillator()
      o1.type = 'sine'
      o1.frequency.value = freq
      o1.connect(g)
      o1.start()
      const o2 = ctx.createOscillator()
      o2.type = 'triangle'
      o2.frequency.value = freq * 2
      const g2 = ctx.createGain()
      g2.gain.value = 0.25
      o2.connect(g2)
      g2.connect(g)
      o2.start()
      return g
    }
    this.sunGain = {
      r: mkSun(SoundFX.NOTES.r),
      g: mkSun(SoundFX.NOTES.g),
      b: mkSun(SoundFX.NOTES.b),
    }

    // Warmth shimmer
    this.warmthOsc = ctx.createOscillator()
    this.warmthOsc.type = 'sine'
    this.warmthOsc.frequency.value = 1150
    this.warmthGain = ctx.createGain()
    this.warmthGain.gain.value = 0
    this.warmthOsc.connect(this.warmthGain)
    this.warmthGain.connect(this.master)
    this.warmthOsc.start()

    // Black hole rumble: two detuned lows through a lowpass
    this.rumbleGain = ctx.createGain()
    this.rumbleGain.gain.value = 0
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 240
    this.rumbleGain.connect(lp)
    lp.connect(this.master)
    for (const f of [55, 58.7]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(this.rumbleGain)
      o.start()
      this.rumbleOsc.push(o)
    }

    // Shared noise buffer for whooshes
    const len = Math.floor(ctx.sampleRate * 0.3)
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.03)
    }
  }

  private bell(
    freq: number,
    delay: number,
    dur: number,
    vol: number,
    type: OscillatorType = 'sine',
  ) {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime + delay
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const o2 = ctx.createOscillator()
    o2.type = 'sine'
    o2.frequency.value = freq * 2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    const g2 = ctx.createGain()
    g2.gain.value = 0.35
    o.connect(g)
    o2.connect(g2)
    g2.connect(g)
    g.connect(this.master)
    o.start(t0)
    o2.start(t0)
    o.stop(t0 + dur + 0.1)
    o2.stop(t0 + dur + 0.1)
  }

  start() {
    this.bell(523.25, 0, 0.5, 0.1)
  }

  end() {
    ;[261.63, 329.63, 392.0, 523.25].forEach((f, i) =>
      this.bell(f, i * 0.09, 1.6, 0.075),
    )
  }

  tick() {
    this.bell(740, 0, 0.07, 0.05, 'triangle')
  }

  ting() {
    this.bell(1567.98, 0, 0.25, 0.1)
    this.bell(2093, 0.05, 0.2, 0.045)
  }

  boost() {
    if (!this.ctx || !this.master || !this.noiseBuf) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.2
    const t0 = ctx.currentTime
    bp.frequency.setValueAtTime(500, t0)
    bp.frequency.exponentialRampToValueAtTime(1900, t0 + 0.22)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(0.085, t0 + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28)
    src.connect(bp)
    bp.connect(g)
    g.connect(this.master)
    src.start(t0)
    src.stop(t0 + 0.3)
  }

  deliver(quality: number, color: RGB) {
    const chans = (['r', 'g', 'b'] as const).filter((ch) => color[ch] > 0.4)
    const use = chans.length > 0 ? chans : (['r', 'g', 'b'] as const).filter((ch) => color[ch] > 0.12)
    use.forEach((ch, i) => this.bell(SoundFX.NOTES[ch] * 2, i * 0.07, 0.8, 0.12))
    if (quality >= 0.9) {
      ;[1046.5, 1318.5, 1567.98].forEach((f, i) => this.bell(f, 0.18 + i * 0.06, 0.5, 0.06))
    }
  }

  update(
    s: {
      sun: Record<'r' | 'g' | 'b', { inside: boolean; level: number }>
      warmth: number
      holeProx: number
      inMoon: boolean
      draining: boolean
    },
    dt: number,
  ) {
    if (!this.ctx || !this.sunGain || !this.warmthGain || !this.warmthOsc || !this.rumbleGain)
      return
    const now = this.ctx.currentTime
    for (const ch of ['r', 'g', 'b'] as const) {
      const target = s.sun[ch].inside ? 0.045 + s.sun[ch].level * 0.12 : 0
      this.sunGain[ch].gain.setTargetAtTime(target, now, 0.09)
    }
    this.warmthGain.gain.setTargetAtTime(s.warmth * 0.045, now, 0.12)
    this.warmthOsc.frequency.setTargetAtTime(1150 + s.warmth * 300, now, 0.2)
    this.rumbleGain.gain.setTargetAtTime(s.holeProx * s.holeProx * 0.2, now, 0.15)
    this.rumbleOsc.forEach((o, i) =>
      o.frequency.setTargetAtTime((i === 0 ? 55 : 58.7) - s.holeProx * 13, now, 0.3),
    )
    if (s.inMoon) {
      this.moonTimer -= dt
      if (this.moonTimer <= 0) {
        this.moonTimer = 2.2
        const seq = [880, 1046.5, 1318.5, 1046.5]
        this.bell(seq[this.moonStep % seq.length], 0, 1.1, 0.045)
        this.moonStep += 1
      }
    } else {
      this.moonTimer = Math.min(this.moonTimer, 0.3)
    }
    if (s.draining) {
      this.sighTimer -= dt
      if (this.sighTimer <= 0) {
        this.sighTimer = 0.95
        this.sigh()
      }
    } else {
      this.sighTimer = Math.min(this.sighTimer, 0.2)
    }
  }

  private sigh() {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(640, t0)
    o.frequency.exponentialRampToValueAtTime(380, t0 + 0.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(0.04, t0 + 0.06)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45)
    o.connect(g)
    g.connect(this.master)
    o.start(t0)
    o.stop(t0 + 0.5)
  }

  idle() {
    if (!this.ctx || !this.sunGain || !this.warmthGain || !this.rumbleGain) return
    const now = this.ctx.currentTime
    for (const ch of ['r', 'g', 'b'] as const) {
      this.sunGain[ch].gain.setTargetAtTime(0, now, 0.1)
    }
    this.warmthGain.gain.setTargetAtTime(0, now, 0.1)
    this.rumbleGain.gain.setTargetAtTime(0, now, 0.1)
  }
}

class GameScene extends Phaser.Scene {
  private ghost!: Phaser.GameObjects.Image
  private ghostRing!: Phaser.GameObjects.Arc
  private eyeL!: Phaser.GameObjects.Arc
  private eyeR!: Phaser.GameObjects.Arc
  private trailGfx!: Phaser.GameObjects.Graphics
  private crystalGfx!: Phaser.GameObjects.Graphics
  private crystalGlow!: Phaser.GameObjects.Image
  private yourSwatch!: Phaser.GameObjects.Arc
  private star!: Phaser.GameObjects.Image
  private scoreText!: Phaser.GameObjects.Text
  private timeText!: Phaser.GameObjects.Text
  private targetText!: Phaser.GameObjects.Text
  private messageText!: Phaser.GameObjects.Text
  private overlayText!: Phaser.GameObjects.Text

  private color: RGB = { r: 0, g: 0, b: 0 }
  private target: { name: string; color: RGB; tier: number } = TARGETS[0]
  private trail: { x: number; y: number }[] = []
  private pools: { x: number; y: number; radius: number; channel: 'r' | 'g' | 'b' }[] = []
  private shadows: { x: number; y: number; radius: number }[] = []
  private holeGfx!: Phaser.GameObjects.Graphics
  private holes: {
    cx: number
    cy: number
    radius: number
    spin: number
    seeds: { jit: number; size: number }[]
    parts: { ang: number; dist: number }[]
  }[] = []
  private home = { x: 450, y: 505, radius: 46 }
  private moonlight = { x: 86, y: 300, radius: 52 }
  private facing = { x: 0, y: -1 }

  private dragging = false
  private pointerTarget: { x: number; y: number } | null = null
  private score = 0
  private timeLeft = ROUND_SECONDS
  private playing = false
  private crossCooldown = 0
  private wasHome = false
  private starActive = false
  private crystalGroup!: Phaser.GameObjects.Container
  private streak = 0
  private radianceLeft = 0
  private radianceText!: Phaser.GameObjects.Text
  private holeVis: {
    halo: Phaser.GameObjects.Image
    core: Phaser.GameObjects.Graphics
    label: Phaser.GameObjects.Text
  }[] = []
  private holePos: { x: number; y: number }[] = []
  private burstDots: Phaser.GameObjects.Image[] = []
  private burstVel: { vx: number; vy: number; life: number; life0: number }[] = []
  private burstRing!: Phaser.GameObjects.Arc
  private introGroup!: Phaser.GameObjects.Container
  private phaseAnnounced = 0
  private best = 0
  private sfx = new SoundFX()
  private muteText!: Phaser.GameObjects.Text
  private lastTickSec = -1

  constructor() {
    super('game')
  }

  create() {
    const { width, height } = this.scale

    // --- Textures ---
    const glow = this.make.graphics({ x: 0, y: 0 }, false)
    glow.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 1, 1, 0, 0)
    glow.fillCircle(32, 32, 32)
    glow.generateTexture('glow', 64, 64)
    glow.destroy()

    const starGfx = this.make.graphics({ x: 0, y: 0 }, false)
    starGfx.fillStyle(0xffd76a, 1)
    const starPts: [number, number][] = []
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5
      const rad = i % 2 === 0 ? 15 : 6.5
      starPts.push([16 + Math.cos(ang) * rad, 16 + Math.sin(ang) * rad])
    }
    starGfx.fillPoints(v2list(starPts), true)
    starGfx.generateTexture('star', 32, 32)
    starGfx.destroy()

    // Sun rays texture: alternating long and short triangular rays
    const rays = this.make.graphics({ x: 0, y: 0 }, false)
    rays.fillStyle(0xffffff, 1)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const len = i % 2 === 0 ? 118 : 88
      const half = 0.1
      rays.fillTriangle(
        128 + Math.cos(a - half) * 46,
        128 + Math.sin(a - half) * 46,
        128 + Math.cos(a + half) * 46,
        128 + Math.sin(a + half) * 46,
        128 + Math.cos(a) * len,
        128 + Math.sin(a) * len,
      )
    }
    rays.generateTexture('rays', 256, 256)
    rays.destroy()

    const sky = this.make.graphics({ x: 0, y: 0 }, false)
    sky.fillGradientStyle(0x0a1030, 0x0a1030, 0x1c1108, 0x1c1108, 1, 1, 1, 1)
    sky.fillRect(0, 0, width, height)
    sky.generateTexture('sky', width, height)
    sky.destroy()

    this.drawBackground(width, height)

    // --- Moonlight pool: pale light that lifts every color toward white ---
    const ml = this.moonlight
    const shaft = this.add.graphics()
    shaft.fillStyle(0xcfd8ff, 0.05)
    shaft.fillTriangle(48, 84, 84, 84, ml.x + 34, ml.y - 20)
    shaft.fillTriangle(48, 84, ml.x - 34, ml.y - 20, ml.x + 34, ml.y - 20)
    const mlGlow = this.add.image(ml.x, ml.y, 'glow')
    mlGlow.setDisplaySize(ml.radius * 2.5, ml.radius * 2.5)
    mlGlow.setTint(0xcfd8ff)
    mlGlow.setAlpha(0.3)
    mlGlow.setBlendMode(Phaser.BlendModes.ADD)
    const mlRing = this.add.graphics()
    mlRing.lineStyle(2, 0xcfd8ff, 0.5)
    mlRing.strokeCircle(ml.x, ml.y, ml.radius)
    mlRing.lineStyle(1, 0xcfd8ff, 0.22)
    mlRing.strokeCircle(ml.x, ml.y, ml.radius + 7)
    this.add
      .text(ml.x, ml.y + ml.radius + 16, 'MOONLIGHT', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        color: '#aab6dd',
      })
      .setOrigin(0.5)

    // --- Black holes: singularities that eat your light ---
    this.shadows = [
      { x: 130, y: 445, radius: 58 },
      { x: 775, y: 445, radius: 58 },
    ]
    this.holeGfx = this.add.graphics().setDepth(2)
    for (const s of this.shadows) {
      const coreGfx = this.add.graphics().setDepth(1)
      // Hot halo, slowly breathing
      const halo = this.add.image(s.x, s.y, 'glow')
      halo.setDisplaySize(s.radius * 3.6, s.radius * 3.6)
      halo.setTint(0xff6a22)
      halo.setAlpha(0.32)
      halo.setBlendMode(Phaser.BlendModes.ADD)
      halo.setDepth(-2)
      this.tweens.add({
        targets: halo,
        alpha: 0.46,
        scaleX: halo.scaleX * 1.13,
        scaleY: halo.scaleY * 1.13,
        duration: 2300,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
      // The void itself, ringed by bent light (drawn local, positioned
      // on the hole so the whole singularity can drift late in a round)
      coreGfx.fillStyle(0x000000, 1)
      coreGfx.fillCircle(0, 0, s.radius * 0.55)
      coreGfx.lineStyle(2, 0xbfd4ff, 0.55)
      coreGfx.strokeCircle(0, 0, s.radius * 0.6)
      coreGfx.lineStyle(1, 0xbfd4ff, 0.2)
      coreGfx.strokeCircle(0, 0, s.radius * 0.74)
      coreGfx.setPosition(s.x, s.y)
      const label = this.add
        .text(s.x, s.y + s.radius + 22, 'SINGULARITY', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '11px',
          color: '#d98a7a',
        })
        .setOrigin(0.5)
      this.holeVis.push({ halo, core: coreGfx, label })
      this.holePos.push({ x: s.x, y: s.y })
      const seeds: { jit: number; size: number }[] = []
      for (let i = 0; i < 44; i++) {
        seeds.push({
          jit: Phaser.Math.FloatBetween(-0.06, 0.06),
          size: Phaser.Math.FloatBetween(1.4, 3.1),
        })
      }
      const parts: { ang: number; dist: number }[] = []
      for (let i = 0; i < 8; i++) {
        parts.push({
          ang: Phaser.Math.FloatBetween(0, Math.PI * 2),
          dist: s.radius * Phaser.Math.FloatBetween(0.8, 1.6),
        })
      }
      this.holes.push({
        cx: s.x,
        cy: s.y,
        radius: s.radius,
        spin: Phaser.Math.FloatBetween(0, 6),
        seeds,
        parts,
      })
    }

    // --- The three suns ---
    this.pools = [
      { x: 185, y: 185, radius: 88, channel: 'r' },
      { x: 715, y: 185, radius: 88, channel: 'g' },
      { x: 450, y: 300, radius: 88, channel: 'b' },
    ]
    const poolColors: Record<string, number> = { r: 0xff2a1a, g: 0x22ff66, b: 0x2266ff }
    // Blue stars burn hottest, red coolest — the blue sun's core runs
    // whiter, the red sun's deeper
    const coreWhiteness: Record<string, number> = { r: 0.45, g: 0.55, b: 0.72 }
    const sunRing = this.add.graphics().setDepth(1)
    for (const p of this.pools) {
      const base = poolColors[p.channel]
      // Corona halo, breathing
      const corona = this.add.image(p.x, p.y, 'glow')
      corona.setDisplaySize(p.radius * 3.3, p.radius * 3.3)
      corona.setTint(base)
      corona.setAlpha(0.42)
      corona.setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({
        targets: corona,
        alpha: 0.58,
        scaleX: corona.scaleX * 1.07,
        scaleY: corona.scaleY * 1.07,
        duration: Phaser.Math.Between(1700, 2500),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
      // Two ray layers turning against each other
      const raysBack = this.add.image(p.x, p.y, 'rays')
      raysBack.setDisplaySize(p.radius * 2.95, p.radius * 2.95)
      raysBack.setTint(base)
      raysBack.setAlpha(0.5)
      raysBack.setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({
        targets: raysBack,
        angle: 360,
        duration: 46000,
        repeat: -1,
        ease: 'Linear',
      })
      const raysFront = this.add.image(p.x, p.y, 'rays')
      raysFront.setDisplaySize(p.radius * 2.3, p.radius * 2.3)
      raysFront.setTint(tintTowardWhite(base, 0.35))
      raysFront.setAlpha(0.65)
      raysFront.setAngle(15)
      raysFront.setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({
        targets: raysFront,
        angle: -345,
        duration: 30000,
        repeat: -1,
        ease: 'Linear',
      })
      // The burning disk and its white-hot heart
      const disk = this.add.circle(
        p.x,
        p.y,
        p.radius * 0.62,
        tintTowardWhite(base, coreWhiteness[p.channel] * 0.6),
        0.95,
      )
      disk.setBlendMode(Phaser.BlendModes.ADD)
      const heart = this.add.image(p.x, p.y, 'glow')
      heart.setDisplaySize(p.radius * 1.15, p.radius * 1.15)
      heart.setTint(tintTowardWhite(base, coreWhiteness[p.channel]))
      heart.setAlpha(0.95)
      heart.setBlendMode(Phaser.BlendModes.ADD)
      // Gold sun-disk ring, like Ra's medallion
      sunRing.lineStyle(3, 0xc9a227, 0.8)
      sunRing.strokeCircle(p.x, p.y, p.radius * 0.8)
      sunRing.lineStyle(1, 0xc9a227, 0.35)
      sunRing.strokeCircle(p.x, p.y, p.radius * 0.9)
    }

    // --- Home ring ---
    const homeGfx = this.add.graphics()
    homeGfx.lineStyle(3, 0xcfd6ff, 0.9)
    homeGfx.strokeCircle(this.home.x, this.home.y, this.home.radius)
    homeGfx.lineStyle(1, 0xcfd6ff, 0.35)
    homeGfx.strokeCircle(this.home.x, this.home.y, this.home.radius + 9)
    this.add
      .text(this.home.x, this.home.y + this.home.radius + 24, 'HOME', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#8b93b8',
      })
      .setOrigin(0.5)

    // --- The crystal: a faceted gem that IS the target color ---
    const crystalGroup = this.add.container(width / 2, 92)
    this.crystalGroup = crystalGroup
    this.crystalGlow = this.add.image(0, 0, 'glow')
    this.crystalGlow.setDisplaySize(150, 150)
    this.crystalGlow.setBlendMode(Phaser.BlendModes.ADD)
    this.crystalGlow.setAlpha(0.75)
    this.crystalGfx = this.add.graphics()
    crystalGroup.add([this.crystalGlow, this.crystalGfx])
    this.tweens.add({
      targets: crystalGroup,
      y: 84,
      duration: 1700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.targetText = this.add
      .text(width / 2, 148, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#c9b98a',
      })
      .setOrigin(0.5, 0)

    // --- Your color swatch, right beside the crystal ---
    this.add
      .text(width / 2 - 118, 58, 'YOURS', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#8b93b8',
      })
      .setOrigin(0.5, 0)
    this.yourSwatch = this.add.circle(width / 2 - 118, 102, 24, 0x000000)
    this.yourSwatch.setStrokeStyle(2, 0xcfd6ff, 0.8)

    // --- Sparkle pickup ---
    this.star = this.add.image(-100, -100, 'star')
    this.star.setDisplaySize(34, 34)
    this.star.setDepth(8)
    this.star.setVisible(false)
    this.tweens.add({
      targets: this.star,
      angle: 360,
      duration: 5200,
      repeat: -1,
      ease: 'Linear',
    })

    // --- HUD ---
    this.scoreText = this.add
      .text(width - 24, 24, 'SCORE 0', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color: '#e8ebff',
      })
      .setOrigin(1, 0)
    this.timeText = this.add
      .text(width - 24, 54, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#8b93b8',
      })
      .setOrigin(1, 0)
    this.radianceText = this.add
      .text(width - 24, 84, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#ffd76a',
      })
      .setOrigin(1, 0)
    try {
      this.sfx.muted = localStorage.getItem('photon-comet-muted') === '1'
    } catch {
      this.sfx.muted = false
    }
    this.muteText = this.add
      .text(18, height - 16, this.sfx.muted ? 'SOUND OFF' : 'SOUND ON', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#8b93b8',
      })
      .setOrigin(0, 1)
      .setDepth(20)
    this.messageText = this.add
      .text(width / 2, height - 26, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '17px',
        color: '#ffd76a',
      })
      .setOrigin(0.5, 1)
    this.overlayText = this.add
      .text(width / 2, height / 2, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '30px',
        color: '#e8ebff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(20)

    // --- Delivery burst pool ---
    for (let i = 0; i < 16; i++) {
      const dot = this.add.image(-200, -200, 'star')
      dot.setVisible(false)
      dot.setDepth(15)
      this.burstDots.push(dot)
      this.burstVel.push({ vx: 0, vy: 0, life: 0, life0: 1 })
    }
    this.burstRing = this.add.circle(this.home.x, this.home.y, this.home.radius, 0xffffff, 0)
    this.burstRing.setVisible(false)
    this.burstRing.setDepth(14)

    // --- Trail layer ---
    this.trailGfx = this.add.graphics().setDepth(5)

    // --- The ghost ---
    this.ghost = this.add.image(this.home.x, this.home.y, 'glow')
    this.ghost.setDisplaySize(64, 64)
    this.ghost.setBlendMode(Phaser.BlendModes.ADD)
    this.ghost.setDepth(10)
    this.ghostRing = this.add.circle(this.home.x, this.home.y, 17, 0xffffff, 0)
    this.ghostRing.setStrokeStyle(2, 0xffffff, 0.85)
    this.ghostRing.setDepth(11)
    this.eyeL = this.add.circle(this.home.x - 6, this.home.y - 3, 3.2, 0x101018)
    this.eyeR = this.add.circle(this.home.x + 6, this.home.y - 3, 3.2, 0x101018)
    this.eyeL.setDepth(12)
    this.eyeR.setDepth(12)

    // --- Input: hold and drag; the rock flies to your finger ---
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.sfx.init()
      // The SOUND ON/OFF corner is a button, not a flight command
      if (p.x < 130 && p.y > this.scale.height - 48) {
        this.sfx.setMuted(!this.sfx.muted)
        try {
          localStorage.setItem('photon-comet-muted', this.sfx.muted ? '1' : '0')
        } catch {
          // storage unavailable — mute still applies this session
        }
        this.muteText.setText(this.sfx.muted ? 'SOUND OFF' : 'SOUND ON')
        return
      }
      if (!this.playing) {
        this.startRound()
        return
      }
      this.dragging = true
      this.setTarget(p)
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging && this.playing) this.setTarget(p)
    })
    this.input.on('pointerup', () => {
      this.dragging = false
      this.pointerTarget = null
    })

    // --- Picture instructions: red sun + green sun -> yellow comet -> home ---
    const intro = this.add.container(0, 0).setDepth(19)
    const mkSun = (x: number, hex: number) => {
      const raysImg = this.add.image(x, 432, 'rays')
      raysImg.setDisplaySize(56, 56)
      raysImg.setTint(hex)
      raysImg.setAlpha(0.85)
      raysImg.setBlendMode(Phaser.BlendModes.ADD)
      const coreDot = this.add.circle(x, 432, 10, tintTowardWhite(hex, 0.5), 1)
      intro.add([raysImg, coreDot])
    }
    mkSun(262, 0xff2a1a)
    intro.add(
      this.add
        .text(298, 432, '+', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#e8ebff' })
        .setOrigin(0.5),
    )
    mkSun(338, 0x22ff66)
    intro.add(
      this.add
        .text(382, 432, '→', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#e8ebff' })
        .setOrigin(0.5),
    )
    const cometGlow = this.add.image(424, 432, 'glow')
    cometGlow.setDisplaySize(42, 42)
    cometGlow.setTint(0xffff22)
    cometGlow.setBlendMode(Phaser.BlendModes.ADD)
    intro.add(cometGlow)
    intro.add(
      this.add
        .text(468, 432, '→', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#e8ebff' })
        .setOrigin(0.5),
    )
    const introRing = this.add.circle(514, 432, 17, 0xffffff, 0)
    introRing.setStrokeStyle(2, 0xcfd6ff, 0.9)
    const introDot = this.add.circle(514, 432, 6, 0xffff22, 1)
    intro.add([introRing, introDot])
    intro.add(
      this.add
        .text(514, 462, '+100', { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#ffd76a' })
        .setOrigin(0.5),
    )
    this.introGroup = intro

    try {
      this.best = Number(localStorage.getItem('photon-comet-best') || 0) || 0
    } catch {
      this.best = 0
    }
    this.overlayText.setText(
      `PHOTON COMET\n\nTap to start${this.best > 0 ? `\n\nBest: ${this.best}` : ''}`,
    )
    this.newTarget()
  }

  private drawBackground(width: number, height: number) {
    this.add.image(0, 0, 'sky').setOrigin(0, 0).setDepth(-10)

    const bg = this.add.graphics().setDepth(-9)
    // Stars
    for (let i = 0; i < 110; i++) {
      const sx = Phaser.Math.Between(10, width - 10)
      const sy = Phaser.Math.Between(8, 400)
      bg.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.15, 0.75))
      bg.fillCircle(sx, sy, Phaser.Math.FloatBetween(0.7, 1.8))
    }
    // Crescent moon, top left
    bg.fillStyle(0xf5e6b8, 0.9)
    bg.fillCircle(64, 66, 21)
    bg.fillStyle(0x0a1030, 1)
    bg.fillCircle(74, 58, 18)
    // Desert sand band
    bg.fillGradientStyle(0x2a1a0c, 0x2a1a0c, 0x120b04, 0x120b04, 0.9, 0.9, 0.9, 0.9)
    bg.fillRect(0, 468, width, height - 468)
    // Pyramid silhouettes on the horizon
    bg.fillStyle(0x070512, 0.9)
    bg.fillTriangle(250, 468, 430, 468, 340, 356)
    bg.fillTriangle(480, 468, 640, 468, 560, 386)
    bg.fillTriangle(90, 468, 220, 468, 155, 398)
    bg.lineStyle(2, 0xc9a227, 0.35)
    bg.lineBetween(250, 468, 340, 356)
    bg.lineBetween(480, 468, 560, 386)
    // Gold frame
    bg.lineStyle(2, 0xc9a227, 0.45)
    bg.strokeRect(6, 6, width - 12, height - 12)
  }

  private drawCrystal() {
    const col = toColor(this.target.color)
    const g = this.crystalGfx
    g.clear()
    // Gem outline: wide top, point at the bottom
    const pts: [number, number][] = [
      [-27, -22],
      [27, -22],
      [36, -2],
      [0, 42],
      [-36, -2],
    ]
    g.fillStyle(col, 1)
    g.fillPoints(v2list(pts), true)
    // Facets
    g.fillStyle(0xffffff, 0.28)
    g.fillPoints(
      v2list([
        [-27, -22],
        [27, -22],
        [36, -2],
        [-36, -2],
      ]),
      true,
    )
    g.fillStyle(0xffffff, 0.14)
    g.fillTriangle(-36, -2, 0, 42, -9, -22)
    g.fillStyle(0x000000, 0.16)
    g.fillTriangle(36, -2, 0, 42, 9, -22)
    g.lineStyle(2, 0xffffff, 0.85)
    g.strokePoints(v2list(pts), true)
    g.lineStyle(1, 0xffffff, 0.5)
    g.lineBetween(-36, -2, 36, -2)
    g.lineBetween(-9, -22, 0, 42)
    g.lineBetween(9, -22, 0, 42)
    this.crystalGlow.setTint(col)
  }

  private setTarget(p: Phaser.Input.Pointer) {
    this.pointerTarget = {
      x: Phaser.Math.Clamp(p.worldX, 24, this.scale.width - 24),
      y: Phaser.Math.Clamp(p.worldY, 24, this.scale.height - 24),
    }
  }

  private stepGhost(nx: number, ny: number) {
    const prev = { x: this.ghost.x, y: this.ghost.y }
    const dx = nx - prev.x
    const dy = ny - prev.y
    const len = Math.hypot(dx, dy)
    if (len > 2) this.facing = { x: dx / len, y: dy / len }
    this.ghost.setPosition(nx, ny)
    this.ghostRing.setPosition(nx, ny)

    const last = this.trail[this.trail.length - 1]
    if (!last || Phaser.Math.Distance.Between(last.x, last.y, nx, ny) >= TRAIL_SPACING) {
      if (last && this.crossCooldown <= 0 && this.trail.length > 12) {
        for (let i = 0; i < this.trail.length - 10; i++) {
          const c = this.trail[i]
          const d = this.trail[i + 1]
          if (segmentsCross(prev, { x: nx, y: ny }, c, d)) {
            this.color.r = Phaser.Math.Clamp(this.color.r * CROSS_BOOST, 0, 1)
            this.color.g = Phaser.Math.Clamp(this.color.g * CROSS_BOOST, 0, 1)
            this.color.b = Phaser.Math.Clamp(this.color.b * CROSS_BOOST, 0, 1)
            this.crossCooldown = 0.6
            this.flash('Trail crossed — color strengthened!')
            this.sfx.boost()
            break
          }
        }
      }
      this.trail.push({ x: nx, y: ny })
      if (this.trail.length > TRAIL_MAX_POINTS) this.trail.shift()
    }
  }

  private animateHoles(dt: number) {
    this.holeGfx.clear()
    for (const h of this.holes) {
      h.spin += dt * 0.55
      // Accretion embers on a tilted ellipse — the front pass burns
      // brighter, and the approaching side is beamed up like real physics
      for (let i = 0; i < h.seeds.length; i++) {
        const a = h.spin + (i / h.seeds.length) * Math.PI * 2 + h.seeds[i].jit
        const ex = h.cx + Math.cos(a) * h.radius * 1.28
        const ey = h.cy + Math.sin(a) * h.radius * 0.4
        const front = Math.sin(a) > 0
        const beam = Math.cos(a) < 0 ? 1 : 0.55
        const alpha = (front ? 0.95 : 0.38) * beam
        this.holeGfx.fillStyle(front ? 0xffc37a : 0xff8c3a, alpha)
        this.holeGfx.fillCircle(ex, ey, h.seeds[i].size * (front ? 1.25 : 0.9))
      }
      // Debris spirals in, faster and faster, and vanishes
      for (const p of h.parts) {
        p.dist -= dt * (26 + (h.radius * 1.7 - p.dist) * 0.9)
        p.ang += dt * (140 / Math.max(p.dist, 12))
        if (p.dist < h.radius * 0.5) {
          p.dist = h.radius * Phaser.Math.FloatBetween(1.35, 1.6)
          p.ang = Phaser.Math.FloatBetween(0, Math.PI * 2)
        }
        const px = h.cx + Math.cos(p.ang) * p.dist
        const py = h.cy + Math.sin(p.ang) * p.dist * 0.72
        this.holeGfx.fillStyle(0xffe2b0, 0.75)
        this.holeGfx.fillCircle(px, py, 1.8)
      }
    }
  }

  private flash(msg: string) {
    this.messageText.setText(msg)
    this.time.delayedCall(1500, () => {
      if (this.messageText.text === msg) this.messageText.setText('')
    })
  }

  private toleranceNow(): number {
    const elapsed = ROUND_SECONDS - this.timeLeft
    if (elapsed < 40) return 0.2
    if (elapsed < 85) return TOLERANCE
    return 0.15
  }

  private newTarget() {
    const elapsed = ROUND_SECONDS - this.timeLeft
    const maxTier = elapsed < 40 ? 1 : elapsed < 85 ? 2 : 3
    const pool = TARGETS.filter((t) => t.tier <= maxTier)
    const pick = Phaser.Utils.Array.GetRandom(pool) as {
      name: string
      color: RGB
      tier: number
    }
    this.target = pick
    this.targetText.setText(pick.name)
    this.drawCrystal()
  }

  private fireBurst(colorHex: number) {
    const ring = this.burstRing
    ring.setPosition(this.home.x, this.home.y)
    ring.setStrokeStyle(3, colorHex, 0.9)
    ring.setScale(1)
    ring.setAlpha(1)
    ring.setVisible(true)
    this.tweens.add({
      targets: ring,
      scale: 2.3,
      alpha: 0,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.setVisible(false),
    })
    for (let i = 0; i < this.burstDots.length; i++) {
      const dot = this.burstDots[i]
      const v = this.burstVel[i]
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const speed = Phaser.Math.FloatBetween(90, 270)
      v.vx = Math.cos(ang) * speed
      v.vy = Math.sin(ang) * speed
      v.life = v.life0 = Phaser.Math.FloatBetween(0.45, 0.8)
      dot.setPosition(this.home.x, this.home.y)
      dot.setTint(colorHex)
      dot.setDisplaySize(Phaser.Math.Between(9, 18), Phaser.Math.Between(9, 18))
      dot.setAlpha(1)
      dot.setVisible(true)
    }
  }

  private spawnStar() {
    for (let tries = 0; tries < 14; tries++) {
      const x = Phaser.Math.Between(80, 820)
      const y = Phaser.Math.Between(165, 540)
      const inShadow = this.shadows.some(
        (s) => Phaser.Math.Distance.Between(x, y, s.x, s.y) < s.radius + 14,
      )
      const nearHome =
        Phaser.Math.Distance.Between(x, y, this.home.x, this.home.y) < this.home.radius + 22
      if (inShadow || nearHome) continue
      this.star.setPosition(x, y)
      this.star.setVisible(true)
      this.starActive = true
      return
    }
    this.time.delayedCall(800, () => this.spawnStar())
  }

  private startRound() {
    this.score = 0
    this.timeLeft = ROUND_SECONDS
    this.playing = true
    this.color = { r: 0, g: 0, b: 0 }
    this.trail = []
    this.dragging = false
    this.pointerTarget = null
    this.streak = 0
    this.radianceLeft = 0
    this.phaseAnnounced = 0
    this.lastTickSec = -1
    this.sfx.start()
    this.ghost.setPosition(this.home.x, this.home.y)
    this.ghostRing.setPosition(this.home.x, this.home.y)
    this.overlayText.setText('')
    this.introGroup.setVisible(false)
    this.newTarget()
    this.spawnStar()
    this.flash('Match the crystal, then bring it home!')
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05)
    this.crossCooldown = Math.max(0, this.crossCooldown - dt)

    // Black holes drift late in the round; every visual follows
    const elapsed0 = ROUND_SECONDS - this.timeLeft
    for (let i = 0; i < this.shadows.length; i++) {
      const s = this.shadows[i]
      if (this.playing && elapsed0 > 75) {
        const t = this.time.now / 1000
        this.holePos[i].x = s.x + Math.sin(t * 0.24 + i * 2.1) * 26
        this.holePos[i].y = s.y + Math.cos(t * 0.19 + i * 1.7) * 16
      } else {
        this.holePos[i].x = s.x
        this.holePos[i].y = s.y
      }
      this.holes[i].cx = this.holePos[i].x
      this.holes[i].cy = this.holePos[i].y
      const vis = this.holeVis[i]
      vis.halo.setPosition(this.holePos[i].x, this.holePos[i].y)
      vis.core.setPosition(this.holePos[i].x, this.holePos[i].y)
      vis.label.setPosition(this.holePos[i].x, this.holePos[i].y + s.radius + 22)
    }
    this.animateHoles(dt)

    // Delivery burst particles
    for (let i = 0; i < this.burstDots.length; i++) {
      const v = this.burstVel[i]
      if (v.life <= 0) continue
      v.life -= dt
      const dot = this.burstDots[i]
      if (v.life <= 0) {
        dot.setVisible(false)
        continue
      }
      v.vx *= 1 - 2.4 * dt
      v.vy *= 1 - 2.4 * dt
      dot.setPosition(dot.x + v.vx * dt, dot.y + v.vy * dt)
      dot.setAlpha(Math.min(1, v.life / v.life0 + 0.25))
    }

    // Ghost, eyes and swatch always show the current state
    const col = toColor(this.color)
    this.ghost.setTint(col)
    this.yourSwatch.setFillStyle(col)
    const ex = this.ghost.x + this.facing.x * 5
    const ey = this.ghost.y + this.facing.y * 5
    this.eyeL.setPosition(ex - 6, ey - 2)
    this.eyeR.setPosition(ex + 6, ey - 2)

    // The crystal warms — brighter, bigger, faster — as your color
    // nears its own
    let warmth = 0
    if (this.playing && this.color.r + this.color.g + this.color.b > 0.15) {
      const t = this.target.color
      const meanErr =
        (Math.abs(this.color.r - t.r) +
          Math.abs(this.color.g - t.g) +
          Math.abs(this.color.b - t.b)) /
        3
      warmth = Phaser.Math.Clamp(1 - meanErr / 0.55, 0, 1)
    }
    this.crystalGlow.setAlpha(0.45 + warmth * 0.5)
    const pulse =
      Math.sin(this.time.now / (400 - warmth * 240)) * (0.02 + warmth * 0.045)
    this.crystalGroup.setScale(1 + warmth * 0.1 + pulse)

    if (!this.playing) {
      this.sfx.idle()
      return
    }

    // Timer
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.timeLeft = 0
      this.playing = false
      this.dragging = false
      this.star.setVisible(false)
      this.starActive = false
      this.sfx.end()
      let bestLine = ''
      if (this.score > this.best) {
        this.best = this.score
        try {
          localStorage.setItem('photon-comet-best', String(this.best))
        } catch {
          // storage unavailable — the score still counts this session
        }
        bestLine = '\nNEW BEST!'
      } else if (this.best > 0) {
        bestLine = `\nBest: ${this.best}`
      }
      this.overlayText.setText(
        `TIME!\nFinal score: ${this.score}${bestLine}\n\nTap to play again`,
      )
      this.introGroup.setVisible(true)
    }
    this.timeText.setText(`TIME ${Math.ceil(this.timeLeft)}`)
    this.scoreText.setText(`SCORE ${this.score}`)
    const wholeSec = Math.ceil(this.timeLeft)
    if (wholeSec <= 10 && wholeSec >= 1 && wholeSec !== this.lastTickSec) {
      this.lastTickSec = wholeSec
      this.sfx.tick()
    }

    // Radiance streak timer
    if (this.radianceLeft > 0) {
      this.radianceLeft = Math.max(0, this.radianceLeft - dt)
      if (this.radianceLeft === 0) this.streak = 0
    }
    this.radianceText.setText(
      this.radianceLeft > 0
        ? `RADIANCE ${Math.ceil(this.radianceLeft)}s — 2x SCORE`
        : '',
    )

    // Round phases announce themselves once each
    const elapsed = ROUND_SECONDS - this.timeLeft
    if (elapsed >= 40 && this.phaseAnnounced < 1) {
      this.phaseAnnounced = 1
      this.flash('The crystal grows fussier — trickier colors now')
    }
    if (elapsed >= 75 && this.phaseAnnounced < 2) {
      this.phaseAnnounced = 2
      this.flash('The black holes are drifting…')
    }

    // The rock flies toward your finger at a set speed — no teleporting
    if (this.dragging && this.pointerTarget) {
      const dx = this.pointerTarget.x - this.ghost.x
      const dy = this.pointerTarget.y - this.ghost.y
      const dist = Math.hypot(dx, dy)
      if (dist > 1) {
        const step = Math.min(dist, GHOST_SPEED * dt)
        this.stepGhost(
          this.ghost.x + (dx / dist) * step,
          this.ghost.y + (dy / dist) * step,
        )
      }
    }

    // Singularity gravity: the closer you drift, the harder it pulls —
    // always escapable at full flight speed, never ignorable
    let holeProx = 0
    for (let i = 0; i < this.shadows.length; i++) {
      const hp = this.holePos[i]
      const d = Phaser.Math.Distance.Between(this.ghost.x, this.ghost.y, hp.x, hp.y)
      const influence = this.shadows[i].radius * 2.7
      holeProx = Math.max(holeProx, Phaser.Math.Clamp(1 - d / influence, 0, 1))
      if (d < influence && d > 4) {
        const t = Phaser.Math.Clamp(
          1 -
            (d - this.shadows[i].radius * 0.55) /
              (influence - this.shadows[i].radius * 0.55),
          0,
          1,
        )
        const pull = (30 + t * t * 320) * dt
        this.stepGhost(
          this.ghost.x + ((hp.x - this.ghost.x) / d) * pull,
          this.ghost.y + ((hp.y - this.ghost.y) / d) * pull,
        )
      }
    }

    const gx = this.ghost.x
    const gy = this.ghost.y

    // Pools add their channel
    const sunIn = { r: false, g: false, b: false }
    for (const p of this.pools) {
      if (Phaser.Math.Distance.Between(gx, gy, p.x, p.y) < p.radius) {
        sunIn[p.channel] = true
        this.color[p.channel] = Phaser.Math.Clamp(
          this.color[p.channel] + POOL_RATE * dt,
          0,
          1,
        )
      }
    }
    // Black holes eat your light
    let draining = false
    for (let i = 0; i < this.shadows.length; i++) {
      const hp = this.holePos[i]
      if (Phaser.Math.Distance.Between(gx, gy, hp.x, hp.y) < this.shadows[i].radius) {
        draining = this.color.r + this.color.g + this.color.b > 0.1
        const f = Math.max(0, 1 - SHADOW_RATE * dt)
        this.color.r *= f
        this.color.g *= f
        this.color.b *= f
      }
    }
    // Moonlight lifts every channel evenly toward white — a gentle way
    // to pale a mix down, or to climb to white the slow way
    let inMoon = false
    if (
      Phaser.Math.Distance.Between(gx, gy, this.moonlight.x, this.moonlight.y) <
      this.moonlight.radius
    ) {
      inMoon = true
      const lift = 0.22 * dt
      this.color.r = Phaser.Math.Clamp(this.color.r + lift, 0, 1)
      this.color.g = Phaser.Math.Clamp(this.color.g + lift, 0, 1)
      this.color.b = Phaser.Math.Clamp(this.color.b + lift, 0, 1)
    }

    // Sparkle pickup
    if (
      this.starActive &&
      Phaser.Math.Distance.Between(gx, gy, this.star.x, this.star.y) < 30
    ) {
      this.score += STAR_POINTS
      this.starActive = false
      this.star.setVisible(false)
      this.sfx.ting()
      this.flash(`Sparkle! +${STAR_POINTS}`)
      this.time.delayedCall(1100, () => {
        if (this.playing) this.spawnStar()
      })
    }

    // Home delivery — the closer the match, the bigger the score
    const atHome =
      Phaser.Math.Distance.Between(gx, gy, this.home.x, this.home.y) < this.home.radius
    if (atHome && !this.wasHome) {
      const t = this.target.color
      const errR = Math.abs(this.color.r - t.r)
      const errG = Math.abs(this.color.g - t.g)
      const errB = Math.abs(this.color.b - t.b)
      const tol = this.toleranceNow()
      const match = errR <= tol && errG <= tol && errB <= tol
      const hasColor = this.color.r + this.color.g + this.color.b > 0.15
      if (match) {
        const meanErr = (errR + errG + errB) / 3
        const quality = Phaser.Math.Clamp(1 - meanErr / tol, 0, 1)
        let points = 100 + Math.round(100 * quality)
        if (this.radianceLeft > 0) points *= 2
        this.score += points
        this.fireBurst(toColor(t))
        this.sfx.deliver(quality, t)
        this.streak += 1
        const triggersRadiance = this.streak >= 3 && this.radianceLeft <= 0
        if (triggersRadiance) {
          this.radianceLeft = 10
          this.flash(`RADIANCE! +${points} — double score for 10 seconds!`)
        } else if (quality >= 0.9) {
          this.flash(`PERFECT MATCH! +${points}`)
        } else if (quality >= 0.5) {
          this.flash(`Great match! +${points}`)
        } else {
          this.flash(`Delivered! +${points}`)
        }
        this.color = { r: 0, g: 0, b: 0 }
        this.trail = []
        this.newTarget()
      } else if (hasColor) {
        this.streak = 0
        this.flash("Not the crystal's color yet — adjust and come back")
      }
    }
    this.wasHome = atHome

    // The singularities drink the tail: nearby points stream inward,
    // faster the closer they get, and vanish into the void
    if (this.trail.length > 0) {
      const kept: { x: number; y: number }[] = []
      for (const tp of this.trail) {
        let eaten = false
        for (let i = 0; i < this.shadows.length; i++) {
          const hp = this.holePos[i]
          const d = Phaser.Math.Distance.Between(tp.x, tp.y, hp.x, hp.y)
          const core = this.shadows[i].radius * 0.55
          if (d < core) {
            eaten = true
            break
          }
          const influence = this.shadows[i].radius * 2.2
          if (d < influence && d > 1) {
            const t = Phaser.Math.Clamp(1 - (d - core) / (influence - core), 0, 1)
            const pull = Math.min((25 + t * t * 430) * dt, d)
            tp.x += ((hp.x - tp.x) / d) * pull
            tp.y += ((hp.y - tp.y) / d) * pull
          }
        }
        if (!eaten) kept.push(tp)
      }
      this.trail = kept
    }

    // Comet tail: plump at the ghost, tapering and fading to a point —
    // under Radiance it blazes white-gold
    const tailCol = this.radianceLeft > 0 ? tintTowardWhite(col, 0.55) : col
    this.trailGfx.clear()
    if (this.trail.length > 1) {
      const pts = [...this.trail, { x: gx, y: gy }]
      for (let i = 0; i < pts.length; i++) {
        const t = i / (pts.length - 1) // 0 = tail tip, 1 = at the ghost
        const radius = 1.2 + Math.pow(t, 1.6) * 11.5
        const alpha = 0.06 + t * 0.5
        this.trailGfx.fillStyle(tailCol, alpha)
        this.trailGfx.fillCircle(pts[i].x, pts[i].y, radius)
        if (i > 0) {
          // Midpoint circle keeps the tail smooth, not beaded
          const mx = (pts[i].x + pts[i - 1].x) / 2
          const my = (pts[i].y + pts[i - 1].y) / 2
          this.trailGfx.fillCircle(mx, my, radius * 0.92)
        }
      }
    }

    // Sound follows the state of play
    this.sfx.update(
      {
        sun: {
          r: { inside: sunIn.r, level: this.color.r },
          g: { inside: sunIn.g, level: this.color.g },
          b: { inside: sunIn.b, level: this.color.b },
        },
        warmth,
        holeProx,
        inMoon,
        draining,
      },
      dt,
    )
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#07080f',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 900,
    height: 600,
  },
  scene: [GameScene],
})
