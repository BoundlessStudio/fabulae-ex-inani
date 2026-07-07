import fs from "node:fs";
import path from "node:path";
import {PNG} from "pngjs";
import {writeSnapshotGif} from "./snapshot-gif.ts";

const defaultPublishedDir = "published";
const defaultOutputRoot = "output";
const publishMapSize = 640;
const defaultGifFps = 8;

type PublishOptions = {
    sourceDir?: string;
    publishedDir: string;
    runName?: string;
    title?: string;
    seed?: number;
    framesDir?: string;
    copy: boolean;
    overwrite: boolean;
    gifFps: number;
};

type RunMetadata = {
    id: string;
    title: string;
    publishedAt: string;
    simulationRange: string;
    startYear: number;
    endYear: number;
    seed: number;
    terrainSeed?: number;
    meshSeed?: number;
    summary: Record<string, number>;
    assets: {
        landing: string;
        legends: string;
        map: string;
        mapGif: string;
        worldGif: string;
        legendsJson: string;
    };
};

type CandidateSource = {
    dir: string;
    mtimeMs: number;
};

function printPublishHelp() {
    console.log(`Usage: world-mapgen publish-legends [source-dir] [options]

Move or copy a generated Legends viewer output into published/sim-YY-MM-DD-HH-MM-seed-###.

Options:
  --from <dir>             Source Legends output directory. Defaults to newest output/** with legends.json and index.html.
  --published-dir <dir>    Published site root. Defaults to published
  --name <slug>            Override the generated run directory name
  --title <title>          Override the run landing page title
  --seed <seed>            Override the seed used in the run directory name
  --frames-dir <dir>       Directory of yearly map PNG frames to turn into map.gif
  --gif-fps <fps>          GIF frames per second. Defaults to ${defaultGifFps}
  --copy                   Copy source output instead of moving it
  --overwrite              Replace an existing run directory with the same name
  --help                   Show this help

Recommended publishable generation:
  node dist/world-mapgen.cjs generate --size 640 --controls examples/controls/simulation-controls.example.json --civilizations 5 --years 100 --civ-seed 77 --out output/legends/map.png --legends-json output/legends/legends.json --legends-html output/legends/index.html --snapshot-dir output/legends/snapshots --snapshot-every 1 --snapshot-render-every 1 --snapshot-gif output/legends/map.gif
  node dist/world-mapgen.cjs publish-legends output/legends
`);
}

function readValue(args: string[], index: number, optionName: string): {value: string; nextIndex: number} {
    const current = args[index];
    const prefix = `${optionName}=`;
    if (current.startsWith(prefix)) return {value: current.slice(prefix.length), nextIndex: index};
    if (index + 1 >= args.length) throw new Error(`${optionName} requires a value`);
    return {value: args[index + 1], nextIndex: index + 1};
}

function parsePositiveInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer, got "${value}"`);
    }
    return parsed;
}

function parseArgs(argv: string[]): PublishOptions {
    const options: PublishOptions = {
        publishedDir: defaultPublishedDir,
        copy: false,
        overwrite: false,
        gifFps: defaultGifFps,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            printPublishHelp();
            process.exit(0);
        } else if (arg === "--from" || arg.startsWith("--from=")) {
            const result = readValue(argv, i, "--from");
            options.sourceDir = result.value;
            i = result.nextIndex;
        } else if (arg === "--published-dir" || arg.startsWith("--published-dir=")) {
            const result = readValue(argv, i, "--published-dir");
            options.publishedDir = result.value;
            i = result.nextIndex;
        } else if (arg === "--name" || arg.startsWith("--name=")) {
            const result = readValue(argv, i, "--name");
            options.runName = result.value;
            i = result.nextIndex;
        } else if (arg === "--title" || arg.startsWith("--title=")) {
            const result = readValue(argv, i, "--title");
            options.title = result.value;
            i = result.nextIndex;
        } else if (arg === "--seed" || arg.startsWith("--seed=")) {
            const result = readValue(argv, i, "--seed");
            options.seed = parsePositiveInteger(result.value, "--seed");
            i = result.nextIndex;
        } else if (arg === "--frames-dir" || arg.startsWith("--frames-dir=")) {
            const result = readValue(argv, i, "--frames-dir");
            options.framesDir = result.value;
            i = result.nextIndex;
        } else if (arg === "--gif-fps" || arg.startsWith("--gif-fps=")) {
            const result = readValue(argv, i, "--gif-fps");
            options.gifFps = parsePositiveInteger(result.value, "--gif-fps");
            i = result.nextIndex;
        } else if (arg === "--copy") {
            options.copy = true;
        } else if (arg === "--overwrite") {
            options.overwrite = true;
        } else if (arg.startsWith("--")) {
            throw new Error(`Unknown publish-legends option "${arg}"`);
        } else if (!options.sourceDir) {
            options.sourceDir = arg;
        } else {
            throw new Error(`Unexpected publish-legends argument "${arg}"`);
        }
    }

    return options;
}

function isDirectory(value: string): boolean {
    return fs.existsSync(value) && fs.statSync(value).isDirectory();
}

function hasLegendsOutputFiles(dir: string): boolean {
    return fs.existsSync(path.join(dir, "legends.json"))
        && (fs.existsSync(path.join(dir, "index.html")) || fs.existsSync(path.join(dir, "legends.html")));
}

function findLatestLegendsOutput(rootDir: string): string | undefined {
    const root = path.resolve(rootDir);
    if (!isDirectory(root)) return undefined;

    const candidates: CandidateSource[] = [];
    const pending = [root];
    while (pending.length > 0) {
        const current = pending.pop()!;
        if (hasLegendsOutputFiles(current)) {
            const htmlPath = fs.existsSync(path.join(current, "index.html"))
                ? path.join(current, "index.html")
                : path.join(current, "legends.html");
            candidates.push({dir: current, mtimeMs: fs.statSync(htmlPath).mtimeMs});
        }

        for (let entry of fs.readdirSync(current, {withFileTypes: true})) {
            if (!entry.isDirectory()) continue;
            pending.push(path.join(current, entry.name));
        }
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.dir.localeCompare(b.dir));
    return candidates[0]?.dir;
}

function scriptJsonPattern(): RegExp {
    return /(<script id="legends-data" type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/;
}

function parseViewerDataFromHtml(htmlPath: string): any | undefined {
    if (!fs.existsSync(htmlPath)) return undefined;
    const html = fs.readFileSync(htmlPath, "utf8");
    const match = html.match(scriptJsonPattern());
    if (!match || !match[2].trim()) return undefined;
    return JSON.parse(match[2]);
}

function loadRunData(dir: string): any {
    const indexData = parseViewerDataFromHtml(path.join(dir, "index.html"));
    if (indexData) return indexData;
    const legendsData = parseViewerDataFromHtml(path.join(dir, "legends.html"));
    if (legendsData) return legendsData;

    const legendsPath = path.join(dir, "legends.json");
    if (!fs.existsSync(legendsPath)) throw new Error(`Missing legends.json in ${dir}`);
    return JSON.parse(fs.readFileSync(legendsPath, "utf8"));
}

function numeric(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function seedFromData(data: any, override?: number): number {
    const seed = override
        ?? numeric(data?.provenance?.civilizationSeed)
        ?? numeric(data?.provenance?.options?.seed);
    if (!seed) throw new Error("Could not infer civilization seed; pass --seed <seed>");
    return seed;
}

function two(value: number): string {
    return String(value).padStart(2, "0");
}

function timestampRunId(date: Date, seed: number): string {
    const year = two(date.getFullYear() % 100);
    const month = two(date.getMonth() + 1);
    const day = two(date.getDate());
    const hour = two(date.getHours());
    const minute = two(date.getMinutes());
    const seedLabel = String(seed).padStart(3, "0");
    return `sim-${year}-${month}-${day}-${hour}-${minute}-seed-${seedLabel}`;
}

function assertSafeRunName(name: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        throw new Error(`Run name "${name}" must contain only letters, numbers, dots, underscores, or hyphens`);
    }
    if (name === "." || name === "..") throw new Error(`Invalid run name "${name}"`);
    return name;
}

function copyOrMoveDirectory(sourceDir: string, destinationDir: string, options: PublishOptions) {
    if (fs.existsSync(destinationDir)) {
        if (!options.overwrite) throw new Error(`Destination already exists: ${destinationDir}. Pass --overwrite to replace it.`);
        fs.rmSync(destinationDir, {recursive: true, force: true});
    }

    fs.mkdirSync(path.dirname(destinationDir), {recursive: true});
    if (options.copy) {
        fs.cpSync(sourceDir, destinationDir, {recursive: true});
        return;
    }

    try {
        fs.renameSync(sourceDir, destinationDir);
    } catch (error: any) {
        if (error?.code !== "EXDEV") throw error;
        fs.cpSync(sourceDir, destinationDir, {recursive: true});
        fs.rmSync(sourceDir, {recursive: true, force: true});
    }
}

function resolveMapPath(sourceDir: string, data: any): string | undefined {
    const imagePath = typeof data?.viewerMap?.imagePath === "string" ? data.viewerMap.imagePath : undefined;
    const candidates = [
        imagePath ? path.resolve(sourceDir, imagePath) : undefined,
        path.join(sourceDir, "map.png"),
        path.join(sourceDir, "world.png"),
        path.resolve(sourceDir, "../legends-map.png"),
    ].filter(Boolean) as string[];
    return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function assertPublishPngSize(source: Buffer, label: string): {width: number; height: number} {
    const image = PNG.sync.read(source);
    if (image.width !== publishMapSize || image.height !== publishMapSize) {
        throw new Error(`${label} must already be ${publishMapSize}x${publishMapSize}; found ${image.width}x${image.height}. Regenerate the export with --size ${publishMapSize} instead of publishing an upscaled image.`);
    }
    return {width: image.width, height: image.height};
}

function writePublishPngBuffer(source: Buffer, destinationPath: string, label: string): {width: number; height: number} {
    const size = assertPublishPngSize(source, label);
    fs.mkdirSync(path.dirname(destinationPath), {recursive: true});
    fs.writeFileSync(destinationPath, source);
    return size;
}

function writePublishPng(sourcePath: string, destinationPath: string, label: string): {width: number; height: number} {
    return writePublishPngBuffer(fs.readFileSync(sourcePath), destinationPath, label);
}

function findFramePaths(dir: string): string[] {
    if (!isDirectory(dir)) return [];
    return fs.readdirSync(dir)
        .filter(name => /^year-\d+\.png$/i.test(name) || name.toLowerCase().endsWith(".png"))
        .sort()
        .map(name => path.join(dir, name))
        .filter(filePath => fs.statSync(filePath).isFile());
}

function detectFramePaths(destinationDir: string, options: PublishOptions): string[] {
    if (options.framesDir) return findFramePaths(path.resolve(options.framesDir));

    const candidates = [
        path.join(destinationDir, "snapshots", "maps"),
        path.join(destinationDir, "snapshot", "maps"),
        path.join(destinationDir, "maps"),
    ];
    for (let candidate of candidates) {
        const frames = findFramePaths(candidate);
        if (frames.length > 0) return frames;
    }
    return [];
}

function prepareFrames(framePaths: string[], mapPath: string, destinationDir: string): number {
    const mapsDir = path.join(destinationDir, "snapshots", "maps");
    const sourceBuffers = (framePaths.length > 0 ? framePaths : [mapPath])
        .map(framePath => ({name: path.basename(framePath), buffer: fs.readFileSync(framePath)}));

    fs.rmSync(mapsDir, {recursive: true, force: true});
    fs.mkdirSync(mapsDir, {recursive: true});

    for (let index = 0; index < sourceBuffers.length; index++) {
        const framePath = path.join(mapsDir, `year-${String(index).padStart(3, "0")}.png`);
        writePublishPngBuffer(sourceBuffers[index].buffer, framePath, `Frame ${sourceBuffers[index].name}`);
    }
    return sourceBuffers.length;
}

function ensureGif(destinationDir: string, frameCount: number, fps: number) {
    const mapsDir = path.join(destinationDir, "snapshots", "maps");
    const gifPath = path.join(destinationDir, "map.gif");
    writeSnapshotGif(mapsDir, gifPath, fps);
    fs.copyFileSync(gifPath, path.join(destinationDir, "world.gif"));
    console.log(`Prepared ${frameCount} GIF frame${frameCount === 1 ? "" : "s"}`);
}

function escapeJsonForHtml(json: string): string {
    return json
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

function rewriteViewerMapPath(viewerPath: string) {
    if (!fs.existsSync(viewerPath)) return;
    const html = fs.readFileSync(viewerPath, "utf8");
    const match = html.match(scriptJsonPattern());
    if (!match || !match[2].trim()) return;

    const data = JSON.parse(match[2]);
    data.viewerMap = {imagePath: "map.png"};
    const replacement = `${match[1]}${escapeJsonForHtml(JSON.stringify(data))}${match[3]}`;
    fs.writeFileSync(viewerPath, html.replace(scriptJsonPattern(), replacement));
}

function renameViewerIndex(destinationDir: string): string {
    const indexPath = path.join(destinationDir, "index.html");
    const legendsPath = path.join(destinationDir, "legends.html");
    if (fs.existsSync(indexPath)) {
        if (fs.existsSync(legendsPath)) fs.rmSync(legendsPath, {force: true});
        fs.renameSync(indexPath, legendsPath);
    }
    if (!fs.existsSync(legendsPath)) throw new Error(`Missing Legends viewer index.html or legends.html in ${destinationDir}`);
    rewriteViewerMapPath(legendsPath);
    return legendsPath;
}

function defaultTitle(data: any, seed: number): string {
    const names = Array.isArray(data?.civilizations)
        ? data.civilizations.map((civ: any) => civ?.name).filter((name: unknown): name is string => typeof name === "string" && name.length > 0)
        : [];
    if (names.length === 1) return `${names[0]} Simulation`;
    if (names.length > 1) return `${names.slice(0, 2).join(" and ")} Simulation`;
    return `Seed ${String(seed).padStart(3, "0")} Simulation`;
}

function countValue(data: any, key: string, fallbackArray?: string): number {
    const direct = numeric(data?.[key]);
    if (direct !== undefined) return direct;
    const fallback = fallbackArray ? data?.[fallbackArray] : undefined;
    return Array.isArray(fallback) ? fallback.length : 0;
}

function buildMetadata(id: string, data: any, seed: number, title: string, publishedAt: string): RunMetadata {
    const endYear = numeric(data?.provenance?.simulatedYear)
        ?? numeric(data?.year)
        ?? numeric(data?.provenance?.options?.years)
        ?? 0;
    const startYear = 0;

    return {
        id,
        title,
        publishedAt,
        simulationRange: `Year ${startYear} to ${endYear}`,
        startYear,
        endYear,
        seed,
        terrainSeed: numeric(data?.provenance?.terrainSeed),
        meshSeed: numeric(data?.provenance?.meshSeed),
        summary: {
            civilizations: countValue(data, "civilizationCount", "civilizations"),
            settlements: countValue(data, "settlementCount", "settlements"),
            people: countValue(data, "personCount", "people"),
            events: countValue(data, "eventCount", "events"),
            storyHooks: countValue(data, "storyHookCount", "storyHooks"),
        },
        assets: {
            landing: "index.html",
            legends: "legends.html",
            map: "map.png",
            mapGif: "map.gif",
            worldGif: "world.gif",
            legendsJson: "legends.json",
        },
    };
}

function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function metric(label: string, value: number | undefined): string {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></div>`;
}

function runLandingHtml(metadata: RunMetadata): string {
    const summary = metadata.summary;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(metadata.title)}</title>
<style>
:root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; background: #f7f8f6; color: #1d2320; }
body { margin: 0; }
a { color: #1f6670; text-decoration: none; }
a:hover { text-decoration: underline; }
.shell { max-width: 1360px; margin: 0 auto; padding: 28px; container-type: inline-size; }
.topbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 22px; }
.back { font-size: 14px; color: #4f5c58; }
h1 { font-size: 42px; line-height: 1.05; margin: 0; letter-spacing: 0; }
.deck { max-width: 760px; color: #4f5c58; line-height: 1.5; margin: 10px 0 0; }
.layout { display: grid; grid-template-columns: minmax(420px, 640px) minmax(320px, 1fr); gap: 24px; align-items: start; margin-top: 24px; }
.world { margin: 0; }
.world img { width: 100%; max-width: 640px; aspect-ratio: 1 / 1; object-fit: cover; border: 1px solid #cbd5d0; background: #d8dfdb; display: block; }
.panel { border: 1px solid #cbd5d0; background: #ffffff; border-radius: 8px; padding: 16px; }
.panel h2 { font-size: 18px; margin: 0 0 12px; }
.metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.metric { border: 1px solid #d9e0dc; border-radius: 6px; padding: 10px; background: #fbfcfb; min-width: 0; }
.metric span { display: block; color: #60706b; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
.metric strong { font-size: 21px; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.button { border: 1px solid #8aa09a; border-radius: 6px; padding: 9px 11px; background: #edf4f1; color: #163f45; font-weight: 600; }
.facts { display: grid; gap: 8px; color: #3d4945; }
.facts div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e2e7e4; padding-bottom: 8px; }
.facts div:last-child { border-bottom: 0; padding-bottom: 0; }
.facts span { color: #60706b; }
@container (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
@media (max-width: 980px) { .layout { grid-template-columns: 1fr; } h1 { font-size: 32px; } .shell { padding: 20px; } }
</style>
</head>
<body>
<div class="shell">
<div class="topbar"><a class="back" href="../">Published simulations</a><span class="back">${escapeHtml(metadata.id)}</span></div>
<header>
<h1>${escapeHtml(metadata.title)}</h1>
<p class="deck">${escapeHtml(metadata.simulationRange)}. Seed ${escapeHtml(metadata.seed)} with ${escapeHtml(summary.civilizations)} civilization${summary.civilizations === 1 ? "" : "s"}, ${escapeHtml(summary.settlements)} settlement${summary.settlements === 1 ? "" : "s"}, ${escapeHtml(summary.people)} people, and ${escapeHtml(summary.events)} recorded events.</p>
</header>
<div class="layout">
<figure class="world"><img src="map.gif" alt="World timeline GIF"></figure>
<div class="panel">
<h2>Summary</h2>
<div class="metrics">
${metric("Years", metadata.endYear - metadata.startYear)}
${metric("Civilizations", summary.civilizations)}
${metric("Settlements", summary.settlements)}
${metric("People", summary.people)}
${metric("Events", summary.events)}
${metric("Story hooks", summary.storyHooks)}
</div>
<div class="actions">
<a class="button" href="legends.html">Open Legends Viewer</a>
<a class="button" href="map.png">Map PNG</a>
<a class="button" href="map.gif">Map GIF</a>
<a class="button" href="legends.json">Legends JSON</a>
</div>
</div>
<div class="panel">
<h2>Run Details</h2>
<div class="facts">
<div><span>Range</span><strong>${escapeHtml(metadata.simulationRange)}</strong></div>
<div><span>Civilization seed</span><strong>${escapeHtml(metadata.seed)}</strong></div>
<div><span>Terrain seed</span><strong>${escapeHtml(metadata.terrainSeed ?? "unknown")}</strong></div>
<div><span>Mesh seed</span><strong>${escapeHtml(metadata.meshSeed ?? "unknown")}</strong></div>
<div><span>Published</span><strong>${escapeHtml(metadata.publishedAt)}</strong></div>
</div>
</div>
</div>
</div>
</body>
</html>
`;
}

function publishedIndexHtml(runs: RunMetadata[]): string {
    const items = runs.map(run => {
        const summary = run.summary;
        return `<article class="run">
<a class="thumb" href="${escapeHtml(run.id)}/"><img src="${escapeHtml(run.id)}/map.png" alt="${escapeHtml(run.title)} map"></a>
<div>
<h2><a href="${escapeHtml(run.id)}/">${escapeHtml(run.title)}</a></h2>
<p>${escapeHtml(run.simulationRange)} - seed ${escapeHtml(run.seed)} - ${escapeHtml(summary.civilizations)} civs - ${escapeHtml(summary.people)} people - ${escapeHtml(summary.events)} events</p>
<div class="links"><a href="${escapeHtml(run.id)}/legends.html">Legends</a><a href="${escapeHtml(run.id)}/map.gif">GIF</a><a href="${escapeHtml(run.id)}/legends.json">JSON</a></div>
</div>
</article>`;
    }).join("\n");

    const body = runs.length > 0
        ? items
        : `<p class="empty">No simulations have been published yet.</p>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Published Simulations</title>
<style>
:root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; background: #f7f8f6; color: #1d2320; }
body { margin: 0; }
a { color: #1f6670; text-decoration: none; }
a:hover { text-decoration: underline; }
.shell { max-width: 1100px; margin: 0 auto; padding: 30px; }
h1 { font-size: 38px; margin: 0 0 8px; letter-spacing: 0; }
.deck { color: #4f5c58; margin: 0 0 22px; }
.list { display: grid; gap: 14px; }
.run { display: grid; grid-template-columns: 132px 1fr; gap: 16px; align-items: center; border: 1px solid #cbd5d0; background: #ffffff; border-radius: 8px; padding: 12px; }
.thumb img { width: 132px; height: 132px; object-fit: cover; display: block; background: #d8dfdb; }
h2 { font-size: 20px; margin: 0 0 6px; }
p { line-height: 1.45; }
.run p { margin: 0; color: #4f5c58; }
.links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.links a { border: 1px solid #8aa09a; border-radius: 6px; padding: 6px 8px; background: #edf4f1; font-size: 14px; }
.empty { border: 1px solid #cbd5d0; background: #ffffff; border-radius: 8px; padding: 18px; color: #4f5c58; }
@media (max-width: 620px) { .shell { padding: 20px; } .run { grid-template-columns: 1fr; } .thumb img { width: 100%; height: auto; aspect-ratio: 1 / 1; } }
</style>
</head>
<body>
<div class="shell">
<h1>Published Simulations</h1>
<p class="deck">Static Legends Viewer exports ready for GitHub Pages.</p>
<div class="list">
${body}
</div>
</div>
</body>
</html>
`;
}

function writeRunMetadata(destinationDir: string, metadata: RunMetadata) {
    fs.writeFileSync(path.join(destinationDir, "run.json"), JSON.stringify(metadata, null, 2));
    fs.writeFileSync(path.join(destinationDir, "index.html"), runLandingHtml(metadata));
}

export function refreshPublishedIndex(publishedDir = defaultPublishedDir) {
    const root = path.resolve(publishedDir);
    fs.mkdirSync(root, {recursive: true});
    fs.writeFileSync(path.join(root, ".nojekyll"), "");

    const runs = fs.readdirSync(root, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(root, entry.name, "run.json"))
        .filter(filePath => fs.existsSync(filePath))
        .map(filePath => JSON.parse(fs.readFileSync(filePath, "utf8")) as RunMetadata)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));

    fs.writeFileSync(path.join(root, "index.html"), publishedIndexHtml(runs));
    console.log(`Wrote ${path.join(root, "index.html")}`);
}

export function runPublishLegendsCommand(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const sourceDir = path.resolve(options.sourceDir ?? findLatestLegendsOutput(defaultOutputRoot) ?? "");
    if (!sourceDir || !isDirectory(sourceDir) || !hasLegendsOutputFiles(sourceDir)) {
        throw new Error(`Could not find a Legends output directory. Pass --from <dir> or generate one first.`);
    }

    const data = loadRunData(sourceDir);
    const seed = seedFromData(data, options.seed);
    const runId = assertSafeRunName(options.runName ?? timestampRunId(new Date(), seed));
    const destinationDir = path.join(path.resolve(options.publishedDir), runId);
    const externalMapPath = resolveMapPath(sourceDir, data);
    if (!externalMapPath) throw new Error(`Could not find a source map PNG for ${sourceDir}`);
    const mapRelativeToSource = path.relative(sourceDir, externalMapPath);

    copyOrMoveDirectory(sourceDir, destinationDir, options);
    const legendsPath = renameViewerIndex(destinationDir);
    console.log(`Prepared Legends viewer at ${legendsPath}`);

    const mapPath = path.join(destinationDir, "map.png");
    const movedMapPath = !mapRelativeToSource.startsWith("..") && !path.isAbsolute(mapRelativeToSource)
        ? path.join(destinationDir, mapRelativeToSource)
        : externalMapPath;
    const mapSourcePath = fs.existsSync(mapPath) ? mapPath : movedMapPath;
    const mapStats = writePublishPng(mapSourcePath, mapPath, "Map PNG");
    console.log(`Verified map.png at ${mapStats.width}x${mapStats.height}`);

    const frameCount = prepareFrames(detectFramePaths(destinationDir, options), mapPath, destinationDir);
    ensureGif(destinationDir, frameCount, options.gifFps);

    const title = options.title ?? defaultTitle(data, seed);
    const metadata = buildMetadata(runId, data, seed, title, new Date().toISOString());
    writeRunMetadata(destinationDir, metadata);
    refreshPublishedIndex(options.publishedDir);

    console.log(`Published ${sourceDir} to ${destinationDir}`);
}
