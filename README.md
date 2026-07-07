# Fabulae Ex Inani

Stories from the Void: a Node CLI for generating Red Blob Games-style world maps as PNG files, with an optional civilization simulation and Legends archive exporter.

The active workflow is terminal-only. There is no Vite server, browser page, WebGL canvas, or Playwright export path in the normal map generation path.

## Quick Start

```sh
npm install
npm run generate
```

Default output:

```sh
output/mapgen4.png
```

Generate a small deterministic smoke map:

```sh
npm run smoke
```

## Common Commands

```sh
npm run build
npm run check
npm test
npm run clean
```

- `npm run build`: bundles `src/console.ts` to `dist/world-mapgen.cjs`.
- `npm run check`: runs TypeScript checking and a production bundle.
- `npm test`: runs `npm run check`, compact profile determinism, and Legends archive/chunk determinism.
- `npm run clean`: removes generated build artifacts. Pass `-- --output` to also remove generated output files.

After `npm run build`, the bundled console owns the runtime tools:

```sh
node dist/world-mapgen.cjs verify-legends output/legends/legends.json output/legends
node dist/world-mapgen.cjs publish-legends output/legends
node dist/world-mapgen.cjs compare-civ-profiles output/default.json output/one-worker.json
node dist/world-mapgen.cjs evaluate-story-hooks --input output/stress-probes/probe-500-final.json
node dist/world-mapgen.cjs outline-stories --cards-dir output/story-hook-report-cards/cards
```

## Generate Maps

```sh
npm run generate -- --out output/seed-42.png --set elevation.seed=42
npm run generate -- --size 1024 --controls examples/controls/simulation-controls.example.json --out output/simulation-map.png
npm run generate -- --civilizations 5 --years 300 --civ-seed 77 --out output/civilizations.png --civ-json output/civilizations.json
```

Use the built CLI directly:

```sh
node dist/world-mapgen.cjs --help
node dist/world-mapgen.cjs --out output/direct.png --set elevation.seed=99 --summary
```

## Legends Viewer

Generate a Legends archive and local wiki viewer:

```sh
npm run generate -- --size 1024 --controls examples/controls/simulation-controls.example.json --civilizations 5 --years 100 --civ-seed 77 --out output/legends-map.png --legends-json output/legends/legends.json --legends-html output/legends/index.html
node dist/world-mapgen.cjs serve-legends output/legends 8787
```

Open `http://127.0.0.1:8787/index.html`.

Verify a generated Legends archive:

```sh
node dist/world-mapgen.cjs verify-legends output/legends/legends.json output/legends
```

Publish a run for GitHub Pages:

```sh
npm run generate -- --size 640 --controls examples/controls/simulation-controls.example.json --civilizations 5 --years 100 --civ-seed 77 --out output/legends/map.png --legends-json output/legends/legends.json --legends-html output/legends/index.html --snapshot-dir output/legends/snapshots --snapshot-every 1 --snapshot-render-every 1 --snapshot-gif output/legends/map.gif
node dist/world-mapgen.cjs publish-legends output/legends
```

`publish-legends` moves the generated output into `published/sim-YY-MM-DD-HH-MM-seed-###`, normalizes `map.png` to `640x640`, creates `map.gif` and `world.gif`, turns the run root `index.html` into a summary landing page, keeps the wiki viewer at `legends.html`, and regenerates `published/index.html`.

## Repository Layout

- `src/console.ts`: thin CLI dispatcher.
- `src/commands/`: console subcommands, including map generation, clean, static serving, Legends verification, profile comparison, and story-review utilities.
- `src/mapgen/`: terrain mesh, controls, geometry, and mapgen4 orchestration.
- `src/rendering/`: CPU PNG rendering.
- `src/simulation/`: civilization simulation and worker entry point.
- `dependencies/dual-mesh/`: vendored Red Blob Games dual-mesh dependency.
- `examples/controls/`: checked-in control presets for CLI runs.
- `scripts/`: build-time console bundling.
- `docs/feature-reference.md`: detailed simulation, Legends, stress-run, and story-tool reference.
- `docs/upstream-mapgen4.org`: original upstream Mapgen4 README kept for attribution and historical context.
- `dist/`, `output/`, `node_modules/`: generated or installed local artifacts; ignored by git.

## More Detail

- [Feature reference](docs/feature-reference.md)
- [Original upstream Mapgen4 README](docs/upstream-mapgen4.org)

## Attribution

Mapgen4 and Red Blob Games helper libraries are licensed under Apache-2.0. The upstream license is preserved in `LICENSE`.
