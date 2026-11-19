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

const TARGETS: { name: string; color: RGB }[] = [
  { name: 'Sunbeam Yellow', color: { r: 1, g: 1, b: 0 } },
  { name: 'Lagoon Cyan', color: { r: 0, g: 1, b: 1 } },
  { name: 'Orchid Magenta', color: { r: 1, g: 0, b: 1 } },
  { name: 'Tangerine', color: { r: 1, g: 0.5, b: 0 } },
  { name: 'Mint', color: { r: 0.35, g: 1, b: 0.55 } },
  { name: 'Sky', color: { r: 0.35, g: 0.65, b: 1 } },
  { name: 'Rose', color: { r: 1, g: 0.45, b: 0.6 } },
  { name: 'Pure White', color: { r: 1, g: 1, b: 1 } },
  { name: 'Ember Red', color: { r: 1, g: 0.15, b: 0.1 } },
  { name: 'Deep Violet', color: { r: 0.55, g: 0.25, b: 1 } },
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

function drawAnkh(
  gfx: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  s: number,
  color: number,
  alpha: number,
) {
  gfx.lineStyle(3, color, alpha)
  gfx.strokeCircle(cx, cy - 8 * s, 5 * s)
  gfx.lineBetween(cx, cy - 3 * s, cx, cy + 12 * s)
  gfx.lineBetween(cx - 7 * s, cy + 1 * s, cx + 7 * s, cy + 1 * s)
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
  private target: { name: string; color: RGB } = TARGETS[0]
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
  private facing = { x: 0, y: -1 }

  private dragging = false
  private pointerTarget: { x: number; y: number } | null = null
  private score = 0
  private timeLeft = ROUND_SECONDS
  private playing = false
  private crossCooldown = 0
  private wasHome = false
  private starActive = false

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

    // --- Black holes: singularities that eat your light ---
    this.shadows = [
      { x: 130, y: 445, radius: 58 },
      { x: 775, y: 445, radius: 58 },
    ]
    const coreGfx = this.add.graphics().setDepth(1)
    this.holeGfx = this.add.graphics().setDepth(2)
    for (const s of this.shadows) {
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
      // The void itself, ringed by bent light
      coreGfx.fillStyle(0x000000, 1)
      coreGfx.fillCircle(s.x, s.y, s.radius * 0.55)
      coreGfx.lineStyle(2, 0xbfd4ff, 0.55)
      coreGfx.strokeCircle(s.x, s.y, s.radius * 0.6)
      coreGfx.lineStyle(1, 0xbfd4ff, 0.2)
      coreGfx.strokeCircle(s.x, s.y, s.radius * 0.74)
      this.add
        .text(s.x, s.y + s.radius + 22, 'SINGULARITY', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '11px',
          color: '#d98a7a',
        })
        .setOrigin(0.5)
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

    this.overlayText.setText('PHOTON COMET\n\nTap to start')
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
    // Temple pillars at the edges
    for (const px of [16, width - 42]) {
      bg.fillStyle(0x3a2a16, 1)
      bg.fillRect(px, 96, 26, 428)
      bg.fillStyle(0xc9a227, 0.75)
      bg.fillRect(px - 3, 84, 32, 12)
      bg.fillRect(px - 3, 524, 32, 12)
      bg.fillStyle(0x241806, 1)
      bg.fillRect(px + 11, 96, 4, 428)
    }
    // Gold frame + ankhs in the bottom corners
    bg.lineStyle(2, 0xc9a227, 0.45)
    bg.strokeRect(6, 6, width - 12, height - 12)
    drawAnkh(bg, 34, height - 40, 1, 0xc9a227, 0.8)
    drawAnkh(bg, width - 34, height - 40, 1, 0xc9a227, 0.8)
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

  private newTarget() {
    const pick = Phaser.Utils.Array.GetRandom(TARGETS) as { name: string; color: RGB }
    this.target = pick
    this.targetText.setText(pick.name)
    this.drawCrystal()
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
    this.ghost.setPosition(this.home.x, this.home.y)
    this.ghostRing.setPosition(this.home.x, this.home.y)
    this.overlayText.setText('')
    this.newTarget()
    this.spawnStar()
    this.flash('Match the crystal, then bring it home!')
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05)
    this.crossCooldown = Math.max(0, this.crossCooldown - dt)
    this.animateHoles(dt)

    // Ghost, eyes and swatch always show the current state
    const col = toColor(this.color)
    this.ghost.setTint(col)
    this.yourSwatch.setFillStyle(col)
    const ex = this.ghost.x + this.facing.x * 5
    const ey = this.ghost.y + this.facing.y * 5
    this.eyeL.setPosition(ex - 6, ey - 2)
    this.eyeR.setPosition(ex + 6, ey - 2)

    if (!this.playing) return

    // Timer
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.timeLeft = 0
      this.playing = false
      this.dragging = false
      this.star.setVisible(false)
      this.starActive = false
      this.overlayText.setText(`TIME!\nFinal score: ${this.score}\n\nTap to play again`)
    }
    this.timeText.setText(`TIME ${Math.ceil(this.timeLeft)}`)
    this.scoreText.setText(`SCORE ${this.score}`)

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

    const gx = this.ghost.x
    const gy = this.ghost.y

    // Pools add their channel
    for (const p of this.pools) {
      if (Phaser.Math.Distance.Between(gx, gy, p.x, p.y) < p.radius) {
        this.color[p.channel] = Phaser.Math.Clamp(
          this.color[p.channel] + POOL_RATE * dt,
          0,
          1,
        )
      }
    }
    // Shadow dims everything
    for (const s of this.shadows) {
      if (Phaser.Math.Distance.Between(gx, gy, s.x, s.y) < s.radius) {
        const f = Math.max(0, 1 - SHADOW_RATE * dt)
        this.color.r *= f
        this.color.g *= f
        this.color.b *= f
      }
    }

    // Sparkle pickup
    if (
      this.starActive &&
      Phaser.Math.Distance.Between(gx, gy, this.star.x, this.star.y) < 30
    ) {
      this.score += STAR_POINTS
      this.starActive = false
      this.star.setVisible(false)
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
      const match = errR <= TOLERANCE && errG <= TOLERANCE && errB <= TOLERANCE
      const hasColor = this.color.r + this.color.g + this.color.b > 0.15
      if (match) {
        const meanErr = (errR + errG + errB) / 3
        const quality = Phaser.Math.Clamp(1 - meanErr / TOLERANCE, 0, 1)
        const points = 100 + Math.round(100 * quality)
        this.score += points
        if (quality >= 0.9) this.flash(`PERFECT MATCH! +${points}`)
        else if (quality >= 0.5) this.flash(`Great match! +${points}`)
        else this.flash(`Delivered! +${points}`)
        this.color = { r: 0, g: 0, b: 0 }
        this.trail = []
        this.newTarget()
      } else if (hasColor) {
        this.flash("Not the crystal's color yet — adjust and come back")
      }
    }
    this.wasHome = atHome

    // Comet tail: plump at the ghost, tapering and fading to a point
    this.trailGfx.clear()
    if (this.trail.length > 1) {
      const pts = [...this.trail, { x: gx, y: gy }]
      for (let i = 0; i < pts.length; i++) {
        const t = i / (pts.length - 1) // 0 = tail tip, 1 = at the ghost
        const radius = 1.2 + Math.pow(t, 1.6) * 11.5
        const alpha = 0.06 + t * 0.5
        this.trailGfx.fillStyle(col, alpha)
        this.trailGfx.fillCircle(pts[i].x, pts[i].y, radius)
        if (i > 0) {
          // Midpoint circle keeps the tail smooth, not beaded
          const mx = (pts[i].x + pts[i - 1].x) / 2
          const my = (pts[i].y + pts[i - 1].y) / 2
          this.trailGfx.fillCircle(mx, my, radius * 0.92)
        }
      }
    }
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
