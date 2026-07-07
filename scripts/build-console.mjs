import fs from "node:fs";
import {build} from "esbuild";

fs.mkdirSync("dist", {recursive: true});

await build({
    entryPoints: ["src/console.ts"],
    outfile: "dist/world-mapgen.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: true,
    banner: {
        js: "#!/usr/bin/env node",
    },
    logLevel: "info",
});

await build({
    entryPoints: ["src/simulation/civilization-worker.ts"],
    outfile: "dist/civilization-worker.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: true,
    logLevel: "info",
});

try {
    fs.chmodSync("dist/world-mapgen.cjs", 0o755);
} catch {
    // Windows does not need executable mode for npm scripts.
}
