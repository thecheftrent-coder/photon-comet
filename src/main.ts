import Phaser from 'phaser'

// Prism Ghost — first bootstrap. The playable slice grows from here.
class BootScene extends Phaser.Scene {
  constructor() {
    super('boot')
  }

  create() {
    const { width, height } = this.scale
    this.add
      .text(width / 2, height / 2, 'PRISM GHOST', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '42px',
        color: '#cfd6ff',
      })
      .setOrigin(0.5)
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
  scene: [BootScene],
})
