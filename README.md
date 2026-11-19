# Prism Ghost

A booth mini-game about mixing **light**, played with one finger.

A small ghost made of light starts in a home ring. A crystal shows the target
color it wants. Drag the ghost through pools of red, green, and blue light —
real additive mixing, the way light actually works (red + green reads yellow).
Your glowing trail follows you: cross your own trail and your color grows
stronger; dip into shadow to dim it back down when you overshoot. Carry the
target color home to score. As many matches as you can in about two minutes.

Built for the **Cloud9 x JetBrains "Sky's The Limit" Hackathon 2026**,
Category 3 — Event Mini Game.

## Run it

```sh
npm install
npm run dev
```

Then open the local address Vite prints. `npm run build` produces the
production build in `dist/`.

## Built with

- **WebStorm** — the daily-driver IDE for all game code
- **Junie** (JetBrains' coding agent) — bounded, reviewed build tasks
- **JetBrains Air** — parallel agent sessions, diffs reviewed in one place
- Phaser + Vite + TypeScript

## License

MIT — see `LICENSE`.
