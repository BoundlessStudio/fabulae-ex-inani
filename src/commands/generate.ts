import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {PNG} from "pngjs";
import {
    defaultControlValues,
    isKnownControl,
    isUnlockedControl,
    mergeControlOverrides,
    unlockedControlKeys,
    type ControlOverrides,
} from "../mapgen/map-controls.ts";
import {generateWorldMap} from "../mapgen/node-mapgen.ts";
import {renderWorldMapPng} from "../rendering/cpu-renderer.ts";
import {
    defaultCivilizationWorkerCount,
    exportLegends,
    legendEventDescription,
    legendEventHeadline,
    simulateCivilizations,
    summarizeCivilizations,
    type CivilizationOptions,
    type CivilizationProgress,
    type CivilizationRunOptions,
    type CivilizationSimulation,
    type LegendEntityRef,
    type LegendsExport,
    type StoryHookKind,
} from "../simulation/civilizations.ts";

const defaultEventRefNameRetentionYears = 30;
const defaultEventRefCompactionIntervalYears = 5;

type CliOptions = {
    out: string;
    width: number;
    height: number;
    controls: ControlOverrides;
    summary: boolean;
    civilizations: number;
    civilizationWorkers?: number;
    civilizationYears: number;
    civilizationSeed: number;
    expansionRate?: number;
    settlementInterval?: number;
    settlementClaimRadius?: number;
    capitalClaimRadius?: number;
    civilizationJson?: string;
    civilizationProfileJson?: string;
    civilizationProfileDir?: string;
    legendsJson?: string;
    legendsHtml?: string;
    snapshotDir?: string;
    snapshotEvery: number;
    snapshotRenderEvery: number;
    snapshotGif?: string;
    snapshotGifFps: number;
    progressEvery: number;
    compactEventRefNamesAfter: number;
    compactEventRefsEvery: number;
    spillEventTextDir?: string;
    spillEventTextAfter: number;
    spillEventTextEvery: number;
    spillEventTextCacheChunks: number;
    compactNewEventRefs: boolean;
    gcAfterCompaction: boolean;
    profileCivilizationPhases: boolean;
};

export function printGenerateHelp() {
    console.log(`Fabulae Ex Inani
Stories from the Void

Usage:
  world-mapgen [command] [options]
  world-mapgen generate [options]
  npm run generate -- [options]

Commands:
  generate                 Generate a PNG map. This is the default command.
  serve-legends            Serve a generated Legends viewer directory.
  verify-legends           Verify a Legends archive and optional viewer output.
  compare-civ-profiles     Compare two civilization profile JSON files.
  evaluate-story-hooks     Evaluate generated story hooks.
  outline-stories          Create story outlines from story-hook report cards.
  clean                    Remove generated build artifacts.

Options:
  --out <png>                 Output PNG path. Defaults to output/mapgen4.png
  --width <pixels>            Output width. Defaults to 2048
  --height <pixels>           Output height. Defaults to width
  --size <pixels>             Set width and height together
  --controls <json>           JSON file with control overrides
  --set <phase.name=value>    Override one control value; can be repeated
                              Allowed: ${unlockedControlKeys.join(", ")}
  --civilizations <count>     Add civilization simulation overlay
  --civ-workers <count>       Civilization worker threads.
                              Defaults to civilization count; use 1 for debug
  --years <years>             Advance civilization simulation by years
  --civ-seed <seed>           Civilization simulation seed. Defaults to 1
  --expansion-rate <rate>     Expected town-founding attempts per civ per 100 years
  --settlement-interval <years>
                              Years between town-founding opportunities
  --claim-radius <distance>   Settlement territory claim distance
  --capital-claim-radius <distance>
                              Capital territory claim distance
  --civ-json <json>           Write civilization summary JSON
  --civ-profile-json <json>   Write compact civilization count/memory profile JSON
  --civ-profile-dir <dir>     Write compact profile JSON at each --progress-every checkpoint
  --legends-json <json>       Write detailed Legends archive JSON
  --legends-html <html>       Write browser-friendly sampled Legends viewer
                              Use --legends-json for the full archive
  --snapshot-dir <dir>        Write annual civilization snapshots and map frames
  --snapshot-every <years>    Snapshot JSON interval. Defaults to 1 with --snapshot-dir
  --snapshot-render-every <years>
                              PNG frame interval. Defaults to 25 with --snapshot-dir
  --snapshot-gif <gif>        Write an animated GIF from rendered snapshot frames
  --snapshot-gif-fps <fps>    Snapshot GIF playback speed. Defaults to 8
  --progress-every <years>    Log long-run civilization progress. Disabled by default
  --compact-event-ref-names-after <years>
                              Drop display names from older event refs; keeps kind/id lookup data.
                              Defaults to ${defaultEventRefNameRetentionYears}; use 0 to disable
  --compact-event-refs-every <years>
                              Run old-event ref compaction every N simulated years.
                              Defaults to ${defaultEventRefCompactionIntervalYears}; use 0 to disable periodic compaction
  --spill-event-text-dir <dir>
                              Write old event headline/description text to chunk files and lazy-load it.
                              Intended for long stress/profile runs, not full Legends exports
  --spill-event-text-after <years>
                              Spill old event headline/description text after the retention window.
                              Off by default; intended for long stress/profile runs, not full Legends exports
  --spill-event-text-every <years>
                              Run old-event text spilling every N simulated years.
                              Defaults to --compact-event-refs-every when spilling is enabled
  --spill-event-text-cache-chunks <count>
                              LRU cache size for spilled event text chunks.
                              Defaults to 128 when spilling is enabled
  --compact-new-event-refs    Compact high-volume event refs as they are created.
                              Faster in some runs, but can raise peak heap; off by default
  --gc-after-compaction       Request a garbage collection after ref compaction checkpoints.
                              Requires running node with --expose-gc
  --profile-civ-phases        Include per-year civilization phase timings in progress logs/profiles
  --summary                   Print generated map statistics
  --help                      Show this help

Examples:
  npm run generate
  npm run generate -- --out output/seed-42.png --set elevation.seed=42
  npm run generate -- --civilizations 5 --years 300 --civ-json output/civilizations.json
  npm run generate -- --size 1024 --controls examples/controls/mapgen4-controls.json
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

function parsePositiveNumber(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive number, got "${value}"`);
    }
    return parsed;
}

function parseNonNegativeInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer, got "${value}"`);
    }
    return parsed;
}

function setControlOverride(overrides: ControlOverrides, assignment: string) {
    const equals = assignment.indexOf("=");
    const dot = assignment.indexOf(".");
    if (equals < 0 || dot < 1 || dot > equals) {
        throw new Error(`Invalid --set value "${assignment}". Expected phase.name=value`);
    }

    const phase = assignment.slice(0, dot);
    const name = assignment.slice(dot + 1, equals);
    const value = Number(assignment.slice(equals + 1));
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid numeric value in --set "${assignment}"`);
    }
    if (!isKnownControl(phase, name)) {
        throw new Error(`Unknown control "${phase}.${name}"`);
    }
    if (!isUnlockedControl(phase, name)) {
        throw new Error(`Control "${phase}.${name}" is locked. Allowed controls: ${unlockedControlKeys.join(", ")}`);
    }

    overrides[phase] ??= {};
    overrides[phase]![name] = value;
}

function parseArgs(argv: string[]): CliOptions {
    let options: CliOptions = {
        out: "output/mapgen4.png",
        width: 2048,
        height: 2048,
        controls: {},
        summary: false,
        civilizations: 0,
        civilizationWorkers: undefined,
        civilizationYears: 0,
        civilizationSeed: 1,
        expansionRate: undefined,
        settlementInterval: undefined,
        snapshotEvery: 0,
        snapshotRenderEvery: 25,
        snapshotGifFps: 8,
        progressEvery: 0,
        compactEventRefNamesAfter: defaultEventRefNameRetentionYears,
        compactEventRefsEvery: defaultEventRefCompactionIntervalYears,
        spillEventTextAfter: 0,
        spillEventTextEvery: 0,
        spillEventTextCacheChunks: 0,
        compactNewEventRefs: false,
        gcAfterCompaction: false,
        profileCivilizationPhases: false,
    };
    let civilizationsSpecified = false;
    let yearsSpecified = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            printGenerateHelp();
            process.exit(0);
        } else if (arg === "--out" || arg.startsWith("--out=")) {
            const result = readValue(argv, i, "--out");
            options.out = result.value;
            i = result.nextIndex;
        } else if (arg === "--width" || arg.startsWith("--width=")) {
            const result = readValue(argv, i, "--width");
            options.width = parsePositiveInteger(result.value, "--width");
            i = result.nextIndex;
        } else if (arg === "--height" || arg.startsWith("--height=")) {
            const result = readValue(argv, i, "--height");
            options.height = parsePositiveInteger(result.value, "--height");
            i = result.nextIndex;
        } else if (arg === "--size" || arg.startsWith("--size=")) {
            const result = readValue(argv, i, "--size");
            options.width = options.height = parsePositiveInteger(result.value, "--size");
            i = result.nextIndex;
        } else if (arg === "--controls" || arg.startsWith("--controls=")) {
            const result = readValue(argv, i, "--controls");
            const controlsPath = path.resolve(result.value);
            options.controls = mergeControlOverrides(
                options.controls,
                JSON.parse(fs.readFileSync(controlsPath, "utf8")) as ControlOverrides,
            );
            i = result.nextIndex;
        } else if (arg === "--civilizations" || arg === "--civs" || arg.startsWith("--civilizations=") || arg.startsWith("--civs=")) {
            const optionName = arg.startsWith("--civs") ? "--civs" : "--civilizations";
            const result = readValue(argv, i, optionName);
            options.civilizations = parseNonNegativeInteger(result.value, optionName);
            civilizationsSpecified = true;
            i = result.nextIndex;
        } else if (arg === "--years" || arg === "--civilization-years" || arg.startsWith("--years=") || arg.startsWith("--civilization-years=")) {
            const optionName = arg.startsWith("--civilization-years") ? "--civilization-years" : "--years";
            const result = readValue(argv, i, optionName);
            options.civilizationYears = parseNonNegativeInteger(result.value, optionName);
            yearsSpecified = true;
            i = result.nextIndex;
        } else if (arg === "--civ-seed" || arg === "--civilization-seed" || arg.startsWith("--civ-seed=") || arg.startsWith("--civilization-seed=")) {
            const optionName = arg.startsWith("--civilization-seed") ? "--civilization-seed" : "--civ-seed";
            const result = readValue(argv, i, optionName);
            options.civilizationSeed = parsePositiveInteger(result.value, optionName);
            i = result.nextIndex;
        } else if (arg === "--civ-workers" || arg === "--civilization-workers" || arg.startsWith("--civ-workers=") || arg.startsWith("--civilization-workers=")) {
            const optionName = arg.startsWith("--civilization-workers") ? "--civilization-workers" : "--civ-workers";
            const result = readValue(argv, i, optionName);
            options.civilizationWorkers = parsePositiveInteger(result.value, optionName);
            i = result.nextIndex;
        } else if (arg === "--expansion-rate" || arg.startsWith("--expansion-rate=")) {
            const result = readValue(argv, i, "--expansion-rate");
            options.expansionRate = parsePositiveNumber(result.value, "--expansion-rate");
            i = result.nextIndex;
        } else if (arg === "--settlement-interval" || arg.startsWith("--settlement-interval=")) {
            const result = readValue(argv, i, "--settlement-interval");
            options.settlementInterval = parsePositiveInteger(result.value, "--settlement-interval");
            i = result.nextIndex;
        } else if (arg === "--claim-radius" || arg === "--settlement-claim-radius" || arg.startsWith("--claim-radius=") || arg.startsWith("--settlement-claim-radius=")) {
            const optionName = arg.startsWith("--settlement-claim-radius") ? "--settlement-claim-radius" : "--claim-radius";
            const result = readValue(argv, i, optionName);
            options.settlementClaimRadius = parsePositiveNumber(result.value, optionName);
            i = result.nextIndex;
        } else if (arg === "--capital-claim-radius" || arg.startsWith("--capital-claim-radius=")) {
            const result = readValue(argv, i, "--capital-claim-radius");
            options.capitalClaimRadius = parsePositiveNumber(result.value, "--capital-claim-radius");
            i = result.nextIndex;
        } else if (arg === "--civ-json" || arg === "--civilization-json" || arg.startsWith("--civ-json=") || arg.startsWith("--civilization-json=")) {
            const optionName = arg.startsWith("--civilization-json") ? "--civilization-json" : "--civ-json";
            const result = readValue(argv, i, optionName);
            options.civilizationJson = result.value;
            i = result.nextIndex;
        } else if (arg === "--civ-profile-json" || arg === "--civilization-profile-json" || arg.startsWith("--civ-profile-json=") || arg.startsWith("--civilization-profile-json=")) {
            const optionName = arg.startsWith("--civilization-profile-json") ? "--civilization-profile-json" : "--civ-profile-json";
            const result = readValue(argv, i, optionName);
            options.civilizationProfileJson = result.value;
            i = result.nextIndex;
        } else if (arg === "--civ-profile-dir" || arg === "--civilization-profile-dir" || arg.startsWith("--civ-profile-dir=") || arg.startsWith("--civilization-profile-dir=")) {
            const optionName = arg.startsWith("--civilization-profile-dir") ? "--civilization-profile-dir" : "--civ-profile-dir";
            const result = readValue(argv, i, optionName);
            options.civilizationProfileDir = result.value;
            i = result.nextIndex;
        } else if (arg === "--legends-json" || arg.startsWith("--legends-json=")) {
            const result = readValue(argv, i, "--legends-json");
            options.legendsJson = result.value;
            i = result.nextIndex;
        } else if (arg === "--legends-html" || arg.startsWith("--legends-html=")) {
            const result = readValue(argv, i, "--legends-html");
            options.legendsHtml = result.value;
            i = result.nextIndex;
        } else if (arg === "--snapshot-dir" || arg.startsWith("--snapshot-dir=")) {
            const result = readValue(argv, i, "--snapshot-dir");
            options.snapshotDir = result.value;
            i = result.nextIndex;
        } else if (arg === "--snapshot-every" || arg.startsWith("--snapshot-every=")) {
            const result = readValue(argv, i, "--snapshot-every");
            options.snapshotEvery = parsePositiveInteger(result.value, "--snapshot-every");
            i = result.nextIndex;
        } else if (arg === "--snapshot-render-every" || arg.startsWith("--snapshot-render-every=")) {
            const result = readValue(argv, i, "--snapshot-render-every");
            options.snapshotRenderEvery = parsePositiveInteger(result.value, "--snapshot-render-every");
            i = result.nextIndex;
        } else if (arg === "--snapshot-gif" || arg.startsWith("--snapshot-gif=")) {
            const result = readValue(argv, i, "--snapshot-gif");
            options.snapshotGif = result.value;
            i = result.nextIndex;
        } else if (arg === "--snapshot-gif-fps" || arg.startsWith("--snapshot-gif-fps=")) {
            const result = readValue(argv, i, "--snapshot-gif-fps");
            options.snapshotGifFps = parsePositiveInteger(result.value, "--snapshot-gif-fps");
            i = result.nextIndex;
        } else if (arg === "--progress-every" || arg.startsWith("--progress-every=")) {
            const result = readValue(argv, i, "--progress-every");
            options.progressEvery = parseNonNegativeInteger(result.value, "--progress-every");
            i = result.nextIndex;
        } else if (arg === "--compact-event-ref-names-after" || arg.startsWith("--compact-event-ref-names-after=")) {
            const result = readValue(argv, i, "--compact-event-ref-names-after");
            options.compactEventRefNamesAfter = parseNonNegativeInteger(result.value, "--compact-event-ref-names-after");
            i = result.nextIndex;
        } else if (arg === "--compact-event-refs-every" || arg.startsWith("--compact-event-refs-every=")) {
            const result = readValue(argv, i, "--compact-event-refs-every");
            options.compactEventRefsEvery = parseNonNegativeInteger(result.value, "--compact-event-refs-every");
            i = result.nextIndex;
        } else if (arg === "--spill-event-text-dir" || arg.startsWith("--spill-event-text-dir=")) {
            const result = readValue(argv, i, "--spill-event-text-dir");
            options.spillEventTextDir = result.value;
            i = result.nextIndex;
        } else if (arg === "--spill-event-text-after" || arg.startsWith("--spill-event-text-after=")) {
            const result = readValue(argv, i, "--spill-event-text-after");
            options.spillEventTextAfter = parseNonNegativeInteger(result.value, "--spill-event-text-after");
            i = result.nextIndex;
        } else if (arg === "--spill-event-text-every" || arg.startsWith("--spill-event-text-every=")) {
            const result = readValue(argv, i, "--spill-event-text-every");
            options.spillEventTextEvery = parseNonNegativeInteger(result.value, "--spill-event-text-every");
            i = result.nextIndex;
        } else if (arg === "--spill-event-text-cache-chunks" || arg.startsWith("--spill-event-text-cache-chunks=")) {
            const result = readValue(argv, i, "--spill-event-text-cache-chunks");
            options.spillEventTextCacheChunks = parsePositiveInteger(result.value, "--spill-event-text-cache-chunks");
            i = result.nextIndex;
        } else if (arg === "--compact-new-event-refs") {
            options.compactNewEventRefs = true;
        } else if (arg === "--gc-after-compaction") {
            options.gcAfterCompaction = true;
        } else if (arg === "--profile-civ-phases" || arg === "--profile-civilization-phases") {
            options.profileCivilizationPhases = true;
        } else if (arg === "--set" || arg.startsWith("--set=")) {
            const result = readValue(argv, i, "--set");
            setControlOverride(options.controls, result.value);
            i = result.nextIndex;
        } else if (arg === "--summary") {
            options.summary = true;
        } else if (arg.includes(".") && arg.includes("=")) {
            setControlOverride(options.controls, arg);
        } else if (arg.toLowerCase().endsWith(".png")) {
            options.out = arg;
        } else if (arg.toLowerCase().endsWith(".json")) {
            options.controls = mergeControlOverrides(
                options.controls,
                JSON.parse(fs.readFileSync(path.resolve(arg), "utf8")) as ControlOverrides,
            );
        } else if (/^\d+$/.test(arg)) {
            options.width = options.height = parsePositiveInteger(arg, "size");
        } else {
            throw new Error(`Unknown option "${arg}"`);
        }
    }

    if (options.height === 2048 && options.width !== 2048) {
        options.height = options.width;
    }
    if (options.civilizations > 0 && !yearsSpecified) {
        options.civilizationYears = 250;
    }
    if (options.civilizationYears > 0 && options.civilizations === 0 && !civilizationsSpecified) {
        options.civilizations = 5;
    }
    if (options.snapshotDir && options.snapshotEvery === 0) {
        options.snapshotEvery = 1;
    }
    if (options.snapshotDir && options.civilizations === 0 && !civilizationsSpecified) {
        options.civilizations = 5;
    }
    if (options.snapshotDir && options.civilizationYears === 0 && !yearsSpecified) {
        options.civilizationYears = 100;
    }
    if (options.snapshotGif && !options.snapshotDir) {
        throw new Error("--snapshot-gif requires --snapshot-dir so frame PNGs can be rendered first");
    }
    if (options.civilizationProfileDir && options.progressEvery === 0) {
        throw new Error("--civ-profile-dir requires --progress-every so checkpoint years are defined");
    }
    if (options.spillEventTextDir && options.spillEventTextAfter === 0) {
        options.spillEventTextAfter = defaultEventRefNameRetentionYears;
    }
    if (options.spillEventTextAfter > 0 && !options.spillEventTextDir) {
        throw new Error("--spill-event-text-after requires --spill-event-text-dir so text can be lazy-loaded later");
    }
    if (options.spillEventTextAfter > 0 && options.spillEventTextEvery === 0) {
        options.spillEventTextEvery = options.compactEventRefsEvery;
    }
    if (options.spillEventTextAfter > 0 && options.spillEventTextCacheChunks === 0) {
        options.spillEventTextCacheChunks = 128;
    }
    if (process.env.npm_config_summary === "true") {
        options.summary = true;
    }

    return options;
}

function summarize(world: ReturnType<typeof generateWorldMap>, outputPath: string, width: number, height: number, civilizations?: CivilizationSimulation) {
    const landTriangles = Array.from(world.map.elevation_t).filter(e => e >= 0).length;
    const controls = defaultControlValues(world.controls);
    console.log(JSON.stringify({
        output: outputPath,
        width,
        height,
        seed: controls.elevation.seed,
        triangles: world.mesh.numTriangles,
        regions: world.mesh.numRegions,
        landTriangles,
        riverTriangles: Array.from(world.map.flow_s).filter(flow => flow > Math.exp(world.param.rivers.lg_min_flow)).length,
        civilizations: civilizations ? summarizeCivilizations(civilizations) : undefined,
    }, null, 2));
}

function paddedYear(year: number): string {
    return String(year).padStart(3, "0");
}

function snapshotRenderYears(options: CliOptions): number[] {
    const years = new Set<number>();
    for (let year = 0; year <= options.civilizationYears; year += options.snapshotRenderEvery) {
        years.add(year);
    }
    years.add(options.civilizationYears);
    return [...years].sort((a, b) => a - b);
}

function renderSnapshotFrame(
    world: ReturnType<typeof generateWorldMap>,
    options: CliOptions,
    simulation: CivilizationSimulation,
    mapsDir: string,
) {
    const image = renderWorldMapPng(world, {width: options.width, height: options.height, civilizations: simulation});
    const framePath = path.join(mapsDir, `year-${paddedYear(simulation.year)}.png`);
    fs.writeFileSync(framePath, PNG.sync.write(image));
    console.log(`Wrote ${framePath}`);
}

function civilizationOptions(options: CliOptions, years = options.civilizationYears): CivilizationOptions {
    const result: CivilizationOptions = {
        count: options.civilizations,
        seed: options.civilizationSeed,
        years,
    };
    if (options.expansionRate !== undefined) result.expansionRate = options.expansionRate;
    if (options.settlementInterval !== undefined) result.settlementInterval = options.settlementInterval;
    if (options.settlementClaimRadius !== undefined) result.settlementClaimRadius = options.settlementClaimRadius;
    if (options.capitalClaimRadius !== undefined) result.capitalClaimRadius = options.capitalClaimRadius;
    return result;
}

function resolvedCivilizationWorkerCount(options: CliOptions): number {
    return options.civilizationWorkers ?? defaultCivilizationWorkerCount(options.civilizations);
}

function commandExists(command: string): boolean {
    const result = process.platform === "win32"
        ? spawnSync("where.exe", [command], {stdio: "ignore"})
        : spawnSync("sh", ["-lc", `command -v ${command}`], {stdio: "ignore"});
    return result.status === 0;
}

function writeSnapshotGif(mapsDir: string, gifPath: string, fps: number) {
    const outputPath = path.resolve(gifPath);
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});

    if (commandExists("ffmpeg")) {
        const inputPattern = path.join(mapsDir, "year-%03d.png");
        const result = spawnSync("ffmpeg", [
            "-y",
            "-framerate",
            String(fps),
            "-i",
            inputPattern,
            "-vf",
            "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
            outputPath,
        ], {stdio: "inherit"});
        if (result.status !== 0) {
            throw new Error(`ffmpeg failed to write ${outputPath}`);
        }
        console.log(`Wrote ${outputPath}`);
        return;
    }

    if (commandExists("magick")) {
        const framePaths = fs.readdirSync(mapsDir)
            .filter(name => /^year-\d+\.png$/.test(name))
            .sort()
            .map(name => path.join(mapsDir, name));
        if (framePaths.length === 0) {
            throw new Error(`No snapshot PNG frames found in ${mapsDir}`);
        }
        const delay = Math.max(1, Math.round(100 / fps));
        const result = spawnSync("magick", [
            "-delay",
            String(delay),
            "-loop",
            "0",
            ...framePaths,
            outputPath,
        ], {stdio: "inherit"});
        if (result.status !== 0) {
            throw new Error(`ImageMagick failed to write ${outputPath}`);
        }
        console.log(`Wrote ${outputPath}`);
        return;
    }

    throw new Error("Cannot write --snapshot-gif because neither ffmpeg nor ImageMagick magick is available on PATH");
}

function escapeJsonForHtml(json: string): string {
    return json
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

type JsonStreamWriter = {
    fd: number;
    htmlEscape: boolean;
    buffer: string;
};

function writeBufferedJsonChunk(writer: JsonStreamWriter, chunk: string) {
    writer.buffer += chunk;
    if (writer.buffer.length >= 65536) {
        fs.writeSync(writer.fd, writer.buffer);
        writer.buffer = "";
    }
}

function writeJsonPrimitive(writer: JsonStreamWriter, value: string | number | boolean | null) {
    let chunk: string;
    if (typeof value === "string") chunk = JSON.stringify(value);
    else if (typeof value === "number") chunk = Number.isFinite(value) ? String(value) : "null";
    else if (typeof value === "boolean") chunk = value ? "true" : "false";
    else chunk = "null";
    writeBufferedJsonChunk(writer, writer.htmlEscape ? escapeJsonForHtml(chunk) : chunk);
}

function writeJsonValue(writer: JsonStreamWriter, value: unknown) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        writeJsonPrimitive(writer, value as string | number | boolean | null);
        return;
    }
    if (Array.isArray(value)) {
        writeBufferedJsonChunk(writer, "[");
        for (let i = 0; i < value.length; i++) {
            if (i > 0) writeBufferedJsonChunk(writer, ",");
            writeJsonValue(writer, value[i]);
        }
        writeBufferedJsonChunk(writer, "]");
        return;
    }
    if (typeof value === "object") {
        writeBufferedJsonChunk(writer, "{");
        let first = true;
        for (let key of Object.keys(value as Record<string, unknown>)) {
            const entry = (value as Record<string, unknown>)[key];
            if (entry === undefined) continue;
            if (!first) writeBufferedJsonChunk(writer, ",");
            first = false;
            writeJsonPrimitive(writer, key);
            writeBufferedJsonChunk(writer, ":");
            writeJsonValue(writer, entry);
        }
        writeBufferedJsonChunk(writer, "}");
        return;
    }
    writeJsonPrimitive(writer, null);
}

function writeJsonPayload(outputPath: string, value: unknown, htmlEscape = false, prefix = "", suffix = "") {
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    const fd = fs.openSync(outputPath, "w");
    const writer: JsonStreamWriter = {fd, htmlEscape, buffer: ""};
    try {
        if (prefix) writeBufferedJsonChunk(writer, prefix);
        writeJsonValue(writer, value);
        if (suffix) writeBufferedJsonChunk(writer, suffix);
        if (writer.buffer) fs.writeSync(writer.fd, writer.buffer);
    } finally {
        fs.closeSync(fd);
    }
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function legendsViewerHtml(data: string, dataSource?: string): string {
    const dataTag = dataSource
        ? `<script id="legends-data" type="application/json" data-src="${escapeHtmlAttribute(dataSource)}"></script>`
        : `<script id="legends-data" type="application/json">${data}</script>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>World Legends</title>
<style>
:root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; background: #f4f1e8; color: #211f1a; }
body { margin: 0; }
.app { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; height: 100vh; min-height: 100vh; }
aside { border-right: 1px solid #c9c1ae; background: #eee8da; padding: 16px; overflow: auto; }
main { overflow: auto; }
h1 { font-size: 20px; margin: 0 0 12px; }
h2 { font-size: 30px; line-height: 1.12; margin: 0; }
h3 { font-size: 15px; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: #665b49; }
.summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0 16px; }
.metric { background: #faf7ef; border: 1px solid #d8cfbd; border-radius: 6px; padding: 8px; }
.metric strong { display: block; font-size: 18px; }
.sample-note { grid-column: 1 / -1; background: #fff7dc; border: 1px solid #d6ba70; border-radius: 6px; padding: 8px; font-size: 13px; color: #5d4a1b; }
input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #b8ad97; border-radius: 6px; font: inherit; background: #fffdf7; }
.search-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
.search-all { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #b8ad97; border-radius: 6px; background: #faf7ef; padding: 8px; font-size: 13px; white-space: nowrap; }
.search-all input { width: auto; margin: 0; }
.list-note { color: #6f6657; font-size: 13px; margin: 0 0 8px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
a { color: #245c68; text-decoration: none; }
a:hover { text-decoration: underline; }
button { border: 1px solid #aa9d84; border-radius: 6px; background: #faf7ef; padding: 7px 9px; cursor: pointer; }
.tabs a { border: 1px solid #aa9d84; border-radius: 6px; background: #faf7ef; padding: 7px 9px; }
.tabs a.active { background: #2f5e6e; color: white; border-color: #2f5e6e; text-decoration: none; }
.list { display: grid; gap: 6px; }
.item { text-align: left; border: 1px solid #d1c7b4; background: #fffaf0; border-radius: 6px; padding: 9px; color: inherit; }
.item.active { border-color: #2f5e6e; box-shadow: inset 3px 0 0 #2f5e6e; }
.item small { display: block; color: #6f6657; margin-top: 3px; }
.detail { max-width: 1180px; padding: 24px 32px 48px; }
.page-header { border-bottom: 1px solid #d3c8b5; margin-bottom: 14px; padding-bottom: 16px; }
.breadcrumb { color: #6f6657; font-size: 13px; margin-bottom: 8px; }
.page-title-row { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
.record-badge { border: 1px solid #b8ad97; border-radius: 999px; color: #4f473a; background: #faf7ef; font-size: 12px; padding: 5px 8px; white-space: nowrap; }
.deck { color: #4f473a; line-height: 1.5; max-width: 820px; margin: 10px 0 0; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
.pill { background: #e7ddca; border-radius: 999px; padding: 5px 9px; font-size: 13px; }
.pill a { color: inherit; font-weight: 600; }
.key-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
.fact { background: #fffdf7; border: 1px solid #d8cfbd; border-radius: 6px; padding: 8px 10px; min-width: 0; }
.fact span { display: block; color: #6f6657; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
.fact strong { display: block; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.quick-nav { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border-bottom: 1px solid #d3c8b5; margin: 0 0 14px; padding: 0 0 14px; }
.quick-nav a { border: 1px solid #c8bca7; border-radius: 999px; background: #faf7ef; color: #2f5e6e; font-size: 12px; padding: 5px 9px; }
.section-stack { display: grid; gap: 14px; }
.detail-section { background: #fffdf7; border: 1px solid #d8cfbd; border-radius: 8px; padding: 14px 16px; scroll-margin-top: 16px; }
.detail-section > h3:first-child { margin-top: 0; }
.detail-section > h3:last-child { margin-bottom: 0; }
.timeline { border-left: 3px solid #b8ad97; padding-left: 14px; display: grid; gap: 10px; }
.mention-timeline { margin-bottom: 14px; }
.event { background: #fffaf0; border: 1px solid #d1c7b4; border-radius: 6px; padding: 10px 12px; }
.event strong { display: block; margin-bottom: 3px; }
.refs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ref { background: #ede4d2; border-radius: 999px; padding: 3px 7px; font-size: 12px; }
.relations { display: grid; gap: 10px; margin-bottom: 18px; }
.detail-section .relations:last-child { margin-bottom: 0; }
.relation-group strong { display: block; margin-bottom: 4px; color: #665b49; }
.empty { color: #6f6657; font-style: italic; }
.narrative { background: #fffaf0; border: 1px solid #d1c7b4; border-radius: 6px; padding: 12px 14px; margin: 12px 0 18px; line-height: 1.45; }
.detail-section .narrative { margin-bottom: 0; }
.narrative p { margin: 0 0 8px; }
.narrative p:last-child { margin-bottom: 0; }
.map-context { display: grid; grid-template-columns: minmax(220px, 360px) 1fr; gap: 14px; align-items: start; margin: 10px 0 18px; }
.detail-section .map-context { margin-bottom: 0; }
.map-frame { position: relative; aspect-ratio: 1 / 1; border: 1px solid #c9c1ae; border-radius: 6px; overflow: hidden; background: #ded6c6; }
.map-frame img { width: 100%; height: 100%; display: block; object-fit: cover; }
.map-marker { position: absolute; width: 16px; height: 16px; border: 3px solid #fffaf0; border-radius: 999px; background: #c23b2a; box-shadow: 0 0 0 2px #2a2119, 0 2px 8px rgba(0,0,0,.35); transform: translate(-50%, -50%); }
.map-caption { margin: 0; line-height: 1.45; }
.load-error { background: #fff2ed; border: 1px solid #d0937d; border-radius: 6px; padding: 12px; color: #5a2112; }
.load-error code { background: #f8d8cd; border-radius: 4px; padding: 1px 4px; }
@media (max-width: 980px) { .key-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .app { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid #c9c1ae; max-height: 48vh; } .detail { padding: 18px; } .page-title-row { display: block; } .record-badge { display: inline-block; margin-top: 8px; } .key-facts { grid-template-columns: 1fr; } .map-context { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="app">
<aside>
<h1>World Legends</h1>
<div id="summary" class="summary"></div>
<div class="search-row">
<input id="search" type="search" placeholder="Search legends">
<label class="search-all"><input id="global-search" type="checkbox"> All</label>
</div>
<div id="tabs" class="tabs"></div>
<div id="list" class="list"></div>
</aside>
<main><div id="detail" class="detail"><h2>Loading legends...</h2><p class="empty">Reading the generated archive.</p></div></main>
</div>
${dataTag}
<script>
function showLoadError(error, source) {
  const escapeMessage = value => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const fileHint = location.protocol === "file:" && source
    ? '<p>External archive loading is commonly blocked from <code>file://</code>. Serve this folder locally and open <code>http://127.0.0.1:&lt;port&gt;/index.html</code>, or generate a smaller inline viewer.</p>'
    : '';
  document.getElementById("summary").innerHTML = "";
  document.getElementById("tabs").innerHTML = "";
  document.getElementById("list").innerHTML = "";
  document.getElementById("detail").innerHTML =
    '<h2>Could not load Legends archive</h2><div class="load-error"><p>' + escapeMessage(error instanceof Error ? error.message : String(error)) + '</p>' + fileHint + '</div>';
}
async function loadLegendsData() {
  const element = document.getElementById("legends-data");
  const source = element?.dataset?.src || "";
  if (source) {
    const response = await fetch(source);
    if (!response.ok) throw new Error("Failed to load " + source + " (" + response.status + " " + response.statusText + ")");
    return await response.json();
  }
  return JSON.parse(element?.textContent || "{}");
}
void (async function bootLegendsViewer() {
let data;
try {
  data = await loadLegendsData();
} catch (error) {
  showLoadError(error, document.getElementById("legends-data")?.dataset?.src || "");
  return;
}
data.people = data.people || [];
for (const person of data.people) person.needStates = person.needStates || [];
data.settlementControls = data.settlementControls || [];
data["settlement-controls"] = data.settlementControls;
data.settlementControlCount = data.settlementControlCount || data.settlementControls.length;
data.naturalFeatures = data.naturalFeatures || [];
data["natural-features"] = data.naturalFeatures;
data.naturalFeatureCount = data.naturalFeatureCount || data.naturalFeatures.length;
data.personAllegiances = data.personAllegiances || [];
data["person-allegiances"] = data.personAllegiances;
data.personAllegianceCount = data.personAllegianceCount || data.personAllegiances.length;
data.preferences = data.preferences || [];
data.preferenceCount = data.preferenceCount || data.preferences.length;
data.traditions = data.traditions || [];
data.traditionCount = data.traditionCount || data.traditions.length;
data.epithets = data.epithets || [];
data.epithetCount = data.epithetCount || data.epithets.length || data.people.reduce((sum, person) => sum + (person.epithets || []).length, 0);
data.reputationMilestones = data.reputationMilestones || [];
data["reputation-milestones"] = data.reputationMilestones;
data.reputationMilestoneCount = data.reputationMilestoneCount || data.reputationMilestones.length;
data.organizations = data.organizations || [];
data.organizationCount = data.organizationCount || data.organizations.length;
data.memberships = data.memberships || [];
data.membershipCount = data.membershipCount || data.memberships.length;
data.organizationRanks = data.organizationRanks || [];
data["organization-ranks"] = data.organizationRanks;
data.organizationRankCount = data.organizationRankCount || data.organizationRanks.length;
data.relationships = data.relationships || [];
data.relationshipCount = data.relationshipCount || data.relationships.length;
data.relationshipMilestones = data.relationshipMilestones || [];
data["relationship-milestones"] = data.relationshipMilestones;
data.relationshipMilestoneCount = data.relationshipMilestoneCount || data.relationshipMilestones.length;
data.unions = data.unions || [];
data.unionCount = data.unionCount || data.unions.length;
data.beliefs = data.beliefs || [];
data.beliefCount = data.beliefCount || data.beliefs.length;
data.beliefAdherences = data.beliefAdherences || [];
data["belief-adherences"] = data.beliefAdherences;
data.beliefAdherenceCount = data.beliefAdherenceCount || data.beliefAdherences.length;
data.mythsAndMagic = data.mythsAndMagic || [];
data["myths-magic"] = data.mythsAndMagic;
data.mythsAndMagicCount = data.mythsAndMagicCount || data.mythsAndMagic.length;
data.gods = data.gods || [];
data.godCount = data.godCount || data.gods.length;
data.commandments = data.commandments || [];
data.commandmentCount = data.commandmentCount || data.commandments.length;
data.destinies = data.destinies || [];
data.destinyCount = data.destinyCount || data.destinies.length;
data.miracles = data.miracles || [];
data.miracleCount = data.miracleCount || data.miracles.length;
data.myths = data.myths || [];
data.mythCount = data.mythCount || data.myths.length;
data.doctrines = data.doctrines || [];
data.doctrineCount = data.doctrineCount || data.doctrines.length;
data.magicRoles = data.magicRoles || [];
data["magic-roles"] = data.magicRoles;
data.magicRoleCount = data.magicRoleCount || data.magicRoles.length;
data.prophecies = data.prophecies || [];
data.prophecyCount = data.prophecyCount || data.prophecies.length;
data.civilizationGoals = data.civilizationGoals || [];
data["civilization-goals"] = data.civilizationGoals;
data.civilizationGoalCount = data.civilizationGoalCount || data.civilizationGoals.length;
data.sacredSites = data.sacredSites || [];
data["sacred-sites"] = data.sacredSites;
data.sacredSiteCount = data.sacredSiteCount || data.sacredSites.length;
data.offices = data.offices || [];
data.officeCount = data.officeCount || data.offices.length;
data.officeTerms = data.officeTerms || [];
data["office-terms"] = data.officeTerms;
data.officeTermCount = data.officeTermCount || data.officeTerms.length;
data.laws = data.laws || [];
data.lawCount = data.lawCount || data.laws.length;
data.cases = data.cases || [];
data.caseCount = data.caseCount || data.cases.length;
data.testimonies = data.testimonies || [];
data.testimonyCount = data.testimonyCount || data.testimonies.length;
data.conflicts = data.conflicts || [];
data.conflictCount = data.conflictCount || data.conflicts.length;
data.battles = data.battles || [];
data.battleCount = data.battleCount || data.battles.length;
data.battleParticipations = data.battleParticipations || [];
data["battle-participations"] = data.battleParticipations;
data.battleParticipationCount = data.battleParticipationCount || data.battleParticipations.length;
data.militaryUnits = data.militaryUnits || [];
data["military-units"] = data.militaryUnits;
data.militaryUnitCount = data.militaryUnitCount || data.militaryUnits.length;
data.equipmentCaches = data.equipmentCaches || [];
data["equipment-caches"] = data.equipmentCaches;
data.equipmentCacheCount = data.equipmentCacheCount || data.equipmentCaches.length;
data.spyNetworks = data.spyNetworks || [];
data["spy-networks"] = data.spyNetworks;
data.spyNetworkCount = data.spyNetworkCount || data.spyNetworks.length;
data.spyOperations = data.spyOperations || [];
data["spy-operations"] = data.spyOperations;
data.spyOperationCount = data.spyOperationCount || data.spyOperations.length;
data.injuries = data.injuries || [];
data.injuryCount = data.injuryCount || data.injuries.length;
data.illnesses = data.illnesses || [];
data.illnessCount = data.illnessCount || data.illnesses.length;
data.careRecords = data.careRecords || [];
data["care-records"] = data.careRecords;
data.careRecordCount = data.careRecordCount || data.careRecords.length;
data.woundLegacies = data.woundLegacies || [];
data["wound-legacies"] = data.woundLegacies;
data.woundLegacyCount = data.woundLegacyCount || data.woundLegacies.length;
data.memorials = data.memorials || [];
data.memorialCount = data.memorialCount || data.memorials.length;
data.burials = data.burials || [];
data["burials"] = data.burials;
data.burialCount = data.burialCount || data.burials.length;
data.deathRecords = data.deathRecords || [];
data["death-records"] = data.deathRecords;
data.deathRecordCount = data.deathRecordCount || data.deathRecords.length;
data.births = data.births || [];
data.birthCount = data.birthCount || data.births.length;
data.ageMilestones = data.ageMilestones || [];
data["age-milestones"] = data.ageMilestones;
data.ageMilestoneCount = data.ageMilestoneCount || data.ageMilestones.length;
data.appearanceFeatures = data.appearanceFeatures || [];
data["appearance-features"] = data.appearanceFeatures;
data.appearanceFeatureCount = data.appearanceFeatureCount || data.appearanceFeatures.length;
data.ambitions = data.ambitions || [];
data.ambitionCount = data.ambitionCount || data.ambitions.length;
data.apprenticeships = data.apprenticeships || [];
data.apprenticeshipCount = data.apprenticeshipCount || data.apprenticeships.length;
data.skills = data.skills || [];
data.skillRecordCount = data.skillRecordCount || data.skills.length;
data.residences = data.residences || [];
data.residenceCount = data.residenceCount || data.residences.length;
data.careers = data.careers || [];
data.careerCount = data.careerCount || data.careers.length;
data.journeys = data.journeys || [];
data.journeyCount = data.journeyCount || data.journeys.length;
data.roads = data.roads || [];
data.roadCount = data.roadCount || data.roads.length;
data.structures = data.structures || [];
data.structureCount = data.structureCount || data.structures.length;
data.households = data.households || [];
data.householdCount = data.householdCount || data.households.length;
data.lineages = data.lineages || [];
data.lineageCount = data.lineageCount || data.lineages.length;
data.artifacts = data.artifacts || [];
data.artifactCount = data.artifactCount || data.artifacts.length;
data.artifactConditions = data.artifactConditions || [];
data["artifact-conditions"] = data.artifactConditions;
data.artifactConditionCount = data.artifactConditionCount || data.artifactConditions.length;
data.chronicles = data.chronicles || [];
data.chronicleCount = data.chronicleCount || data.chronicles.length;
data.writtenWorks = data.writtenWorks || [];
data["written-works"] = data.writtenWorks;
data.writtenWorkCount = data.writtenWorkCount || data.writtenWorks.length;
data.memories = data.memories || [];
data.memoryCount = data.memoryCount || data.memories.length;
data.thoughts = data.thoughts || [];
data.thoughtCount = data.thoughtCount || data.thoughts.length;
data.personalityShifts = data.personalityShifts || [];
data["personality-shifts"] = data.personalityShifts;
data.personalityShiftCount = data.personalityShiftCount || data.personalityShifts.length;
data.needEpisodes = data.needEpisodes || [];
data["need-episodes"] = data.needEpisodes;
data.needEpisodeCount = data.needEpisodeCount || data.needEpisodes.length;
data.opinions = data.opinions || [];
data.opinionCount = data.opinionCount || data.opinions.length;
data.socialClaims = data.socialClaims || [];
data["social-claims"] = data.socialClaims;
data.socialClaimCount = data.socialClaimCount || data.socialClaims.length;
data.conversations = data.conversations || [];
data.conversationCount = data.conversationCount || data.conversations.length;
data.rumors = data.rumors || [];
data.rumorCount = data.rumorCount || data.rumors.length;
data.secrets = data.secrets || [];
data.secretCount = data.secretCount || data.secrets.length;
data.schemes = data.schemes || [];
data.schemeCount = data.schemeCount || data.schemes.length;
data.feuds = data.feuds || [];
data.feudCount = data.feudCount || data.feuds.length;
data.oaths = data.oaths || [];
data.oathCount = data.oathCount || data.oaths.length;
data.ceremonies = data.ceremonies || [];
data.ceremonyCount = data.ceremonyCount || data.ceremonies.length;
data.ceremonyParticipations = data.ceremonyParticipations || [];
data["ceremony-participations"] = data.ceremonyParticipations;
data.ceremonyParticipationCount = data.ceremonyParticipationCount || data.ceremonyParticipations.length;
data.activities = data.activities || [];
data.activityCount = data.activityCount || data.activities.length;
data.teachings = data.teachings || [];
data.teachingCount = data.teachingCount || data.teachings.length;
data.projects = data.projects || [];
data.projectCount = data.projectCount || data.projects.length;
data.projectParticipations = data.projectParticipations || [];
data["project-participations"] = data.projectParticipations;
data.projectParticipationCount = data.projectParticipationCount || data.projectParticipations.length;
data.obligations = data.obligations || [];
data.obligationCount = data.obligationCount || data.obligations.length;
data.holdings = data.holdings || [];
data.holdingCount = data.holdingCount || data.holdings.length;
data.belongings = data.belongings || [];
data.belongingCount = data.belongingCount || data.belongings.length;
data.possessionAttachments = data.possessionAttachments || [];
data["possession-attachments"] = data.possessionAttachments;
data.possessionAttachmentCount = data.possessionAttachmentCount || data.possessionAttachments.length;
data.estates = data.estates || [];
data.estateCount = data.estateCount || data.estates.length;
data.chapters = data.chapters || [];
data.chapterCount = data.chapterCount || data.chapters.length;
data.storyHooks = data.storyHooks || [];
data["story-hooks"] = data.storyHooks;
data.storyHookCount = data.storyHookCount || data.storyHooks.length;
const kinds = [
  ["story-hooks", "Story Hooks"],
  ["people", "People"],
  ["births", "Births"],
  ["age-milestones", "Age Milestones"],
  ["appearance-features", "Appearance"],
  ["settlements", "Places"],
  ["settlement-controls", "Control"],
  ["natural-features", "Natural Features"],
  ["person-allegiances", "Allegiances"],
  ["preferences", "Preferences"],
  ["traditions", "Traditions"],
  ["epithets", "Epithets"],
  ["reputation-milestones", "Reputation Milestones"],
  ["structures", "Structures"],
  ["households", "Households"],
  ["lineages", "Lineages"],
  ["chapters", "Chapters"],
  ["organizations", "Organizations"],
  ["memberships", "Memberships"],
  ["organization-ranks", "Ranks"],
  ["beliefs", "Beliefs"],
  ["belief-adherences", "Adherences"],
  ["myths-magic", "Myths & Magic"],
  ["gods", "Gods"],
  ["commandments", "Commandments"],
  ["destinies", "Destinies"],
  ["miracles", "Miracles"],
  ["myths", "Myths"],
  ["doctrines", "Doctrines"],
  ["magic-roles", "Magic Roles"],
  ["prophecies", "Prophecies"],
  ["civilization-goals", "Civ Goals"],
  ["sacred-sites", "Sacred Sites"],
  ["offices", "Offices"],
  ["office-terms", "Office Terms"],
  ["laws", "Laws"],
  ["cases", "Cases"],
  ["testimonies", "Testimonies"],
  ["conflicts", "Conflicts"],
  ["battles", "Battles"],
  ["battle-participations", "Battle Roles"],
  ["military-units", "Military Units"],
  ["equipment-caches", "Equipment"],
  ["spy-networks", "Spy Networks"],
  ["spy-operations", "Spy Ops"],
  ["injuries", "Injuries"],
  ["illnesses", "Illnesses"],
  ["care-records", "Care"],
  ["wound-legacies", "Wound Legacies"],
  ["memorials", "Memorials"],
  ["burials", "Burials"],
  ["death-records", "Deaths"],
  ["ambitions", "Ambitions"],
  ["apprenticeships", "Apprenticeships"],
  ["skills", "Skills"],
  ["residences", "Residences"],
  ["careers", "Careers"],
  ["journeys", "Journeys"],
  ["roads", "Roads"],
  ["relationships", "Relationships"],
  ["relationship-milestones", "Relationship Milestones"],
  ["unions", "Unions"],
  ["artifacts", "Artifacts"],
  ["artifact-conditions", "Artifact Conditions"],
  ["chronicles", "Chronicles"],
  ["written-works", "Written Works"],
  ["memories", "Memories"],
  ["thoughts", "Thoughts"],
  ["personality-shifts", "Personality Shifts"],
  ["need-episodes", "Need Episodes"],
  ["opinions", "Opinions"],
  ["social-claims", "Claims"],
  ["conversations", "Conversations"],
  ["rumors", "Rumors"],
  ["secrets", "Secrets"],
  ["schemes", "Schemes"],
  ["feuds", "Feuds"],
  ["oaths", "Oaths"],
  ["ceremonies", "Ceremonies"],
  ["ceremony-participations", "Ceremony Roles"],
  ["activities", "Activities"],
  ["teachings", "Teachings"],
  ["projects", "Projects"],
  ["project-participations", "Project Roles"],
  ["obligations", "Obligations"],
  ["holdings", "Holdings"],
  ["belongings", "Belongings"],
  ["possession-attachments", "Attachments"],
  ["estates", "Estates"],
  ["civilizations", "Civs"],
  ["events", "Events"]
];
const state = {kind: data.storyHooks.length ? "story-hooks" : "people", query: "", globalSearch: false};
const globalSearchKinds = kinds.map(([kind]) => kind);
const globalSearchMinimumLength = 3;
const dataKeys = {
  people: "people",
  births: "births",
  "age-milestones": "ageMilestones",
  "appearance-features": "appearanceFeatures",
  settlements: "settlements",
  "settlement-controls": "settlementControls",
  "natural-features": "naturalFeatures",
  "person-allegiances": "personAllegiances",
  preferences: "preferences",
  traditions: "traditions",
  epithets: "epithets",
  "reputation-milestones": "reputationMilestones",
  structures: "structures",
  households: "households",
  lineages: "lineages",
  chapters: "chapters",
  organizations: "organizations",
  memberships: "memberships",
  "organization-ranks": "organizationRanks",
  beliefs: "beliefs",
  "belief-adherences": "beliefAdherences",
  "myths-magic": "mythsAndMagic",
  gods: "gods",
  commandments: "commandments",
  destinies: "destinies",
  miracles: "miracles",
  myths: "myths",
  doctrines: "doctrines",
  "magic-roles": "magicRoles",
  prophecies: "prophecies",
  "civilization-goals": "civilizationGoals",
  "sacred-sites": "sacredSites",
  offices: "offices",
  "office-terms": "officeTerms",
  laws: "laws",
  cases: "cases",
  testimonies: "testimonies",
  conflicts: "conflicts",
  battles: "battles",
  "battle-participations": "battleParticipations",
  "military-units": "militaryUnits",
  "equipment-caches": "equipmentCaches",
  "spy-networks": "spyNetworks",
  "spy-operations": "spyOperations",
  injuries: "injuries",
  illnesses: "illnesses",
  "care-records": "careRecords",
  "wound-legacies": "woundLegacies",
  memorials: "memorials",
  burials: "burials",
  "death-records": "deathRecords",
  ambitions: "ambitions",
  apprenticeships: "apprenticeships",
  skills: "skills",
  residences: "residences",
  careers: "careers",
  journeys: "journeys",
  roads: "roads",
  relationships: "relationships",
  "relationship-milestones": "relationshipMilestones",
  unions: "unions",
  artifacts: "artifacts",
  "artifact-conditions": "artifactConditions",
  chronicles: "chronicles",
  "written-works": "writtenWorks",
  memories: "memories",
  thoughts: "thoughts",
  "personality-shifts": "personalityShifts",
  "need-episodes": "needEpisodes",
  opinions: "opinions",
  "social-claims": "socialClaims",
  conversations: "conversations",
  rumors: "rumors",
  secrets: "secrets",
  schemes: "schemes",
  feuds: "feuds",
  oaths: "oaths",
  ceremonies: "ceremonies",
  "ceremony-participations": "ceremonyParticipations",
  activities: "activities",
  teachings: "teachings",
  projects: "projects",
  "project-participations": "projectParticipations",
  obligations: "obligations",
  holdings: "holdings",
  belongings: "belongings",
  "possession-attachments": "possessionAttachments",
  estates: "estates",
  "story-hooks": "storyHooks",
  civilizations: "civilizations",
  events: "events"
};
const maps = {
  people: new Map(data.people.map(x => [x.id, x])),
  births: new Map(data.births.map(x => [x.id, x])),
  "age-milestones": new Map(data.ageMilestones.map(x => [x.id, x])),
  "appearance-features": new Map(data.appearanceFeatures.map(x => [x.id, x])),
  settlements: new Map(data.settlements.map(x => [x.id, x])),
  "settlement-controls": new Map(data.settlementControls.map(x => [x.id, x])),
  "natural-features": new Map(data.naturalFeatures.map(x => [x.id, x])),
  "person-allegiances": new Map(data.personAllegiances.map(x => [x.id, x])),
  preferences: new Map(data.preferences.map(x => [x.id, x])),
  traditions: new Map(data.traditions.map(x => [x.id, x])),
  epithets: new Map(data.epithets.map(x => [x.id, x])),
  "reputation-milestones": new Map(data.reputationMilestones.map(x => [x.id, x])),
  organizations: new Map(data.organizations.map(x => [x.id, x])),
  memberships: new Map(data.memberships.map(x => [x.id, x])),
  "organization-ranks": new Map(data.organizationRanks.map(x => [x.id, x])),
  beliefs: new Map(data.beliefs.map(x => [x.id, x])),
  "belief-adherences": new Map(data.beliefAdherences.map(x => [x.id, x])),
  "myths-magic": new Map(data.mythsAndMagic.map(x => [x.id, x])),
  gods: new Map(data.gods.map(x => [x.id, x])),
  commandments: new Map(data.commandments.map(x => [x.id, x])),
  destinies: new Map(data.destinies.map(x => [x.id, x])),
  miracles: new Map(data.miracles.map(x => [x.id, x])),
  myths: new Map(data.myths.map(x => [x.id, x])),
  doctrines: new Map(data.doctrines.map(x => [x.id, x])),
  "magic-roles": new Map(data.magicRoles.map(x => [x.id, x])),
  prophecies: new Map(data.prophecies.map(x => [x.id, x])),
  "civilization-goals": new Map(data.civilizationGoals.map(x => [x.id, x])),
  "sacred-sites": new Map(data.sacredSites.map(x => [x.id, x])),
  offices: new Map(data.offices.map(x => [x.id, x])),
  "office-terms": new Map(data.officeTerms.map(x => [x.id, x])),
  laws: new Map(data.laws.map(x => [x.id, x])),
  cases: new Map(data.cases.map(x => [x.id, x])),
  testimonies: new Map(data.testimonies.map(x => [x.id, x])),
  conflicts: new Map(data.conflicts.map(x => [x.id, x])),
  battles: new Map(data.battles.map(x => [x.id, x])),
  "battle-participations": new Map(data.battleParticipations.map(x => [x.id, x])),
  "military-units": new Map(data.militaryUnits.map(x => [x.id, x])),
  "equipment-caches": new Map(data.equipmentCaches.map(x => [x.id, x])),
  "spy-networks": new Map(data.spyNetworks.map(x => [x.id, x])),
  "spy-operations": new Map(data.spyOperations.map(x => [x.id, x])),
  injuries: new Map(data.injuries.map(x => [x.id, x])),
  illnesses: new Map(data.illnesses.map(x => [x.id, x])),
  "care-records": new Map(data.careRecords.map(x => [x.id, x])),
  "wound-legacies": new Map(data.woundLegacies.map(x => [x.id, x])),
  memorials: new Map(data.memorials.map(x => [x.id, x])),
  burials: new Map(data.burials.map(x => [x.id, x])),
  "death-records": new Map(data.deathRecords.map(x => [x.id, x])),
  ambitions: new Map(data.ambitions.map(x => [x.id, x])),
  apprenticeships: new Map(data.apprenticeships.map(x => [x.id, x])),
  skills: new Map(data.skills.map(x => [x.id, x])),
  residences: new Map(data.residences.map(x => [x.id, x])),
  careers: new Map(data.careers.map(x => [x.id, x])),
  journeys: new Map(data.journeys.map(x => [x.id, x])),
  roads: new Map(data.roads.map(x => [x.id, x])),
  structures: new Map(data.structures.map(x => [x.id, x])),
  households: new Map(data.households.map(x => [x.id, x])),
  lineages: new Map(data.lineages.map(x => [x.id, x])),
  chapters: new Map(data.chapters.map(x => [x.id, x])),
  relationships: new Map(data.relationships.map(x => [x.id, x])),
  "relationship-milestones": new Map(data.relationshipMilestones.map(x => [x.id, x])),
  unions: new Map(data.unions.map(x => [x.id, x])),
  artifacts: new Map(data.artifacts.map(x => [x.id, x])),
  "artifact-conditions": new Map(data.artifactConditions.map(x => [x.id, x])),
  chronicles: new Map(data.chronicles.map(x => [x.id, x])),
  "written-works": new Map(data.writtenWorks.map(x => [x.id, x])),
  memories: new Map(data.memories.map(x => [x.id, x])),
  thoughts: new Map(data.thoughts.map(x => [x.id, x])),
  "personality-shifts": new Map(data.personalityShifts.map(x => [x.id, x])),
  "need-episodes": new Map(data.needEpisodes.map(x => [x.id, x])),
  opinions: new Map(data.opinions.map(x => [x.id, x])),
  "social-claims": new Map(data.socialClaims.map(x => [x.id, x])),
  conversations: new Map(data.conversations.map(x => [x.id, x])),
  rumors: new Map(data.rumors.map(x => [x.id, x])),
  secrets: new Map(data.secrets.map(x => [x.id, x])),
  schemes: new Map(data.schemes.map(x => [x.id, x])),
  feuds: new Map(data.feuds.map(x => [x.id, x])),
  oaths: new Map(data.oaths.map(x => [x.id, x])),
  ceremonies: new Map(data.ceremonies.map(x => [x.id, x])),
  "ceremony-participations": new Map(data.ceremonyParticipations.map(x => [x.id, x])),
  activities: new Map(data.activities.map(x => [x.id, x])),
  teachings: new Map(data.teachings.map(x => [x.id, x])),
  projects: new Map(data.projects.map(x => [x.id, x])),
  "project-participations": new Map(data.projectParticipations.map(x => [x.id, x])),
  obligations: new Map(data.obligations.map(x => [x.id, x])),
  holdings: new Map(data.holdings.map(x => [x.id, x])),
  belongings: new Map(data.belongings.map(x => [x.id, x])),
  "possession-attachments": new Map(data.possessionAttachments.map(x => [x.id, x])),
  estates: new Map(data.estates.map(x => [x.id, x])),
  "story-hooks": new Map(data.storyHooks.map(x => [x.id, x])),
  civilizations: new Map(data.civilizations.map(x => [x.id, x])),
  events: new Map(data.events.map(x => [x.id, x]))
};
const viewerIndex = data.viewerIndex || {};
const indexMaps = Object.fromEntries(kinds.map(([kind]) => [kind, new Map((viewerIndex[kind] || []).map(x => [x.id, x]))]));
const indexConfig = data.viewerIndexes || {};
const loadedIndexes = new Set(Object.keys(viewerIndex));
const chunkConfig = data.viewerChunks || {};
const loadedChunks = new Map();
const textConfig = data.viewerTexts || {};
const loadedTextChunks = new Map();
const mentionConfig = data.viewerMentions || {};
const loadedMentionChunks = new Map();
function cacheLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}
const recordChunkCacheLimit = cacheLimit(chunkConfig.cacheChunks, 32);
const textChunkCacheLimit = cacheLimit(textConfig.cacheChunks, 32);
const mentionChunkCacheLimit = cacheLimit(mentionConfig.cacheChunks, 64);
function readCache(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}
function writeCache(cache, key, value, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}
const refKinds = {person: "people", "person-allegiance": "person-allegiances", preference: "preferences", tradition: "traditions", epithet: "epithets", "reputation-milestone": "reputation-milestones", settlement: "settlements", "settlement-control": "settlement-controls", "natural-feature": "natural-features", structure: "structures", household: "households", lineage: "lineages", chapter: "chapters", organization: "organizations", membership: "memberships", "organization-rank": "organization-ranks", belief: "beliefs", "belief-adherence": "belief-adherences", "myths-magic": "myths-magic", god: "gods", commandment: "commandments", destiny: "destinies", miracle: "miracles", myth: "myths", doctrine: "doctrines", "magic-role": "magic-roles", prophecy: "prophecies", "civilization-goal": "civilization-goals", "sacred-site": "sacred-sites", office: "offices", "office-term": "office-terms", law: "laws", case: "cases", testimony: "testimonies", conflict: "conflicts", battle: "battles", "battle-participation": "battle-participations", "military-unit": "military-units", "equipment-cache": "equipment-caches", "spy-network": "spy-networks", "spy-operation": "spy-operations", injury: "injuries", illness: "illnesses", "care-record": "care-records", "wound-legacy": "wound-legacies", memorial: "memorials", burial: "burials", "death-record": "death-records", birth: "births", "age-milestone": "age-milestones", "appearance-feature": "appearance-features", ambition: "ambitions", apprenticeship: "apprenticeships", skill: "skills", residence: "residences", career: "careers", journey: "journeys", road: "roads", relationship: "relationships", "relationship-milestone": "relationship-milestones", union: "unions", artifact: "artifacts", "artifact-condition": "artifact-conditions", chronicle: "chronicles", "written-work": "written-works", memory: "memories", thought: "thoughts", "personality-shift": "personality-shifts", "need-episode": "need-episodes", opinion: "opinions", "social-claim": "social-claims", conversation: "conversations", rumor: "rumors", secret: "secrets", scheme: "schemes", feud: "feuds", oath: "oaths", ceremony: "ceremonies", "ceremony-participation": "ceremony-participations", activity: "activities", teaching: "teachings", project: "projects", "project-participation": "project-participations", obligation: "obligations", holding: "holdings", belonging: "belongings", "possession-attachment": "possession-attachments", estate: "estates", "story-hook": "story-hooks", civilization: "civilizations", event: "events"};
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}
function indexLabel(kind, id, fallback) {
  return indexMaps[kind]?.get(Number(id))?.label || fallback + " " + id;
}
function civName(id) { return maps.civilizations.get(id)?.name || indexLabel("civilizations", id, "Civilization"); }
function settlementName(id) { return maps.settlements.get(id)?.name || indexLabel("settlements", id, "Settlement"); }
function settlementControlName(id) { return maps["settlement-controls"].get(id)?.name || indexLabel("settlement-controls", id, "Settlement Control"); }
function naturalFeatureName(id) { return maps["natural-features"].get(id)?.name || indexLabel("natural-features", id, "Natural Feature"); }
function personAllegianceName(id) { return maps["person-allegiances"].get(id)?.name || indexLabel("person-allegiances", id, "Person Allegiance"); }
function preferenceName(id) { return maps.preferences.get(id)?.name || indexLabel("preferences", id, "Preference"); }
function traditionName(id) { return maps.traditions.get(id)?.name || indexLabel("traditions", id, "Tradition"); }
function epithetName(id) { return maps.epithets.get(id)?.name || indexLabel("epithets", id, "Epithet"); }
function reputationMilestoneName(id) { return maps["reputation-milestones"].get(id)?.name || indexLabel("reputation-milestones", id, "Reputation Milestone"); }
function personFullName(person) {
  if (!person) return "";
  const firstEpithet = (person.epithets || [])[0];
  return person.name + (firstEpithet ? " " + firstEpithet.name : "");
}
function personName(id) {
  const person = maps.people.get(id);
  return person ? personFullName(person) : indexLabel("people", id, "Person");
}
function birthName(id) { return maps.births.get(id)?.name || indexLabel("births", id, "Birth"); }
function ageMilestoneName(id) { return maps["age-milestones"].get(id)?.name || indexLabel("age-milestones", id, "Age Milestone"); }
function appearanceFeatureName(id) { return maps["appearance-features"].get(id)?.name || indexLabel("appearance-features", id, "Appearance Feature"); }
function organizationName(id) { return maps.organizations.get(id)?.name || indexLabel("organizations", id, "Organization"); }
function membershipName(id) { return maps.memberships.get(id)?.name || indexLabel("memberships", id, "Membership"); }
function organizationRankName(id) { return maps["organization-ranks"].get(id)?.name || indexLabel("organization-ranks", id, "Organization Rank"); }
function beliefName(id) { return maps.beliefs.get(id)?.name || indexLabel("beliefs", id, "Belief"); }
function beliefAdherenceName(id) { return maps["belief-adherences"].get(id)?.name || indexLabel("belief-adherences", id, "Belief Adherence"); }
function mythsMagicName(id) { return maps["myths-magic"].get(id)?.name || indexLabel("myths-magic", id, "Myths & Magic"); }
function godName(id) { return maps.gods.get(id)?.name || indexLabel("gods", id, "God"); }
function commandmentName(id) { return maps.commandments.get(id)?.name || indexLabel("commandments", id, "Commandment"); }
function destinyName(id) { return maps.destinies.get(id)?.name || indexLabel("destinies", id, "Destiny"); }
function miracleName(id) { return maps.miracles.get(id)?.name || indexLabel("miracles", id, "Miracle"); }
function mythName(id) { return maps.myths.get(id)?.name || indexLabel("myths", id, "Myth"); }
function doctrineName(id) { return maps.doctrines.get(id)?.name || indexLabel("doctrines", id, "Doctrine"); }
function magicRoleName(id) { return maps["magic-roles"].get(id)?.name || indexLabel("magic-roles", id, "Magic Role"); }
function prophecyName(id) { return maps.prophecies.get(id)?.name || indexLabel("prophecies", id, "Prophecy"); }
function civilizationGoalName(id) { return maps["civilization-goals"].get(id)?.name || indexLabel("civilization-goals", id, "Civilization Goal"); }
function sacredSiteName(id) { return maps["sacred-sites"].get(id)?.name || indexLabel("sacred-sites", id, "Sacred Site"); }
function officeName(id) { return maps.offices.get(id)?.name || indexLabel("offices", id, "Office"); }
function officeTermName(id) { return maps["office-terms"].get(id)?.name || indexLabel("office-terms", id, "Office Term"); }
function lawName(id) { return maps.laws.get(id)?.name || indexLabel("laws", id, "Law"); }
function caseName(id) { return maps.cases.get(id)?.name || indexLabel("cases", id, "Case"); }
function testimonyName(id) { return maps.testimonies.get(id)?.name || indexLabel("testimonies", id, "Testimony"); }
function conflictName(id) { return maps.conflicts.get(id)?.name || indexLabel("conflicts", id, "Conflict"); }
function battleName(id) { return maps.battles.get(id)?.name || indexLabel("battles", id, "Battle"); }
function battleParticipationName(id) { return maps["battle-participations"].get(id)?.name || indexLabel("battle-participations", id, "Battle Participation"); }
function militaryUnitName(id) { return maps["military-units"].get(id)?.name || indexLabel("military-units", id, "Military Unit"); }
function equipmentCacheName(id) { return maps["equipment-caches"].get(id)?.name || indexLabel("equipment-caches", id, "Equipment Cache"); }
function spyNetworkName(id) { return maps["spy-networks"].get(id)?.name || indexLabel("spy-networks", id, "Spy Network"); }
function spyOperationName(id) { return maps["spy-operations"].get(id)?.name || indexLabel("spy-operations", id, "Spy Operation"); }
function injuryName(id) { return maps.injuries.get(id)?.name || indexLabel("injuries", id, "Injury"); }
function illnessName(id) { return maps.illnesses.get(id)?.name || indexLabel("illnesses", id, "Illness"); }
function careRecordName(id) { return maps["care-records"].get(id)?.name || indexLabel("care-records", id, "Care Record"); }
function woundLegacyName(id) { return maps["wound-legacies"].get(id)?.name || indexLabel("wound-legacies", id, "Wound Legacy"); }
function memorialName(id) { return maps.memorials.get(id)?.name || indexLabel("memorials", id, "Memorial"); }
function burialName(id) { return maps.burials.get(id)?.name || indexLabel("burials", id, "Burial"); }
function deathRecordName(id) { return maps["death-records"].get(id)?.name || indexLabel("death-records", id, "Death Record"); }
function ambitionName(id) { return maps.ambitions.get(id)?.name || indexLabel("ambitions", id, "Ambition"); }
function apprenticeshipName(id) { return maps.apprenticeships.get(id)?.name || indexLabel("apprenticeships", id, "Apprenticeship"); }
function skillName(id) { return maps.skills.get(id)?.name || indexLabel("skills", id, "Skill"); }
function residenceName(id) { return maps.residences.get(id)?.name || indexLabel("residences", id, "Residence"); }
function careerName(id) { return maps.careers.get(id)?.name || indexLabel("careers", id, "Career"); }
function journeyName(id) { return maps.journeys.get(id)?.name || indexLabel("journeys", id, "Journey"); }
function roadName(id) {
  const road = maps.roads.get(id);
  return road ? settlementName(road.fromSettlementId) + " to " + settlementName(road.toSettlementId) + " road" : "Road " + id;
}
function structureName(id) { return maps.structures.get(id)?.name || indexLabel("structures", id, "Structure"); }
function householdName(id) { return maps.households.get(id)?.name || indexLabel("households", id, "Household"); }
function lineageName(id) { return maps.lineages.get(id)?.name || indexLabel("lineages", id, "Lineage"); }
function chapterName(id) { return maps.chapters.get(id)?.name || indexLabel("chapters", id, "Chapter"); }
function relationshipKindLabel(kind) {
  if (kind === "friendship") return "Friendship";
  if (kind === "rivalry") return "Rivalry";
  if (kind === "mentorship") return "Mentorship";
  return "Patronage";
}
function relationshipName(id) {
  const relationship = maps.relationships.get(id);
  if (!relationship) return "Relationship " + id;
  return relationshipKindLabel(relationship.kind) + " of " + personName(relationship.agentIds[0]) + " and " + personName(relationship.agentIds[1]);
}
function relationshipMilestoneName(id) { return maps["relationship-milestones"].get(id)?.name || indexLabel("relationship-milestones", id, "Relationship Milestone"); }
function unionName(id) { return maps.unions.get(id)?.name || indexLabel("unions", id, "Union"); }
function artifactName(id) { return maps.artifacts.get(id)?.name || indexLabel("artifacts", id, "Artifact"); }
function artifactConditionName(id) { return maps["artifact-conditions"].get(id)?.name || indexLabel("artifact-conditions", id, "Artifact Condition"); }
function years(value) { return value < 0 ? Math.abs(value) + " before year 0" : "year " + value; }
function chronicleName(id) { return maps.chronicles.get(id)?.name || indexLabel("chronicles", id, "Chronicle"); }
function writtenWorkName(id) { return maps["written-works"].get(id)?.name || indexLabel("written-works", id, "Written Work"); }
function memoryName(id) { return maps.memories.get(id)?.name || indexLabel("memories", id, "Memory"); }
function thoughtName(id) { return maps.thoughts.get(id)?.name || indexLabel("thoughts", id, "Thought"); }
function personalityShiftName(id) { return maps["personality-shifts"].get(id)?.name || indexLabel("personality-shifts", id, "Personality Shift"); }
function needEpisodeName(id) { return maps["need-episodes"].get(id)?.name || indexLabel("need-episodes", id, "Need Episode"); }
function opinionName(id) { return maps.opinions.get(id)?.name || indexLabel("opinions", id, "Opinion"); }
function socialClaimName(id) { return maps["social-claims"].get(id)?.name || indexLabel("social-claims", id, "Social Claim"); }
function conversationName(id) { return maps.conversations.get(id)?.name || indexLabel("conversations", id, "Conversation"); }
function rumorName(id) { return maps.rumors.get(id)?.name || indexLabel("rumors", id, "Rumor"); }
function secretName(id) { return maps.secrets.get(id)?.name || indexLabel("secrets", id, "Secret"); }
function schemeName(id) { return maps.schemes.get(id)?.name || indexLabel("schemes", id, "Scheme"); }
function feudName(id) { return maps.feuds.get(id)?.name || indexLabel("feuds", id, "Feud"); }
function oathName(id) { return maps.oaths.get(id)?.name || indexLabel("oaths", id, "Oath"); }
function ceremonyName(id) { return maps.ceremonies.get(id)?.name || indexLabel("ceremonies", id, "Ceremony"); }
function ceremonyParticipationName(id) { return maps["ceremony-participations"].get(id)?.name || indexLabel("ceremony-participations", id, "Ceremony Participation"); }
function activityName(id) { return maps.activities.get(id)?.name || indexLabel("activities", id, "Activity"); }
function teachingName(id) { return maps.teachings.get(id)?.name || indexLabel("teachings", id, "Teaching"); }
function projectName(id) { return maps.projects.get(id)?.name || indexLabel("projects", id, "Project"); }
function projectParticipationName(id) { return maps["project-participations"].get(id)?.name || indexLabel("project-participations", id, "Project Participation"); }
function obligationName(id) { return maps.obligations.get(id)?.name || indexLabel("obligations", id, "Obligation"); }
function holdingName(id) { return maps.holdings.get(id)?.name || indexLabel("holdings", id, "Holding"); }
function belongingName(id) { return maps.belongings.get(id)?.name || indexLabel("belongings", id, "Belonging"); }
function possessionAttachmentName(id) { return maps["possession-attachments"].get(id)?.name || indexLabel("possession-attachments", id, "Possession Attachment"); }
function estateName(id) { return maps.estates.get(id)?.name || indexLabel("estates", id, "Estate"); }
function storyHookName(id) { return maps["story-hooks"].get(id)?.name || indexLabel("story-hooks", id, "Story Hook"); }
function eventName(id) {
  const event = maps.events.get(id);
  return event ? years(event.year) + ": " + event.headline : indexLabel("events", id, "Event");
}
function reputationLabel(value) {
  const score = Number(value || 0);
  if (score >= 0.75) return "legendary";
  if (score >= 0.62) return "renowned";
  if (score >= 0.34) return "known";
  if (score >= 0.14) return "noticed";
  return "obscure";
}
function stressLabel(value) {
  const score = Number(value || 0);
  if (score >= 0.82) return "haunting";
  if (score >= 0.64) return "severe";
  if (score >= 0.42) return "strained";
  if (score >= 0.22) return "managed";
  return "low";
}
function needStatusLabel(need) {
  const urgency = Number(need.urgency || 0);
  const satisfaction = Number(need.satisfaction || 0);
  if (urgency >= 0.72 || satisfaction <= 0.24) return "unmet";
  if (urgency >= 0.5 || satisfaction <= 0.42) return "pressing";
  if (satisfaction >= 0.76 && urgency <= 0.28) return "satisfied";
  return "steady";
}
function needSummary(person) {
  const needs = person.needStates || [];
  const urgent = needs.filter(need => needStatusLabel(need) === "unmet" || needStatusLabel(need) === "pressing");
  if (!needs.length) return "";
  if (!urgent.length) return "needs steady";
  return "needs " + urgent.slice(0, 2).map(need => need.name || need.kind).join(", ");
}
function needPill(need) {
  const refs = [
    need.lastActivityId == null ? "" : activityLink(need.lastActivityId),
    need.lastCeremonyId == null ? "" : ceremonyLink(need.lastCeremonyId),
    need.lastThoughtId == null ? "" : thoughtLink(need.lastThoughtId),
    need.sourceMemoryId == null ? "" : memoryLink(need.sourceMemoryId),
    need.sourcePersonalityShiftId == null ? "" : personalityShiftLink(need.sourcePersonalityShiftId),
    need.sourcePreferenceId == null ? "" : preferenceLink(need.sourcePreferenceId),
    need.sourceTraditionId == null ? "" : traditionLink(need.sourceTraditionId)
  ].filter(Boolean);
  const label = (need.name || need.kind) + ": " + needStatusLabel(need) + " (urgency " + need.urgency + ", satisfaction " + need.satisfaction + ")";
  return '<span class="ref">' + esc(label) + '</span>' + refs.map(ref => ' ' + ref).join("");
}
function bondValue(value, fallback) {
  const score = Number(value);
  return Number.isFinite(score) ? score : fallback;
}
function relationshipStatusLabel(item) {
  const tension = bondValue(item.tension, item.kind === "rivalry" ? 0.65 : 0.18);
  const trust = bondValue(item.trust, item.kind === "rivalry" ? 0.18 : 0.5);
  const affinity = bondValue(item.affinity, item.kind === "rivalry" ? 0.12 : 0.52);
  if (!item.active) return item.endedReason ? "ended by " + item.endedReason : "ended";
  if (tension >= 0.74) return "volatile";
  if (trust >= 0.58 && affinity >= 0.5) return "close";
  if (tension >= 0.48) return "strained";
  if (trust >= 0.48) return "trusted";
  return "stable";
}
function relationshipFacetPills(item) {
  return [
    '<span class="ref">' + esc("status " + relationshipStatusLabel(item)) + '</span>',
    '<span class="ref">' + esc("affinity " + bondValue(item.affinity, 0).toFixed(3)) + '</span>',
    '<span class="ref">' + esc("trust " + bondValue(item.trust, 0).toFixed(3)) + '</span>',
    '<span class="ref">' + esc("tension " + bondValue(item.tension, 0).toFixed(3)) + '</span>',
    '<span class="ref">' + esc("familiarity " + bondValue(item.familiarity, 0).toFixed(3)) + '</span>'
  ];
}
function metric(label, value) { return '<div class="metric"><strong>' + esc(value) + '</strong>' + esc(label) + '</div>'; }
function normalizeRouteSection(section) {
  return String(section || "").replace(/^section-/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
const router = {
  defaultKind: "people",
  parse(hash) {
    const rawHash = String(hash == null ? location.hash : hash).replace(/^#\\/?/, "");
    if (!rawHash) return {kind: this.defaultKind, id: null, section: ""};
    const queryIndex = rawHash.indexOf("?");
    const path = queryIndex < 0 ? rawHash : rawHash.slice(0, queryIndex);
    const query = queryIndex < 0 ? "" : rawHash.slice(queryIndex + 1);
    const parts = path.split("/").filter(Boolean).map(part => {
      try { return decodeURIComponent(part); }
      catch { return part; }
    });
    const kind = maps[parts[0]] ? parts[0] : this.defaultKind;
    const rawId = parts[1] == null || parts[1] === "index" ? "" : parts[1];
    const numericId = rawId === "" ? null : Number(rawId);
    const id = Number.isFinite(numericId) ? numericId : null;
    let section = "";
    if (query) section = new URLSearchParams(query).get("section") || "";
    if (!section && parts[2]) section = parts[2] === "section" ? parts[3] || "" : parts[2];
    return {kind, id, section: normalizeRouteSection(section)};
  },
  current() {
    return this.parse(location.hash);
  },
  toHash(route) {
    const kind = maps[route?.kind] ? route.kind : this.defaultKind;
    const id = route?.id == null || route.id === "" ? null : Number(route.id);
    const section = normalizeRouteSection(route?.section);
    const path = "#/" + encodeURIComponent(kind) + (Number.isFinite(id) ? "/" + encodeURIComponent(String(id)) : "");
    return section ? path + "?section=" + encodeURIComponent(section) : path;
  },
  navigate(route, options) {
    const next = this.toHash({...this.current(), ...route});
    if (location.hash === next) return;
    if (options?.replace) history.replaceState(null, "", next);
    else location.hash = next;
  }
};
function stripHtml(value) {
  return String(value == null ? "" : value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function compactText(value, limit) {
  const text = stripHtml(value);
  const max = limit || 340;
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "...";
}
function factHtml(label, value) {
  const text = stripHtml(value);
  if (!text) return "";
  return '<div class="fact"><span>' + esc(label) + '</span><strong>' + value + '</strong></div>';
}
function factText(label, value) {
  if (value == null || value === "") return "";
  return factHtml(label, esc(value));
}
function addPageFact(facts, label, value, rawHtml) {
  if (facts.length >= 10) return;
  const html = rawHtml ? factHtml(label, value) : factText(label, value);
  if (html) facts.push(html);
}
function addCountFact(facts, label, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  addPageFact(facts, label, String(values.length), false);
}
function pageSummaryText(kind, item) {
  if (kind === "events") return compactText(item.description || displaySublabelFor(kind, item), 420);
  return compactText(item.description || item.effect || item.principle || item.demand || item.detail || displaySublabelFor(kind, item), 420);
}
function pageFacts(kind, item, events) {
  const facts = [];
  addPageFact(facts, "Collection", kindLabel(kind), false);
  addPageFact(facts, "Record", "#" + item.id, false);
  if (kind === "story-hooks") {
    addPageFact(facts, "Hook", item.kind, false);
    addPageFact(facts, "Tone", item.tone, false);
    addPageFact(facts, "Score", item.score, false);
    addPageFact(facts, "Urgency", item.urgency, false);
    addPageFact(facts, "Year", years(item.year), false);
    if (item.civilizationId != null) addPageFact(facts, "Civilization", civLink(item.civilizationId), true);
    if (item.settlementId != null) addPageFact(facts, "Place", settlementLink(item.settlementId), true);
    if (item.personId != null) addPageFact(facts, "Person", personLink(item.personId), true);
  } else if (kind === "people") {
    addPageFact(facts, "Status", item.alive ? "alive" : "dead", false);
    addPageFact(facts, "Profession", item.profession, false);
    addPageFact(facts, "Civilization", civLink(item.civilizationId), true);
    addPageFact(facts, "Place", settlementLink(item.settlementId), true);
    addPageFact(facts, "Age", item.age, false);
    addPageFact(facts, "Reputation", reputationLabel(item.reputation) + " " + item.reputation, false);
  } else if (kind === "settlements") {
    addPageFact(facts, "Type", item.type, false);
    addPageFact(facts, "Civilization", civLink(item.civilizationId), true);
    addPageFact(facts, "Population", item.population, false);
    addPageFact(facts, "Founded", years(item.foundedYear), false);
    addPageFact(facts, "Controlled", years(item.controlledSinceYear), false);
    addCountFact(facts, "Structures", item.structureIds);
  } else if (kind === "civilizations") {
    addPageFact(facts, "Status", item.status, false);
    addPageFact(facts, "Origin", item.originKind, false);
    addPageFact(facts, "Population", item.population, false);
    addPageFact(facts, "Capital", settlementLink(item.capitalSettlementId), true);
    addPageFact(facts, "Founded", years(item.foundedYear), false);
    addPageFact(facts, "Collapse", item.collapseStage == null ? "" : "stage " + item.collapseStage, false);
  } else if (kind === "relationships") {
    addPageFact(facts, "Kind", relationshipKindLabel(item.kind), false);
    addPageFact(facts, "Status", relationshipStatusLabel(item), false);
    addPageFact(facts, "People", (item.agentIds || []).slice(0, 2).map(personLink).join(" "), true);
    addPageFact(facts, "Trust", bondValue(item.trust, 0).toFixed(3), false);
    addPageFact(facts, "Tension", bondValue(item.tension, 0).toFixed(3), false);
    addCountFact(facts, "Milestones", item.milestoneIds);
  } else if (kind === "artifacts") {
    addPageFact(facts, "Kind", item.kind, false);
    addPageFact(facts, "Scale", item.scale, false);
    addPageFact(facts, "Condition", item.condition, false);
    addPageFact(facts, "Civilization", civLink(item.civilizationId), true);
    addPageFact(facts, "Place", settlementLink(item.settlementId), true);
    addPageFact(facts, "Renown", item.renown, false);
  } else if (kind === "battles") {
    addPageFact(facts, "Year", years(item.year), false);
    addPageFact(facts, "Kind", item.kind, false);
    addPageFact(facts, "Outcome", item.outcome, false);
    addPageFact(facts, "Place", settlementLink(item.settlementId), true);
    addPageFact(facts, "Battlefield", item.battlefieldTerrain, false);
    addPageFact(facts, "Casualties", (item.casualtyAgentIds || []).length, false);
  } else if (kind === "conflicts") {
    addPageFact(facts, "Status", item.status, false);
    addPageFact(facts, "Kind", item.kind, false);
    addPageFact(facts, "Started", years(item.startedYear), false);
    addPageFact(facts, "Battles", (item.battleIds || []).length, false);
    addPageFact(facts, "Attacker", civLink(item.attackerCivilizationId), true);
    addPageFact(facts, "Defender", civLink(item.defenderCivilizationId), true);
  } else if (["beliefs", "myths-magic", "gods", "commandments", "destinies", "miracles", "myths", "doctrines", "magic-roles", "prophecies", "civilization-goals", "sacred-sites"].includes(kind)) {
    addPageFact(facts, "Kind", item.kind || item.domain || item.status || kindLabel(kind), false);
    if (item.status != null) addPageFact(facts, "Status", item.status, false);
    if (item.domain != null) addPageFact(facts, "Domain", item.domain, false);
    if (item.civilizationId != null) addPageFact(facts, "Civilization", civLink(item.civilizationId), true);
    if (item.settlementId != null) addPageFact(facts, "Place", settlementLink(item.settlementId), true);
    if (item.godId != null) addPageFact(facts, "God", godLink(item.godId), true);
    if (item.year != null) addPageFact(facts, "Year", years(item.year), false);
    if (item.foundedYear != null) addPageFact(facts, "Founded", years(item.foundedYear), false);
  } else if (kind === "events") {
    addPageFact(facts, "Type", item.type, false);
    addPageFact(facts, "Year", years(item.year), false);
    addCountFact(facts, "References", item.entityRefs);
    if (item.civilizationId != null) addPageFact(facts, "Civilization", civLink(item.civilizationId), true);
    if (item.settlementId != null) addPageFact(facts, "Place", settlementLink(item.settlementId), true);
    if (item.personId != null) addPageFact(facts, "Person", personLink(item.personId), true);
  } else {
    if (item.kind != null) addPageFact(facts, "Kind", item.kind, false);
    if (item.status != null) addPageFact(facts, "Status", item.status, false);
    if (item.year != null) addPageFact(facts, "Year", years(item.year), false);
    if (item.startedYear != null) addPageFact(facts, "Started", years(item.startedYear), false);
    if (item.endedYear != null) addPageFact(facts, "Ended", years(item.endedYear), false);
    if (item.civilizationId != null) addPageFact(facts, "Civilization", civLink(item.civilizationId), true);
    if (item.settlementId != null) addPageFact(facts, "Place", settlementLink(item.settlementId), true);
    if (item.personId != null) addPageFact(facts, "Person", personLink(item.personId), true);
    if (item.agentId != null) addPageFact(facts, "Person", personLink(item.agentId), true);
  }
  addPageFact(facts, "Timeline", events.length + " event" + (events.length === 1 ? "" : "s"), false);
  addCountFact(facts, "Subjects", item.subjectRefs || item.entityRefs);
  return facts.join("");
}
function renderPageHeader(kind, item, title, meta, events) {
  const summary = pageSummaryText(kind, item);
  const facts = pageFacts(kind, item, events);
  return '<header class="page-header">' +
    '<div class="breadcrumb">' + link(kind, null, kindLabel(kind)) + '</div>' +
    '<div class="page-title-row"><h2>' + esc(title) + '</h2><span class="record-badge">' + esc(kindLabel(kind) + " #" + item.id) + '</span></div>' +
    (summary ? '<p class="deck">' + esc(summary) + '</p>' : '') +
    '<div class="meta">' + meta.map(x => '<span class="pill">' + x + '</span>').join("") + '</div>' +
    (facts ? '<div class="key-facts">' + facts + '</div>' : '') +
  '</header>';
}
function sectionId(id) {
  return "section-" + (normalizeRouteSection(id) || "detail");
}
function detailSection(section) {
  return '<section class="detail-section" id="' + esc(sectionId(section.id)) + '">' + section.html + '</section>';
}
function renderSectionNav(sections) {
  if (sections.length <= 1) return "";
  const current = router.current();
  return '<nav class="quick-nav">' + sections.map(section =>
    '<a href="' + esc(router.toHash({...current, section: section.id})) + '">' + esc(section.label) + '</a>'
  ).join("") + '</nav>';
}
function hashFor(kind, id, section) { return router.toHash({kind, id, section}); }
function link(kind, id, label, className) {
  return '<a href="' + esc(hashFor(kind, id)) + '"' + (className ? ' class="' + esc(className) + '"' : "") + '>' + esc(label) + '</a>';
}
function refFallbackLabel(ref) {
  const kind = refKinds[ref.kind] || ref.kind;
  const fallback = String(ref.kind || "record").replace(/-/g, " ");
  return indexLabel(kind, ref.id, fallback);
}
function refLink(ref) {
  return link(refKinds[ref.kind] || ref.kind, ref.id, ref.kind + ": " + (ref.name || refFallbackLabel(ref)), "ref");
}
function personLink(id) { return link("people", id, personName(id)); }
function birthLink(id) { return link("births", id, birthName(id)); }
function ageMilestoneLink(id) { return link("age-milestones", id, ageMilestoneName(id)); }
function appearanceFeatureLink(id) { return link("appearance-features", id, appearanceFeatureName(id)); }
function settlementLink(id) { return link("settlements", id, settlementName(id)); }
function settlementControlLink(id) { return link("settlement-controls", id, settlementControlName(id)); }
function naturalFeatureLink(id) { return link("natural-features", id, naturalFeatureName(id)); }
function personAllegianceLink(id) { return link("person-allegiances", id, personAllegianceName(id)); }
function preferenceLink(id) { return link("preferences", id, preferenceName(id)); }
function traditionLink(id) { return link("traditions", id, traditionName(id)); }
function epithetRecordLink(id) { return link("epithets", id, epithetName(id)); }
function reputationMilestoneLink(id) { return link("reputation-milestones", id, reputationMilestoneName(id)); }
function organizationLink(id) { return link("organizations", id, organizationName(id)); }
function membershipLink(id) { return link("memberships", id, membershipName(id)); }
function organizationRankLink(id) { return link("organization-ranks", id, organizationRankName(id)); }
function beliefLink(id) { return link("beliefs", id, beliefName(id)); }
function beliefAdherenceLink(id) { return link("belief-adherences", id, beliefAdherenceName(id)); }
function mythsMagicLink(id) { return link("myths-magic", id, mythsMagicName(id)); }
function godLink(id) { return link("gods", id, godName(id)); }
function commandmentLink(id) { return link("commandments", id, commandmentName(id)); }
function destinyLink(id) { return link("destinies", id, destinyName(id)); }
function miracleLink(id) { return link("miracles", id, miracleName(id)); }
function mythLink(id) { return link("myths", id, mythName(id)); }
function doctrineLink(id) { return link("doctrines", id, doctrineName(id)); }
function magicRoleLink(id) { return link("magic-roles", id, magicRoleName(id)); }
function prophecyLink(id) { return link("prophecies", id, prophecyName(id)); }
function civilizationGoalLink(id) { return link("civilization-goals", id, civilizationGoalName(id)); }
function sacredSiteLink(id) { return link("sacred-sites", id, sacredSiteName(id)); }
function officeLink(id) { return link("offices", id, officeName(id)); }
function officeTermLink(id) { return link("office-terms", id, officeTermName(id)); }
function lawLink(id) { return link("laws", id, lawName(id)); }
function caseLink(id) { return link("cases", id, caseName(id)); }
function testimonyLink(id) { return link("testimonies", id, testimonyName(id)); }
function conflictLink(id) { return link("conflicts", id, conflictName(id)); }
function battleLink(id) { return link("battles", id, battleName(id)); }
function battleParticipationLink(id) { return link("battle-participations", id, battleParticipationName(id)); }
function militaryUnitLink(id) { return link("military-units", id, militaryUnitName(id)); }
function equipmentCacheLink(id) { return link("equipment-caches", id, equipmentCacheName(id)); }
function spyNetworkLink(id) { return link("spy-networks", id, spyNetworkName(id)); }
function spyOperationLink(id) { return link("spy-operations", id, spyOperationName(id)); }
function injuryLink(id) { return link("injuries", id, injuryName(id)); }
function illnessLink(id) { return link("illnesses", id, illnessName(id)); }
function careRecordLink(id) { return link("care-records", id, careRecordName(id)); }
function woundLegacyLink(id) { return link("wound-legacies", id, woundLegacyName(id)); }
function memorialLink(id) { return link("memorials", id, memorialName(id)); }
function burialLink(id) { return link("burials", id, burialName(id)); }
function deathRecordLink(id) { return link("death-records", id, deathRecordName(id)); }
function ambitionLink(id) { return link("ambitions", id, ambitionName(id)); }
function apprenticeshipLink(id) { return link("apprenticeships", id, apprenticeshipName(id)); }
function skillLink(id) { return link("skills", id, skillName(id)); }
function residenceLink(id) { return link("residences", id, residenceName(id)); }
function careerLink(id) { return link("careers", id, careerName(id)); }
function journeyLink(id) { return link("journeys", id, journeyName(id)); }
function roadLink(id) { return link("roads", id, roadName(id)); }
function structureLink(id) { return link("structures", id, structureName(id)); }
function householdLink(id) { return link("households", id, householdName(id)); }
function lineageLink(id) { return link("lineages", id, lineageName(id)); }
function chapterLink(id) { return link("chapters", id, chapterName(id)); }
function relationshipLink(id) { return link("relationships", id, relationshipName(id)); }
function relationshipMilestoneLink(id) { return link("relationship-milestones", id, relationshipMilestoneName(id)); }
function unionLink(id) { return link("unions", id, unionName(id)); }
function civLink(id) { return link("civilizations", id, civName(id)); }
function artifactLink(id) { return link("artifacts", id, artifactName(id)); }
function artifactConditionLink(id) { return link("artifact-conditions", id, artifactConditionName(id)); }
function chronicleLink(id) { return link("chronicles", id, chronicleName(id)); }
function writtenWorkLink(id) { return link("written-works", id, writtenWorkName(id)); }
function memoryLink(id) { return link("memories", id, memoryName(id)); }
function thoughtLink(id) { return link("thoughts", id, thoughtName(id)); }
function personalityShiftLink(id) { return link("personality-shifts", id, personalityShiftName(id)); }
function needEpisodeLink(id) { return link("need-episodes", id, needEpisodeName(id)); }
function opinionLink(id) { return link("opinions", id, opinionName(id)); }
function socialClaimLink(id) { return link("social-claims", id, socialClaimName(id)); }
function conversationLink(id) { return link("conversations", id, conversationName(id)); }
function rumorLink(id) { return link("rumors", id, rumorName(id)); }
function secretLink(id) { return link("secrets", id, secretName(id)); }
function schemeLink(id) { return link("schemes", id, schemeName(id)); }
function feudLink(id) { return link("feuds", id, feudName(id)); }
function oathLink(id) { return link("oaths", id, oathName(id)); }
function ceremonyLink(id) { return link("ceremonies", id, ceremonyName(id)); }
function ceremonyParticipationLink(id) { return link("ceremony-participations", id, ceremonyParticipationName(id)); }
function activityLink(id) { return link("activities", id, activityName(id)); }
function teachingLink(id) { return link("teachings", id, teachingName(id)); }
function projectLink(id) { return link("projects", id, projectName(id)); }
function projectParticipationLink(id) { return link("project-participations", id, projectParticipationName(id)); }
function obligationLink(id) { return link("obligations", id, obligationName(id)); }
function holdingLink(id) { return link("holdings", id, holdingName(id)); }
function belongingLink(id) { return link("belongings", id, belongingName(id)); }
function possessionAttachmentLink(id) { return link("possession-attachments", id, possessionAttachmentName(id)); }
function estateLink(id) { return link("estates", id, estateName(id)); }
function storyHookLink(id) { return link("story-hooks", id, storyHookName(id)); }
function eventLink(id) { return link("events", id, eventName(id)); }
function renderSummary() {
  const epithetCount = data.epithetCount || data.people.reduce((sum, person) => sum + (person.epithets || []).length, 0);
  const sampleNote = data.viewerSample?.truncated
    ? '<div class="sample-note">Starter archive loaded. Serve this folder locally for full index search and on-demand rich pages; full raw records are in legends.json.</div>'
    : '';
  document.getElementById("summary").innerHTML =
    sampleNote +
    metric("year", data.year) +
    metric("people", data.personCount) +
    metric("allegiances", data.personAllegianceCount) +
    metric("preferences", data.preferenceCount) +
    metric("traditions", data.traditionCount) +
    metric("epithets", epithetCount) +
    metric("reputation milestones", data.reputationMilestoneCount) +
    metric("places", data.settlementCount) +
    metric("control terms", data.settlementControlCount) +
    metric("natural features", data.naturalFeatureCount) +
    metric("structures", data.structureCount) +
    metric("households", data.householdCount) +
    metric("lineages", data.lineageCount) +
    metric("organizations", data.organizationCount) +
    metric("memberships", data.membershipCount) +
    metric("ranks", data.organizationRankCount) +
    metric("beliefs", data.beliefCount) +
    metric("adherences", data.beliefAdherenceCount) +
    metric("myths & magic", data.mythsAndMagicCount) +
    metric("gods", data.godCount) +
    metric("commandments", data.commandmentCount) +
    metric("destinies", data.destinyCount) +
    metric("miracles", data.miracleCount) +
    metric("myths", data.mythCount) +
    metric("doctrines", data.doctrineCount) +
    metric("magic roles", data.magicRoleCount) +
    metric("prophecies", data.prophecyCount) +
    metric("civ goals", data.civilizationGoalCount) +
    metric("sacred sites", data.sacredSiteCount) +
    metric("offices", data.officeCount) +
    metric("office terms", data.officeTermCount) +
    metric("laws", data.lawCount) +
    metric("cases", data.caseCount) +
    metric("testimonies", data.testimonyCount) +
    metric("conflicts", data.conflictCount) +
    metric("battles", data.battleCount) +
    metric("battle roles", data.battleParticipationCount) +
    metric("military units", data.militaryUnitCount) +
    metric("equipment", data.equipmentCacheCount) +
    metric("spy networks", data.spyNetworkCount) +
    metric("spy ops", data.spyOperationCount) +
    metric("injuries", data.injuryCount) +
    metric("illnesses", data.illnessCount) +
    metric("care records", data.careRecordCount) +
    metric("wound legacies", data.woundLegacyCount) +
    metric("memorials", data.memorialCount) +
    metric("burials", data.burialCount) +
    metric("deaths", data.deathRecordCount) +
    metric("births", data.birthCount) +
    metric("age milestones", data.ageMilestoneCount) +
    metric("appearance", data.appearanceFeatureCount) +
    metric("ambitions", data.ambitionCount) +
    metric("apprenticeships", data.apprenticeshipCount) +
    metric("skills", data.skillRecordCount) +
    metric("residences", data.residenceCount) +
    metric("careers", data.careerCount) +
    metric("journeys", data.journeyCount) +
    metric("roads", data.roadCount) +
    metric("relationships", data.relationshipCount) +
    metric("relationship milestones", data.relationshipMilestoneCount) +
    metric("unions", data.unionCount) +
    metric("artifacts", data.artifactCount) +
    metric("artifact conditions", data.artifactConditionCount) +
    metric("chronicles", data.chronicleCount) +
    metric("written works", data.writtenWorkCount) +
    metric("memories", data.memoryCount) +
    metric("thoughts", data.thoughtCount) +
    metric("personality shifts", data.personalityShiftCount) +
    metric("need episodes", data.needEpisodeCount) +
    metric("opinions", data.opinionCount) +
    metric("social claims", data.socialClaimCount) +
    metric("conversations", data.conversationCount) +
    metric("rumors", data.rumorCount) +
    metric("secrets", data.secretCount) +
    metric("schemes", data.schemeCount) +
    metric("feuds", data.feudCount) +
    metric("oaths", data.oathCount) +
    metric("ceremonies", data.ceremonyCount) +
    metric("ceremony roles", data.ceremonyParticipationCount) +
    metric("activities", data.activityCount) +
    metric("teachings", data.teachingCount) +
    metric("projects", data.projectCount) +
    metric("project roles", data.projectParticipationCount) +
    metric("obligations", data.obligationCount) +
    metric("holdings", data.holdingCount) +
    metric("belongings", data.belongingCount) +
    metric("attachments", data.possessionAttachmentCount) +
    metric("estates", data.estateCount) +
    metric("chapters", data.chapterCount) +
    metric("events", data.eventCount) +
    metric("civilizations", data.civilizationCount);
}
function labelFor(kind, item) {
  if (kind === "people") return personFullName(item);
  if (kind === "births") return item.name;
  if (kind === "age-milestones") return item.name;
  if (kind === "appearance-features") return item.name;
  if (kind === "person-allegiances") return item.name;
  if (kind === "settlements") return item.name;
  if (kind === "settlement-controls") return item.name;
  if (kind === "natural-features") return item.name;
  if (kind === "preferences") return item.name;
  if (kind === "traditions") return item.name;
  if (kind === "epithets") return item.name;
  if (kind === "reputation-milestones") return item.name;
  if (kind === "structures") return item.name;
  if (kind === "households") return item.name;
  if (kind === "lineages") return item.name;
  if (kind === "chapters") return item.name || item.title;
  if (kind === "organizations") return item.name;
  if (kind === "memberships") return item.name;
  if (kind === "organization-ranks") return item.name;
  if (kind === "beliefs") return item.name;
  if (kind === "belief-adherences") return item.name;
  if (kind === "myths-magic") return item.name;
  if (kind === "gods") return item.name;
  if (kind === "commandments") return item.name;
  if (kind === "destinies") return item.name;
  if (kind === "miracles") return item.name;
  if (kind === "myths") return item.name;
  if (kind === "doctrines") return item.name;
  if (kind === "magic-roles") return item.name;
  if (kind === "prophecies") return item.name;
  if (kind === "civilization-goals") return item.name;
  if (kind === "sacred-sites") return item.name;
  if (kind === "offices") return item.name;
  if (kind === "office-terms") return item.name;
  if (kind === "laws") return item.name;
  if (kind === "cases") return item.name;
  if (kind === "testimonies") return item.name;
  if (kind === "conflicts") return item.name;
  if (kind === "battles") return item.name;
  if (kind === "battle-participations") return item.name;
  if (kind === "military-units") return item.name;
  if (kind === "equipment-caches") return item.name;
  if (kind === "spy-networks") return item.name;
  if (kind === "spy-operations") return item.name;
  if (kind === "injuries") return item.name;
  if (kind === "illnesses") return item.name;
  if (kind === "care-records") return item.name;
  if (kind === "wound-legacies") return item.name;
  if (kind === "memorials") return item.name;
  if (kind === "burials") return item.name;
  if (kind === "death-records") return item.name;
  if (kind === "ambitions") return item.name;
  if (kind === "apprenticeships") return item.name;
  if (kind === "skills") return item.name;
  if (kind === "residences") return item.name;
  if (kind === "careers") return item.name;
  if (kind === "journeys") return item.name;
  if (kind === "roads") return roadName(item.id);
  if (kind === "relationships") return relationshipName(item.id);
  if (kind === "relationship-milestones") return item.name;
  if (kind === "unions") return item.name;
  if (kind === "artifacts") return item.name;
  if (kind === "artifact-conditions") return item.name;
  if (kind === "chronicles") return item.name;
  if (kind === "written-works") return item.name;
  if (kind === "memories") return item.name;
  if (kind === "thoughts") return item.name;
  if (kind === "personality-shifts") return item.name;
  if (kind === "need-episodes") return item.name;
  if (kind === "opinions") return item.name;
  if (kind === "social-claims") return item.name;
  if (kind === "conversations") return item.name;
  if (kind === "rumors") return item.name;
  if (kind === "secrets") return item.name;
  if (kind === "schemes") return item.name;
  if (kind === "feuds") return item.name;
  if (kind === "oaths") return item.name;
  if (kind === "ceremonies") return item.name;
  if (kind === "ceremony-participations") return item.name;
  if (kind === "activities") return item.name;
  if (kind === "teachings") return item.name;
  if (kind === "projects") return item.name;
  if (kind === "project-participations") return item.name;
  if (kind === "obligations") return item.name;
  if (kind === "holdings") return item.name;
  if (kind === "belongings") return item.name;
  if (kind === "possession-attachments") return item.name;
  if (kind === "estates") return item.name;
  if (kind === "story-hooks") return item.name;
  if (kind === "civilizations") return item.name;
  return item.headline;
}
function displayLabelFor(kind, item) {
  return item?.label ?? labelFor(kind, item);
}
function displaySublabelFor(kind, item) {
  return item?.sublabel ?? sublabelFor(kind, item);
}
function indexEntries(kind) {
  return viewerIndex[kind] || [];
}
function indexLink(kind, entry) {
  return link(kind, entry.id, entry.label);
}
function indexLinks(kind, predicate, sorter, limit) {
  const entries = indexEntries(kind).filter(predicate);
  if (sorter) entries.sort(sorter);
  return entries.slice(0, limit || 8).map(entry => indexLink(kind, entry));
}
function byIndexReputation(a, b) {
  return Number(b.alive || 0) - Number(a.alive || 0)
    || Number(b.reputation || 0) - Number(a.reputation || 0)
    || Number(b.epithetCount || 0) - Number(a.epithetCount || 0)
    || Number(b.age || 0) - Number(a.age || 0)
    || Number(a.id) - Number(b.id);
}
function byIndexYearDesc(a, b) {
  return Number(b.year ?? b.foundedYear ?? b.createdYear ?? b.startedYear ?? 0) - Number(a.year ?? a.foundedYear ?? a.createdYear ?? a.startedYear ?? 0)
    || Number(b.id) - Number(a.id);
}
function sublabelFor(kind, item) {
  if (kind === "people") return item.profession + " of " + civName(item.civilizationId) + ", " + item.mentalState + ", " + reputationLabel(item.reputation) + (needSummary(item) ? ", " + needSummary(item) : "") + ", " + (item.alive ? "age " + item.age : "died " + years(item.diedYear));
  if (kind === "births") return item.kind + " of " + personName(item.personId) + ", born " + years(item.year) + ", parents " + (item.parentAgentIds || []).length;
  if (kind === "age-milestones") return item.kind + " of " + personName(item.personId) + ", age " + item.age + ", " + item.previousProfession + " to " + item.newProfession + ", " + years(item.year);
  if (kind === "appearance-features") return item.kind + " of " + personName(item.personId) + ", traits " + (item.traits || []).slice(0, 3).join(", ") + ", visibility " + item.visibility + ", " + years(item.year);
  if (kind === "person-allegiances") return personName(item.agentId) + " to " + civName(item.civilizationId) + ", " + item.status + ", " + item.startReason + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "settlements") return item.type + " of " + civName(item.civilizationId) + ", population " + item.population;
  if (kind === "settlement-controls") return civName(item.civilizationId) + " controlled " + settlementName(item.settlementId) + ", " + item.status + ", " + item.startReason + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "natural-features") return item.kind + ", elevation " + item.elevation + ", flow " + item.flow + ", settlements " + (item.settlementIds || []).length;
  if (kind === "preferences") return personName(item.agentId) + " " + item.sentiment + " " + item.targetName + ", " + item.kind + ", strength " + item.strength;
  if (kind === "traditions") return item.kind + " in " + settlementName(item.settlementId) + ", strength " + item.strength + ", practices " + item.practiceCount + ", adherents " + (item.adherentAgentIds || []).length;
  if (kind === "epithets") return item.epithet + " of " + personName(item.agentId) + ", " + item.reason + ", " + years(item.year);
  if (kind === "reputation-milestones") return item.kind + " for " + personName(item.agentId) + ", reputation " + item.previousReputation + " to " + item.reputation + ", " + years(item.year);
  if (kind === "structures") return item.kind + " in " + settlementName(item.settlementId) + ", built " + years(item.builtYear);
  if (kind === "households") return "household in " + settlementName(item.settlementId) + ", members " + item.memberAgentIds.length;
  if (kind === "lineages") return "lineage of " + civName(item.civilizationId) + ", members " + item.memberAgentIds.length;
  if (kind === "chapters") return item.chapterType + " " + item.chapterKind + " chapter of " + (item.ownerLabel || "unknown owner") + ", " + lifeChapterRange(item) + ", " + item.status;
  if (kind === "organizations") return item.kind + " in " + settlementName(item.settlementId) + ", members " + item.memberIds.length;
  if (kind === "memberships") return personName(item.agentId) + " in " + organizationName(item.organizationId) + ", " + item.role + ", " + item.status + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "organization-ranks") return personName(item.agentId) + " in " + organizationName(item.organizationId) + ", " + item.kind + ", " + item.duty + ", prestige " + item.prestige + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "beliefs") return item.domain + " belief of " + civName(item.civilizationId) + ", adherents " + item.adherentIds.length;
  if (kind === "belief-adherences") return personName(item.agentId) + " to " + beliefName(item.beliefId) + ", " + item.status + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "myths-magic") return civName(item.civilizationId) + ", beliefs " + (item.beliefIds || []).length + ", gods " + (item.godIds || []).length + ", destinies " + (item.activeDestinyIds || []).length + ", roles " + (item.magicRoleIds || []).length + ", open prophecies " + (item.openProphecyIds || []).length + ", active goals " + (item.activeCivilizationGoalIds || []).length;
  if (kind === "gods") return item.kind + " of " + beliefName(item.beliefId) + ", controls " + (item.controlSpheres || []).join(", ") + (item.miracleBias ? ", miracle " + item.miracleBias : "") + (item.commandmentStyle ? ", commandments " + item.commandmentStyle : "");
  if (kind === "commandments") return item.kind + " of " + beliefName(item.beliefId) + (item.godId == null ? "" : ", " + godName(item.godId)) + ", severity " + item.severity;
  if (kind === "destinies") return item.kind + " destiny, " + item.status + ", pressure " + item.pressure + ", " + years(item.year) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear));
  if (kind === "miracles") return item.kind + " miracle of " + beliefName(item.beliefId) + ", strength " + item.strength + ", " + years(item.year);
  if (kind === "myths") return item.kind + " myth of " + beliefName(item.beliefId) + ", " + years(item.year);
  if (kind === "doctrines") return item.kind + " doctrine of " + beliefName(item.beliefId) + ", virtue " + item.virtue + ", " + years(item.foundedYear);
  if (kind === "magic-roles") return item.kind + " held by " + personName(item.agentId) + ", " + item.status + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "prophecies") return item.kind + " prophecy, " + item.status + ", strength " + item.strength + ", " + years(item.year) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear));
  if (kind === "civilization-goals") return item.kind + " goal of " + civName(item.civilizationId) + ", " + item.status + ", priority " + item.priority + ", " + years(item.startedYear) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear));
  if (kind === "sacred-sites") return item.kind + " near " + settlementName(item.settlementId) + ", renown " + item.renown + ", founded " + years(item.foundedYear);
  if (kind === "offices") return item.kind + " of " + civName(item.civilizationId) + ", holder " + (item.holderAgentId == null ? "vacant" : personName(item.holderAgentId));
  if (kind === "office-terms") return personName(item.holderAgentId) + " held " + officeName(item.officeId) + ", " + item.status + ", " + item.startReason + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "laws") return item.domain + " law enacted " + years(item.enactedYear) + ", strictness " + item.strictness;
  if (kind === "cases") return item.kind + " opened " + years(item.openedYear) + ", verdict " + item.verdict;
  if (kind === "testimonies") return item.kind + " testimony by " + personName(item.witnessAgentId) + " " + item.stance + " in " + caseName(item.caseId) + ", credibility " + item.credibility;
  if (kind === "conflicts") return item.kind + ", " + item.status + ", " + civName(item.attackerCivilizationId) + " and " + civName(item.defenderCivilizationId) + ", battles " + (item.battleIds || []).length + ", casualties " + (item.casualtyAgentIds || []).length;
  if (kind === "battles") return item.kind + " fought " + years(item.year) + " at " + (item.battlefieldName || settlementName(item.settlementId)) + ", casualties " + item.casualtyAgentIds.length;
  if (kind === "battle-participations") return personName(item.agentId) + " served as " + item.side + " " + item.role + " in " + battleName(item.battleId) + ", " + item.outcome;
  if (kind === "military-units") return item.kind + ", " + item.status + ", strength " + item.strength + ", " + settlementName(item.settlementId);
  if (kind === "equipment-caches") return item.kind + ", " + item.condition + ", quantity " + item.quantity + ", " + settlementName(item.settlementId);
  if (kind === "spy-networks") return item.status + " " + item.cover + " cover, " + settlementName(item.settlementId) + " to " + (item.targetSettlementId == null ? "no target" : settlementName(item.targetSettlementId));
  if (kind === "spy-operations") return item.kind + ", " + item.outcome + ", " + years(item.year) + ", target " + settlementName(item.targetSettlementId);
  if (kind === "injuries") return item.severity + " " + item.kind + " of " + personName(item.personId) + ", " + item.status;
  if (kind === "illnesses") return item.severity + " " + item.kind + " of " + personName(item.personId) + ", " + item.status + ", " + years(item.onsetYear) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear));
  if (kind === "care-records") return item.kind + " for " + personName(item.patientAgentId) + ", " + item.outcome + ", " + years(item.year) + (item.healerAgentId == null ? "" : ", healer " + personName(item.healerAgentId));
  if (kind === "wound-legacies") return item.severity + " " + item.kind + " of " + personName(item.personId) + ", health " + item.healthImpact + ", stress " + item.stressImpact + ", " + years(item.year);
  if (kind === "memorials") return item.kind + " for " + personName(item.personId) + ", raised " + years(item.year);
  if (kind === "burials") return item.kind + " for " + personName(item.personId) + ", laid to rest " + years(item.year);
  if (kind === "death-records") return item.kind + " death of " + personName(item.personId) + ", age " + item.age + ", " + years(item.year);
  if (kind === "ambitions") return item.kind + " of " + personName(item.personId) + ", " + item.status;
  if (kind === "apprenticeships") return item.specialty + " training of " + personName(item.apprenticeAgentId) + ", " + item.status;
  if (kind === "skills") return item.rank + " " + item.specialty + " of " + personName(item.agentId) + ", level " + item.level + ", practices " + item.practiceCount;
  if (kind === "residences") return personName(item.personId) + " in " + settlementName(item.settlementId) + ", " + item.status + ", " + item.reason + ", " + years(item.startYear) + (item.endYear == null ? "" : " to " + years(item.endYear));
  if (kind === "careers") return personName(item.personId) + " as " + item.profession + " in " + settlementName(item.settlementId) + ", " + item.status + ", " + years(item.startYear) + (item.endYear == null ? "" : " to " + years(item.endYear));
  if (kind === "journeys") return item.kind + " from " + settlementName(item.fromSettlementId) + " to " + (item.sacredSiteId == null ? settlementName(item.toSettlementId) : sacredSiteName(item.sacredSiteId)) + ", travelers " + item.participantAgentIds.length;
  if (kind === "roads") return item.type + " road from " + settlementName(item.fromSettlementId) + " to " + settlementName(item.toSettlementId) + ", length " + item.length + ", strength " + item.strength + ", opened " + years(item.openedYear);
  if (kind === "relationships") return item.kind + " started " + years(item.startedYear) + ", " + relationshipStatusLabel(item) + ", strength " + item.strength;
  if (kind === "relationship-milestones") return item.kind + " for " + relationshipName(item.relationshipId) + ", " + item.status + ", " + years(item.year) + ", trust " + item.trust + ", tension " + item.tension;
  if (kind === "unions") return personName(item.partnerAgentIds[0]) + " and " + personName(item.partnerAgentIds[1]) + ", " + item.status + ", children " + (item.childAgentIds || []).length + ", " + years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear));
  if (kind === "artifacts") return (item.scale || "personal") + " " + item.quality + " " + item.material + " " + item.kind + ", " + (item.purpose || "object") + ", " + (item.decorationKind || "plain") + " decoration, condition " + (item.condition || "unknown") + ", renown " + item.renown + ", created " + years(item.createdYear);
  if (kind === "artifact-conditions") return artifactName(item.artifactId) + " was " + item.condition + ", " + item.kind + ", severity " + item.severity + ", " + years(item.year);
  if (kind === "chronicles") return item.kind + " by " + personName(item.authorAgentId) + ", written " + years(item.year);
  if (kind === "written-works") return item.kind + " by " + personName(item.authorAgentId) + ", authored " + years(item.year) + ", influence " + item.influence + ", copies " + item.copies;
  if (kind === "memories") return item.emotion + " memory of " + personName(item.agentId) + ", intensity " + item.intensity + ", stress " + item.stressImpact;
  if (kind === "thoughts") return item.tone + " " + item.kind + " thought of " + personName(item.agentId) + ", intensity " + item.intensity + ", mood " + item.moodDelta + ", stress " + item.stressDelta;
  if (kind === "personality-shifts") return personName(item.agentId) + " " + (item.trait == null ? "embraced " + item.value : "gained " + item.trait) + ", intensity " + item.intensity + ", " + years(item.year);
  if (kind === "need-episodes") return personName(item.personId) + " " + item.kind + " need, " + item.status + ", urgency " + item.urgency + ", satisfaction " + item.satisfaction + ", " + years(item.startedYear) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear));
  if (kind === "opinions") return item.kind + " by " + personName(item.agentId) + " toward " + (item.targetRef ? item.targetRef.name : "unknown") + ", intensity " + item.intensity + ", valence " + item.valence;
  if (kind === "social-claims") return item.kind + " held by " + personName(item.agentId) + " toward " + personName(item.targetAgentId) + ", " + item.status + ", intensity " + item.intensity + ", " + years(item.year) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear));
  if (kind === "conversations") return item.tone + " " + item.kind + " between " + personName(item.speakerAgentId) + " and " + personName(item.listenerAgentId) + " in " + settlementName(item.settlementId) + ", " + years(item.year);
  if (kind === "rumors") return item.kind + " rumor from " + settlementName(item.originSettlementId) + ", spread " + (item.spreadSettlementIds || []).length + " places, strength " + item.strength;
  if (kind === "secrets") return item.kind + " secret, " + item.status + ", severity " + item.severity + ", keepers " + (item.keeperAgentIds || []).length;
  if (kind === "schemes") return item.kind + ", " + item.status + ", leader " + personName(item.leaderAgentId) + ", secrecy " + item.secrecy + ", progress " + item.progress + ", heat " + item.heat;
  if (kind === "feuds") return item.kind + " feud, " + item.status + ", severity " + item.severity + ", sides " + (item.sideAAgentIds || []).length + " and " + (item.sideBAgentIds || []).length;
  if (kind === "oaths") return item.kind + " oath, " + item.status + ", strength " + item.strength + ", sworn by " + personName(item.swearerAgentId);
  if (kind === "ceremonies") return item.kind + " in " + settlementName(item.settlementId) + ", participants " + (item.participantAgentIds || []).length + ", " + years(item.year);
  if (kind === "ceremony-participations") return personName(item.agentId) + " attended " + ceremonyName(item.ceremonyId) + " as " + item.role + ", " + item.kind;
  if (kind === "activities") return item.kind + " by " + personName(item.primaryAgentId) + " in " + settlementName(item.settlementId) + ", participants " + (item.participantAgentIds || []).length + ", " + years(item.year);
  if (kind === "teachings") return item.kind + " in " + settlementName(item.settlementId) + ", " + personName(item.mentorAgentId) + " taught " + personName(item.studentAgentId) + ", " + item.specialty + ", " + years(item.year);
  if (kind === "projects") return item.kind + " project in " + settlementName(item.settlementId) + ", " + item.outcome + ", quality " + item.quality + ", lead " + personName(item.leadAgentId);
  if (kind === "project-participations") return personName(item.agentId) + " worked as " + item.role + " in " + projectName(item.projectId) + ", " + item.outcome + ", " + item.specialty;
  if (kind === "obligations") return item.kind + ", " + item.status + ", " + personName(item.debtorAgentId) + " owes " + personName(item.creditorAgentId) + ", amount " + item.amount;
  if (kind === "holdings") return item.kind + " in " + settlementName(item.settlementId) + ", " + item.status + ", owner " + (item.ownerAgentId == null ? "none" : personName(item.ownerAgentId)) + ", value " + item.value;
  if (kind === "belongings") return item.material + " " + item.kind + ", " + item.status + ", owner " + (item.ownerAgentId == null ? "none" : personName(item.ownerAgentId)) + ", sentiment " + item.sentiment;
  if (kind === "possession-attachments") return item.kind + " of " + personName(item.agentId) + " toward " + (item.artifactId == null ? belongingName(item.belongingId) : artifactName(item.artifactId)) + ", intensity " + item.intensity + ", " + years(item.year);
  if (kind === "estates") return "estate of " + personName(item.decedentAgentId) + ", heirs " + (item.heirAgentIds || []).length + ", assets " + ((item.artifactIds || []).length + (item.holdingIds || []).length + (item.belongingIds || []).length) + ", " + years(item.year);
  if (kind === "story-hooks") return item.kind + " hook, " + item.tone + ", score " + item.score + ", urgency " + item.urgency + ", " + years(item.year);
  if (kind === "civilizations") return (item.status ? item.status + ", " : "") + "population " + item.population + (item.originKind ? ", " + item.originKind : "") + (item.creationDomain ? ", creation " + item.creationDomain : "") + ", events " + item.eventIds.length;
  return years(item.year) + " - " + item.type;
}
function itemEvents(item) {
  const ids = Array.isArray(item.eventIds) ? item.eventIds : [];
  return ids.map(id => maps.events.get(id) || eventFromIndex(id)).filter(Boolean).sort((a, b) => a.year - b.year || a.id - b.id);
}
function eventFromIndex(id) {
  const entry = indexMaps.events?.get(Number(id));
  if (!entry) return null;
  return {
    id: entry.id,
    year: Number(entry.year || 0),
    headline: entry.headline || entry.label || "Event " + id,
    description: entry.description || entry.sublabel || "",
    entityRefs: []
  };
}
function renderTimeline(events) {
  if (!events.length) return '<p class="empty">No recorded events.</p>';
  return '<div class="timeline">' + events.map(event =>
    '<div class="event"><strong>' + link("events", event.id, years(event.year) + ": " + event.headline) + '</strong><div>' + esc(event.description) + '</div><div class="refs">' +
    event.entityRefs.map(refLink).join("") + '</div></div>'
  ).join("") + '</div>';
}
function provenanceKindLabel(kind) {
  return String(kind || "").split("-").map(part => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}
function artifactProvenanceSection(kind, item) {
  if (kind !== "artifacts") return "";
  const entries = (item.provenance || []).slice().sort((a, b) => a.year - b.year || a.eventId - b.eventId);
  if (!entries.length) return "";
  return '<h3>Provenance</h3><div class="timeline">' + entries.map(entry => {
    const refs = [
      entry.eventId == null ? "" : link("events", entry.eventId, "event " + entry.eventId, "ref"),
      entry.actorAgentId == null ? "" : link("people", entry.actorAgentId, "actor: " + personName(entry.actorAgentId), "ref"),
      entry.creatorAgentId == null ? "" : link("people", entry.creatorAgentId, "creator: " + personName(entry.creatorAgentId), "ref"),
      entry.previousOwnerAgentId == null ? "" : link("people", entry.previousOwnerAgentId, "from: " + personName(entry.previousOwnerAgentId), "ref"),
      entry.recipientAgentId == null ? "" : link("people", entry.recipientAgentId, "to: " + personName(entry.recipientAgentId), "ref"),
      entry.ownerAgentId == null || entry.ownerAgentId === entry.recipientAgentId ? "" : link("people", entry.ownerAgentId, "holder: " + personName(entry.ownerAgentId), "ref"),
      entry.previousSettlementId == null ? "" : link("settlements", entry.previousSettlementId, "from: " + settlementName(entry.previousSettlementId), "ref"),
      link("settlements", entry.settlementId, "place: " + settlementName(entry.settlementId), "ref"),
      entry.structureId == null ? "" : link("structures", entry.structureId, "structure: " + structureName(entry.structureId), "ref"),
      entry.organizationId == null ? "" : link("organizations", entry.organizationId, "organization: " + organizationName(entry.organizationId), "ref"),
      entry.beliefId == null ? "" : link("beliefs", entry.beliefId, "belief: " + beliefName(entry.beliefId), "ref"),
      entry.projectId == null ? "" : link("projects", entry.projectId, "project: " + projectName(entry.projectId), "ref"),
      entry.journeyId == null ? "" : link("journeys", entry.journeyId, "journey: " + journeyName(entry.journeyId), "ref"),
      entry.sacredSiteId == null ? "" : link("sacred-sites", entry.sacredSiteId, "site: " + sacredSiteName(entry.sacredSiteId), "ref"),
      entry.battleId == null ? "" : link("battles", entry.battleId, "battle: " + battleName(entry.battleId), "ref"),
      link("civilizations", entry.civilizationId, "civ: " + civName(entry.civilizationId), "ref")
    ].filter(Boolean).join("");
    return '<div class="event"><strong>' + esc(years(entry.year) + ": " + provenanceKindLabel(entry.kind)) + '</strong><div>' + esc(entry.description) + '</div><div class="refs">' + refs + '</div></div>';
  }).join("") + '</div>';
}
function epithetLink(epithet) {
  const label = epithet.name + " (" + years(epithet.year) + ")" + (epithet.reason ? ": " + epithet.reason : "");
  if (epithet.id != null) return link("epithets", epithet.id, label, "ref");
  return epithet.sourceEventId == null
    ? '<span class="ref">' + esc(label) + '</span>'
    : link("events", epithet.sourceEventId, label, "ref");
}

function personEventWeight(event) {
  if (!event) return 0;
  if (event.type === "person-born" || event.type === "person-died") return 100;
  if (event.type === "person-married" || event.type === "lineage-founded" || event.type === "household-founded") return 88;
  if (event.type === "profession-changed" || event.type === "career-started" || event.type === "career-ended") return 78;
  if (event.type === "artifact-created" || event.type === "artifact-inherited" || event.type === "artifact-lost" || event.type === "artifact-recovered" || event.type === "artifact-reclaimed" || event.type === "artifact-stolen" || event.type === "artifact-disputed") return 76;
  if (event.type === "battle-fought" || event.type === "battle-casualty" || event.type === "injury-sustained") return 74;
  if (event.type === "ambition-formed" || event.type === "ambition-fulfilled" || event.type === "ambition-failed") return 70;
  if (event.type === "magic-role-appointed" || event.type === "prophecy-spoken" || event.type === "prophecy-interpreted" || event.type === "prophecy-fulfilled" || event.type === "prophecy-failed") return 70;
  if (event.type === "written-work-authored" || event.type === "chronicle-written" || event.type === "skill-improved") return 68;
  if (event.type === "relationship-formed" || event.type === "relationship-deepened" || event.type === "relationship-strained" || event.type === "relationship-reconciled" || event.type === "feud-started" || event.type === "oath-sworn") return 62;
  if (event.type === "illness-onset" || event.type === "illness-resolved" || event.type === "stress-crisis" || event.type === "coping-action") return 58;
  return 0;
}

function notablePersonEvents(person, limit) {
  return itemEvents(person)
    .map(event => ({event, weight: personEventWeight(event)}))
    .filter(entry => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || b.event.year - a.event.year || a.event.id - b.event.id)
    .slice(0, limit || 12)
    .sort((a, b) => a.event.year - b.event.year || a.event.id - b.event.id)
    .map(entry => eventLink(entry.event.id));
}

function strongestMemoryLinks(person, limit) {
  return (person.memoryIds || [])
    .map(id => maps.memories.get(id))
    .filter(Boolean)
    .sort((a, b) => b.intensity - a.intensity || Math.abs(b.stressImpact) - Math.abs(a.stressImpact) || b.year - a.year || a.id - b.id)
    .slice(0, limit || 6)
    .map(memory => memoryLink(memory.id));
}

function recentThoughtLinks(person, limit) {
  return (person.thoughtIds || [])
    .map(id => maps.thoughts.get(id))
    .filter(Boolean)
    .sort((a, b) => b.year - a.year || b.intensity - a.intensity || a.id - b.id)
    .slice(0, limit || 6)
    .map(thought => thoughtLink(thought.id));
}

function personalityShiftLinks(person, limit) {
  return (person.personalityShiftIds || [])
    .map(id => maps["personality-shifts"].get(id))
    .filter(Boolean)
    .sort((a, b) => b.year - a.year || b.intensity - a.intensity || a.id - b.id)
    .slice(0, limit || 6)
    .map(shift => personalityShiftLink(shift.id));
}

function keyOpinionLinks(person, limit) {
  return (person.opinionIds || [])
    .map(id => maps.opinions.get(id))
    .filter(Boolean)
    .sort((a, b) => b.intensity - a.intensity || Math.abs(b.valence) - Math.abs(a.valence) || b.updatedYear - a.updatedYear || a.id - b.id)
    .slice(0, limit || 6)
    .map(opinion => opinionLink(opinion.id));
}

function keySocialClaimLinks(person, limit) {
  return (person.socialClaimIds || [])
    .map(id => maps["social-claims"].get(id))
    .filter(Boolean)
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.intensity - a.intensity || b.year - a.year || a.id - b.id)
    .slice(0, limit || 6)
    .map(claim => socialClaimLink(claim.id));
}

function relationshipLinksByStatus(person, statuses, limit) {
  return (person.socialBondIds || [])
    .map(id => maps.relationships.get(id))
    .filter(relationship => relationship && statuses.includes(relationshipStatusLabel(relationship)))
    .sort((a, b) =>
      bondValue(b.familiarity, 0) - bondValue(a.familiarity, 0)
      || bondValue(b.strength, 0) - bondValue(a.strength, 0)
      || b.id - a.id
    )
    .slice(0, limit || 6)
    .map(relationship => relationshipLink(relationship.id));
}

function otherRelationshipAgentId(relationship, personId) {
  const ids = relationship?.agentIds || [];
  if (ids[0] === personId) return ids[1];
  if (ids[1] === personId) return ids[0];
  return null;
}

function socialWebEntry(entries, otherId) {
  if (otherId == null) return null;
  const other = maps.people.get(otherId);
  if (!other) return null;
  let entry = entries.get(otherId);
  if (!entry) {
    entry = {
      otherId,
      score: 0,
      positive: 0,
      negative: 0,
      latestYear: null,
      labels: [],
      labelSet: new Set(),
      links: [],
      linkSet: new Set(),
      notes: []
    };
    entries.set(otherId, entry);
  }
  return entry;
}

function addSocialWebLabel(entry, label) {
  if (!entry || !label || entry.labelSet.has(label)) return;
  entry.labelSet.add(label);
  entry.labels.push(label);
}

function addSocialWebLink(entry, html) {
  if (!entry || !html || entry.linkSet.has(html)) return;
  entry.linkSet.add(html);
  entry.links.push(html);
}

function addSocialWebNote(entry, note) {
  if (!entry || !note || entry.notes.includes(note)) return;
  entry.notes.push(note);
}

function addSocialWebSignal(entry, input) {
  if (!entry) return;
  entry.score += input.score || 0;
  entry.positive += input.positive || 0;
  entry.negative += input.negative || 0;
  if (input.year != null && (entry.latestYear == null || input.year > entry.latestYear)) entry.latestYear = input.year;
  for (const label of input.labels || []) addSocialWebLabel(entry, label);
  for (const html of input.links || []) addSocialWebLink(entry, html);
  if (input.note) addSocialWebNote(entry, input.note);
}

function conversationSocialWeight(tone) {
  if (tone === "warm" || tone === "joyful" || tone === "curious") return {positive: 0.35, negative: 0};
  if (tone === "tense" || tone === "guarded" || tone === "worried") return {positive: 0, negative: 0.35};
  return {positive: 0.12, negative: 0.08};
}

function socialWebEntriesForPerson(person) {
  const entries = new Map();
  for (const relationshipId of person.socialBondIds || []) {
    const relationship = maps.relationships.get(relationshipId);
    const otherId = otherRelationshipAgentId(relationship, person.id);
    const entry = socialWebEntry(entries, otherId);
    if (!entry || !relationship) continue;
    const status = relationshipStatusLabel(relationship);
    const isTense = relationship.kind === "rivalry" || status === "volatile" || status === "strained";
    const isClose = status === "close" || status === "trusted";
    addSocialWebSignal(entry, {
      score: 1.1 + bondValue(relationship.strength, 0) + bondValue(relationship.familiarity, 0) + (relationship.active ? 0.35 : 0),
      positive: isClose ? 1 + bondValue(relationship.trust, 0) : relationship.kind === "rivalry" ? 0 : 0.25,
      negative: isTense ? 1 + bondValue(relationship.tension, 0) : 0,
      year: relationship.lastInteractionYear ?? relationship.startedYear,
      labels: [relationshipKindLabel(relationship.kind), status],
      links: [relationshipLink(relationship.id), relationship.lastInteractionEventId == null ? "" : eventLink(relationship.lastInteractionEventId)],
      note: relationshipKindLabel(relationship.kind) + " is " + status + "."
    });
  }
  for (const claimId of person.socialClaimIds || []) {
    const claim = maps["social-claims"].get(claimId);
    const entry = socialWebEntry(entries, claim?.targetAgentId);
    if (!entry || !claim) continue;
    const active = claim.status === "active";
    addSocialWebSignal(entry, {
      score: 0.8 + bondValue(claim.intensity, 0) + (active ? 0.35 : 0),
      positive: claim.kind === "favor" ? 0.8 + bondValue(claim.intensity, 0) : 0,
      negative: claim.kind === "grudge" ? 0.8 + bondValue(claim.intensity, 0) : 0,
      year: claim.resolvedYear ?? claim.year,
      labels: [active ? "active " + claim.kind : claim.status + " " + claim.kind],
      links: [socialClaimLink(claim.id), claim.relationshipId == null ? "" : relationshipLink(claim.relationshipId)],
      note: claim.kind === "favor"
        ? person.name + " remembers a favor involving " + personName(claim.targetAgentId) + "."
        : person.name + " carries a grudge involving " + personName(claim.targetAgentId) + "."
    });
  }
  for (const claim of data.socialClaims || []) {
    if (claim.targetAgentId !== person.id) continue;
    const entry = socialWebEntry(entries, claim.agentId);
    if (!entry) continue;
    const active = claim.status === "active";
    addSocialWebSignal(entry, {
      score: 0.55 + bondValue(claim.intensity, 0) + (active ? 0.3 : 0),
      positive: claim.kind === "favor" ? 0.45 + bondValue(claim.intensity, 0) : 0,
      negative: claim.kind === "grudge" ? 0.45 + bondValue(claim.intensity, 0) : 0,
      year: claim.resolvedYear ?? claim.year,
      labels: [active ? "claim about them" : claim.status + " claim"],
      links: [socialClaimLink(claim.id), claim.relationshipId == null ? "" : relationshipLink(claim.relationshipId)],
      note: personName(claim.agentId) + " holds a " + claim.kind + " concerning " + person.name + "."
    });
  }
  for (const conversation of data.conversations || []) {
    if (conversation.speakerAgentId !== person.id && conversation.listenerAgentId !== person.id) continue;
    const otherId = conversation.speakerAgentId === person.id ? conversation.listenerAgentId : conversation.speakerAgentId;
    const entry = socialWebEntry(entries, otherId);
    if (!entry) continue;
    const toneWeight = conversationSocialWeight(conversation.tone);
    addSocialWebSignal(entry, {
      score: 0.3 + toneWeight.positive + toneWeight.negative,
      positive: toneWeight.positive,
      negative: toneWeight.negative,
      year: conversation.year,
      labels: [conversation.tone + " conversation"],
      links: [conversationLink(conversation.id), conversation.relationshipId == null ? "" : relationshipLink(conversation.relationshipId)],
      note: "They shared a " + conversation.tone + " " + conversation.kind.replace(/-/g, " ") + "."
    });
  }
  for (const opinionId of person.opinionIds || []) {
    const opinion = maps.opinions.get(opinionId);
    if (opinion?.targetRef?.kind !== "person") continue;
    const entry = socialWebEntry(entries, opinion.targetRef.id);
    if (!entry) continue;
    addSocialWebSignal(entry, {
      score: 0.35 + bondValue(opinion.intensity, 0),
      positive: Math.max(0, opinion.valence || 0) * bondValue(opinion.intensity, 0),
      negative: Math.max(0, -(opinion.valence || 0)) * bondValue(opinion.intensity, 0),
      year: opinion.updatedYear ?? opinion.year,
      labels: [opinion.kind],
      links: [opinionLink(opinion.id)],
      note: person.name + " feels " + opinion.kind + " toward " + personName(opinion.targetRef.id) + "."
    });
  }
  for (const opinion of data.opinions || []) {
    if (opinion.targetRef?.kind !== "person" || opinion.targetRef.id !== person.id) continue;
    const entry = socialWebEntry(entries, opinion.agentId);
    if (!entry) continue;
    addSocialWebSignal(entry, {
      score: 0.25 + bondValue(opinion.intensity, 0),
      positive: Math.max(0, opinion.valence || 0) * bondValue(opinion.intensity, 0) * 0.8,
      negative: Math.max(0, -(opinion.valence || 0)) * bondValue(opinion.intensity, 0) * 0.8,
      year: opinion.updatedYear ?? opinion.year,
      labels: ["opinion about them"],
      links: [opinionLink(opinion.id)],
      note: personName(opinion.agentId) + " has a " + opinion.kind + " opinion of " + person.name + "."
    });
  }
  for (const obligationId of person.obligationIds || []) {
    const obligation = maps.obligations.get(obligationId);
    if (!obligation) continue;
    const otherId = obligation.creditorAgentId === person.id ? obligation.debtorAgentId : obligation.debtorAgentId === person.id ? obligation.creditorAgentId : null;
    const entry = socialWebEntry(entries, otherId);
    if (!entry) continue;
    const active = obligation.status === "active";
    addSocialWebSignal(entry, {
      score: 0.65 + Math.min(1.2, (obligation.amount || 0) / 120) + (active ? 0.35 : 0),
      positive: obligation.status === "fulfilled" ? 0.5 : 0,
      negative: active || obligation.status === "defaulted" ? 0.65 : 0.1,
      year: obligation.resolvedYear ?? obligation.createdYear,
      labels: [active ? "active obligation" : obligation.status + " obligation", obligation.kind],
      links: [obligationLink(obligation.id), obligation.relationshipId == null ? "" : relationshipLink(obligation.relationshipId)],
      note: obligation.creditorAgentId === person.id
        ? personName(obligation.debtorAgentId) + " owes " + person.name + "."
        : person.name + " owes " + personName(obligation.creditorAgentId) + "."
    });
  }
  for (const feudId of person.feudIds || []) {
    const feud = maps.feuds.get(feudId);
    if (!feud) continue;
    const onA = (feud.sideAAgentIds || []).includes(person.id);
    const onB = (feud.sideBAgentIds || []).includes(person.id);
    const allies = onA ? feud.sideAAgentIds : onB ? feud.sideBAgentIds : [];
    const rivals = onA ? feud.sideBAgentIds : onB ? feud.sideAAgentIds : [];
    for (const otherId of allies.filter(id => id !== person.id).slice(0, 8)) {
      const entry = socialWebEntry(entries, otherId);
      addSocialWebSignal(entry, {
        score: 0.55 + bondValue(feud.severity, 0),
        positive: 0.45,
        year: feud.settledYear ?? feud.startedYear,
        labels: [feud.status + " feud ally"],
        links: [feudLink(feud.id)],
        note: "They stood on the same side of a " + feud.kind + " feud."
      });
    }
    for (const otherId of rivals.slice(0, 10)) {
      const entry = socialWebEntry(entries, otherId);
      addSocialWebSignal(entry, {
        score: 0.9 + bondValue(feud.severity, 0),
        negative: 1 + bondValue(feud.severity, 0),
        year: feud.settledYear ?? feud.startedYear,
        labels: [feud.status + " feud rival"],
        links: [feudLink(feud.id)],
        note: "They stood on opposite sides of a " + feud.kind + " feud."
      });
    }
  }
  for (const oathId of person.oathIds || []) {
    const oath = maps.oaths.get(oathId);
    if (!oath?.targetAgentId || oath.targetAgentId === person.id && oath.swearerAgentId === person.id) continue;
    const otherId = oath.swearerAgentId === person.id ? oath.targetAgentId : oath.targetAgentId === person.id ? oath.swearerAgentId : null;
    const entry = socialWebEntry(entries, otherId);
    if (!entry) continue;
    const tension = oath.kind === "vengeance" || oath.status === "broken";
    addSocialWebSignal(entry, {
      score: 0.65 + bondValue(oath.strength, 0),
      positive: tension ? 0 : 0.45 + bondValue(oath.strength, 0) * 0.4,
      negative: tension ? 0.65 + bondValue(oath.strength, 0) : 0,
      year: oath.resolvedYear ?? oath.swornYear,
      labels: [oath.status + " oath", oath.kind],
      links: [oathLink(oath.id), oath.targetFeudId == null ? "" : feudLink(oath.targetFeudId)],
      note: "An oath of " + oath.kind + " binds this connection."
    });
  }
  return [...entries.values()]
    .sort((a, b) => b.score - a.score || (b.latestYear ?? -999999) - (a.latestYear ?? -999999) || a.otherId - b.otherId);
}

function socialWebPolarity(entry) {
  if (entry.negative >= entry.positive + 0.75) return "tense";
  if (entry.positive >= entry.negative + 0.75) return "supportive";
  if (entry.positive > 0 && entry.negative > 0) return "mixed";
  return "known";
}

function renderSocialWebRows(entries, limit) {
  return entries.slice(0, limit || 12).map(entry => {
    const labels = [
      factPill(socialWebPolarity(entry)),
      entry.latestYear == null ? "" : factPill("last " + years(entry.latestYear)),
      ...entry.labels.slice(0, 5).map(factPill)
    ];
    const refs = [...labels, ...entry.links.slice(0, 10)].filter(Boolean);
    return '<div class="event"><strong>' + personLink(entry.otherId) + '</strong>' +
      '<p>' + esc(entry.notes.slice(0, 3).join(" ")) + '</p>' +
      '<div class="refs">' + refs.join("") + '</div></div>';
  }).join("");
}

function socialWebSection(kind, item) {
  if (kind === "people") {
    const entries = socialWebEntriesForPerson(item);
    if (!entries.length) return "";
    const tense = entries.filter(entry => socialWebPolarity(entry) === "tense");
    const supportive = entries.filter(entry => socialWebPolarity(entry) === "supportive");
    const mixed = entries.filter(entry => socialWebPolarity(entry) === "mixed");
    const overview = [
      factPill("ties " + entries.length),
      factPill("supportive " + supportive.length),
      factPill("tense " + tense.length),
      factPill("mixed " + mixed.length)
    ];
    return '<h3>Social Web</h3><div class="relations">' + relationGroup("Network Snapshot", overview) + '</div>' +
      '<div class="timeline social-web">' + renderSocialWebRows(entries, 14) + '</div>';
  }
  if (kind === "relationships") {
    const people = (item.agentIds || []).map(id => maps.people.get(id)).filter(Boolean);
    if (people.length < 2) return "";
    const rows = people.map(person => {
      const entries = socialWebEntriesForPerson(person)
        .filter(entry => !(item.agentIds || []).includes(entry.otherId))
        .slice(0, 6);
      return '<div class="relation-group"><strong>' + personLink(person.id) + '</strong>' +
        (entries.length ? '<div class="timeline social-web">' + renderSocialWebRows(entries, 6) + '</div>' : '<p class="empty">No wider social web loaded for this person.</p>') +
        '</div>';
    }).join("");
    return rows ? '<h3>Surrounding Social Web</h3><div class="relations">' + rows + '</div>' : "";
  }
  return "";
}

function sortedPeopleLinks(ids, limit) {
  const seen = new Set();
  const people = [];
  for (const id of ids || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const person = maps.people.get(id);
    if (person) people.push(person);
  }
  return people
    .sort((a, b) =>
      (b.alive ? 1 : 0) - (a.alive ? 1 : 0)
      || b.reputation - a.reputation
      || (b.epithets || []).length - (a.epithets || []).length
      || b.age - a.age
      || a.id - b.id
    )
    .slice(0, limit || 12)
    .map(person => personLink(person.id));
}

function siblingIds(person) {
  const ids = new Set();
  for (const parentId of person.parentIds || []) {
    const parent = maps.people.get(parentId);
    for (const childId of parent?.childIds || []) {
      if (childId !== person.id) ids.add(childId);
    }
  }
  return [...ids];
}

function householdKinIds(person) {
  if (person.householdId == null) return [];
  const household = maps.households.get(person.householdId);
  return (household?.memberAgentIds || []).filter(id => id !== person.id);
}

function lineageKinIds(person) {
  if (person.lineageId == null) return [];
  const lineage = maps.lineages.get(person.lineageId);
  return (lineage?.memberAgentIds || []).filter(id => id !== person.id);
}

function ancestorIds(person, limit) {
  const result = [];
  const seen = new Set([person.id]);
  const queue = (person.parentIds || []).map(id => ({id, depth: 1}));
  while (queue.length && result.length < (limit || 16)) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    const ancestor = maps.people.get(current.id);
    if (!ancestor) continue;
    result.push(current.id);
    for (const parentId of ancestor.parentIds || []) queue.push({id: parentId, depth: current.depth + 1});
  }
  return result;
}

function descendantIds(person, limit) {
  const result = [];
  const seen = new Set([person.id]);
  const queue = (person.childIds || []).map(id => ({id, depth: 1}));
  while (queue.length && result.length < (limit || 24)) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    const descendant = maps.people.get(current.id);
    if (!descendant) continue;
    result.push(current.id);
    for (const childId of descendant.childIds || []) queue.push({id: childId, depth: current.depth + 1});
  }
  return result;
}

function eventLinksByTypes(person, types, limit) {
  const typeSet = new Set(types);
  return itemEvents(person)
    .filter(event => typeSet.has(event.type))
    .slice(-1 * (limit || 8))
    .map(event => eventLink(event.id));
}

function personArtifactLinks(person, predicate, limit) {
  return data.artifacts
    .filter(predicate)
    .sort((a, b) => b.renown - a.renown || a.createdYear - b.createdYear || a.id - b.id)
    .slice(0, limit || 8)
    .map(artifact => artifactLink(artifact.id));
}

function personWrittenLegacyLinks(person, limit) {
  const links = [
    ...(person.writtenWorkIds || []).slice(0, limit || 8).map(writtenWorkLink),
    ...data.chronicles.filter(chronicle => chronicle.authorAgentId === person.id).slice(0, limit || 8).map(chronicle => chronicleLink(chronicle.id))
  ];
  return links.slice(0, limit || 8);
}

function personLegacySection(kind, item) {
  if (kind !== "people") return "";
  const deathAndMemory = [
    ...eventLinksByTypes(item, ["person-died", "battle-casualty"], 4),
    ...(item.injuryIds || []).map(id => maps.injuries.get(id)).filter(injury => injury && injury.status === "fatal").slice(0, 4).map(injury => injuryLink(injury.id)),
    ...(item.illnessIds || []).map(id => maps.illnesses.get(id)).filter(illness => illness && illness.status === "fatal").slice(0, 4).map(illness => illnessLink(illness.id)),
    ...(item.memorialIds || []).slice(0, 6).map(memorialLink)
  ];
  const achievements = [
    ...(item.epithets || []).map(epithetLink),
    ...(item.ambitionIds || []).map(id => maps.ambitions.get(id)).filter(ambition => ambition && ambition.status === "fulfilled").slice(0, 6).map(ambition => ambitionLink(ambition.id)),
    ...(item.officeTermIds || []).slice(0, 6).map(officeTermLink),
    ...(item.skillRecordIds || []).slice(0, 6).map(skillLink)
  ];
  const worksAndCreations = [
    ...personWrittenLegacyLinks(item, 8),
    ...personArtifactLinks(item, artifact => artifact.creatorAgentId === item.id, 8),
    ...(item.projectIds || []).slice(0, 6).map(projectLink)
  ];
  const inheritances = [
    ...data.estates.filter(estate => estate.decedentAgentId === item.id || (estate.heirAgentIds || []).includes(item.id)).slice(0, 8).map(estate => estateLink(estate.id)),
    ...personArtifactLinks(item, artifact => (artifact.provenance || []).some(entry => entry.previousOwnerAgentId === item.id), 8),
    ...data.belongings.filter(belonging => belonging.previousOwnerAgentId === item.id).slice(0, 8).map(belonging => belongingLink(belonging.id))
  ];
  const rememberedBy = [
    ...memoriesAbout("person", item.id, 6),
    ...opinionsAbout("person", item.id, 6),
    ...socialClaimsAbout("person", item.id, 6),
    ...rumorsAbout("person", item.id, 6),
    ...secretsAbout("person", item.id, 6),
    ...schemesAbout("person", item.id, 6)
  ];
  const unresolved = [
    ...(item.ambitionIds || []).map(id => maps.ambitions.get(id)).filter(ambition => ambition && ambition.status === "failed").slice(0, 6).map(ambition => ambitionLink(ambition.id)),
    ...feudsAbout("person", item.id, 6),
    ...oathsAbout("person", item.id, 6),
    ...socialClaimsAbout("person", item.id, 6),
    ...obligationsAbout("person", item.id, 6)
  ];
  const inner = [
    relationGroup("Death and Memorials", deathAndMemory),
    relationGroup("Achievements", achievements),
    relationGroup("Works and Creations", worksAndCreations),
    relationGroup("Passed On", inheritances),
    relationGroup("Descendants", sortedPeopleLinks(descendantIds(item, 12), 12)),
    relationGroup("Remembered By", rememberedBy),
    relationGroup("Unfinished Business", unresolved)
  ].join("");
  return inner ? '<h3>Legacy Summary</h3><div class="relations">' + inner + '</div>' : "";
}

const worldMentionGroupLabels = [
  ["births", "Births"],
  ["age-milestones", "Age Milestones"],
  ["appearance-features", "Appearance"],
  ["settlement-controls", "Control Terms"],
  ["person-allegiances", "Allegiances"],
  ["preferences", "Preferences"],
  ["traditions", "Traditions"],
  ["structures", "Structures"],
  ["households", "Households"],
  ["lineages", "Lineages"],
  ["organizations", "Organizations"],
  ["memberships", "Memberships"],
  ["beliefs", "Beliefs"],
  ["belief-adherences", "Belief Adherences"],
  ["myths", "Myths"],
  ["doctrines", "Doctrines"],
  ["magic-roles", "Magic Roles"],
  ["prophecies", "Prophecies"],
  ["civilization-goals", "Civilization Goals"],
  ["sacred-sites", "Sacred Sites"],
  ["offices", "Offices"],
  ["office-terms", "Office Terms"],
  ["laws", "Laws"],
  ["cases", "Cases"],
  ["testimonies", "Testimonies"],
  ["conflicts", "Conflicts"],
  ["battles", "Battles"],
  ["battle-participations", "Battle Roles"],
  ["injuries", "Injuries"],
  ["illnesses", "Illnesses"],
  ["care-records", "Care Records"],
  ["wound-legacies", "Wound Legacies"],
  ["memorials", "Memorials"],
  ["burials", "Burials"],
  ["death-records", "Deaths"],
  ["ambitions", "Ambitions"],
  ["apprenticeships", "Apprenticeships"],
  ["skills", "Skills"],
  ["residences", "Residences"],
  ["careers", "Careers"],
  ["journeys", "Journeys"],
  ["roads", "Roads"],
  ["artifacts", "Artifacts"],
  ["memories", "Memories"],
  ["thoughts", "Thoughts"],
  ["personality-shifts", "Personality Shifts"],
  ["need-episodes", "Need Episodes"],
  ["opinions", "Opinions"],
  ["social-claims", "Claims"],
  ["conversations", "Conversations"],
  ["relationships", "Relationships"],
  ["reputation-milestones", "Reputation Milestones"],
  ["relationship-milestones", "Relationship Milestones"],
  ["unions", "Unions"],
  ["activities", "Daily Life"],
  ["teachings", "Teachings"],
  ["projects", "Work Projects"],
  ["project-participations", "Project Roles"],
  ["chronicles", "Chronicles"],
  ["written-works", "Written Works"],
  ["rumors", "Rumors"],
  ["secrets", "Secrets"],
  ["schemes", "Schemes"],
  ["feuds", "Feuds"],
  ["oaths", "Oaths"],
  ["obligations", "Obligations"],
  ["holdings", "Holdings"],
  ["belongings", "Belongings"],
  ["estates", "Estates"],
  ["chapters", "Chapters"],
  ["ceremonies", "Ceremonies"],
  ["ceremony-participations", "Ceremony Roles"],
  ["events", "Events"]
];
function mentionEntryLink(entry) {
  return link(entry.kind, entry.id, entry.label || (entry.kind + " " + entry.id));
}
function worldMentionLabel(group) {
  return (worldMentionGroupLabels.find(([key]) => key === group) || [group, group])[1];
}
function worldMentionsElementId(kind, id) {
  return "world-mentions-" + String(kind).replace(/[^a-z0-9_-]/gi, "-") + "-" + Number(id);
}
function worldMentionTimelineEntries(mentions, limit) {
  const entries = [];
  const seen = new Set();
  for (const [group, groupEntries] of Object.entries(mentions || {})) {
    for (const entry of groupEntries || []) {
      if (entry.year == null) continue;
      const key = entry.kind + ":" + entry.id;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({...entry, group});
    }
  }
  return entries
    .sort((a, b) => Number(a.year) - Number(b.year) || String(a.kind).localeCompare(String(b.kind)) || Number(a.id) - Number(b.id))
    .slice(0, limit || 80);
}
function renderWorldMentionTimeline(mentions) {
  const entries = worldMentionTimelineEntries(mentions, 80);
  if (!entries.length) return "";
  return '<div class="relation-group"><strong>Mention Timeline</strong><div class="timeline mention-timeline">' + entries.map(entry =>
    '<div class="event"><strong>' + esc(years(entry.year)) + ': ' + mentionEntryLink(entry) + '</strong><div class="refs"><span class="ref">' + esc(worldMentionLabel(entry.group)) + '</span></div></div>'
  ).join("") + '</div></div>';
}
function renderWorldMentionGroups(mentions) {
  const knownGroups = new Set(worldMentionGroupLabels.map(([group]) => group));
  const dynamicGroups = Object.keys(mentions || {})
    .filter(group => !knownGroups.has(group))
    .sort((a, b) => a.localeCompare(b));
  const groups = [
      ...worldMentionGroupLabels,
      ...dynamicGroups.map(group => [group, worldMentionLabel(group)])
    ]
    .map(([group, label]) => relationGroup(label, (mentions[group] || []).map(mentionEntryLink)))
    .join("");
  const timeline = renderWorldMentionTimeline(mentions);
  return timeline + groups || '<p class="empty">No additional world mentions were found in the generated mention index.</p>';
}
function worldMentionsSection(kind, item) {
  if (!mentionConfig.kinds?.[kind]) return "";
  return '<h3>World Mentions</h3><div id="' + esc(worldMentionsElementId(kind, item.id)) + '" class="relations"><p class="empty">Loading world mentions...</p></div>';
}
async function renderWorldMentions(kind, item, requestId) {
  const element = document.getElementById(worldMentionsElementId(kind, item.id));
  if (!element) return;
  try {
    const mentions = await loadWorldMentions(kind, item.id);
    if (requestId !== renderRequestId) return;
    element.innerHTML = renderWorldMentionGroups(mentions);
  } catch (error) {
    if (requestId !== renderRequestId) return;
    element.innerHTML = '<div class="load-error"><p>' + esc(error instanceof Error ? error.message : String(error)) + '</p></div>';
  }
}
function renderAsyncDetailSections(kind, item, requestId) {
  if (item && mentionConfig.kinds?.[kind]) void renderWorldMentions(kind, item, requestId);
}

function personBiographySection(kind, item) {
  if (kind !== "people") return "";
  const overview = [
    '<span class="ref">' + esc((item.alive ? "alive" : "dead") + ", " + item.profession) + '</span>',
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    '<span class="ref">' + esc("born " + years(item.bornYear)) + '</span>',
    item.diedYear == null ? "" : '<span class="ref">' + esc("died " + years(item.diedYear)) + '</span>',
    '<span class="ref">' + esc("reputation " + reputationLabel(item.reputation)) + '</span>',
    '<span class="ref">' + esc("mind " + item.mentalState) + '</span>'
  ].filter(Boolean);
  const family = [
    ...(item.parentIds || []).slice(0, 2).map(id => "parent " + personLink(id)),
    item.spouseId == null ? "" : "spouse " + personLink(item.spouseId),
    ...siblingIds(item).slice(0, 4).map(id => "sibling " + personLink(id)),
    ...(item.childIds || []).slice(0, 4).map(id => "child " + personLink(id)),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId)
  ].filter(Boolean);
  const work = [
    ...(item.careerIds || []).slice(-4).map(careerLink),
    ...(item.skillRecordIds || []).slice(0, 4).map(skillLink),
    ...(item.writtenWorkIds || []).slice(0, 4).map(writtenWorkLink),
    ...(item.projectIds || []).slice(0, 4).map(projectLink),
    ...(item.holdingIds || []).slice(0, 4).map(holdingLink)
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Family and Home", family),
    relationGroup("Ancestors", sortedPeopleLinks(ancestorIds(item, 8), 8)),
    relationGroup("Descendants", sortedPeopleLinks(descendantIds(item, 8), 8)),
    relationGroup("Household Kin", sortedPeopleLinks(householdKinIds(item), 8)),
    relationGroup("Lineage Kin", sortedPeopleLinks(lineageKinIds(item), 8)),
    relationGroup("Work and Standing", work),
    relationGroup("Pressing Needs", (item.needStates || []).filter(need => needStatusLabel(need) === "unmet" || needStatusLabel(need) === "pressing").slice(0, 6).map(needPill)),
    relationGroup("Strongest Memories", strongestMemoryLinks(item, 6)),
    relationGroup("Recent Thoughts", recentThoughtLinks(item, 6)),
    relationGroup("Personality Shifts", personalityShiftLinks(item, 6)),
    relationGroup("Strong Opinions", keyOpinionLinks(item, 6)),
    relationGroup("Favors and Grudges", keySocialClaimLinks(item, 6)),
    relationGroup("Close Bonds", relationshipLinksByStatus(item, ["close", "trusted"], 6)),
    relationGroup("Strained Bonds", relationshipLinksByStatus(item, ["volatile", "strained"], 6)),
    relationGroup("Notable Events", notablePersonEvents(item, 12))
  ].join("");
  return inner ? '<h3>Life Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function lifeChapterRange(chapter) {
  const start = years(chapter.startYear);
  if (chapter.endYear == null || chapter.endYear === chapter.startYear) return start;
  return start + " to " + years(chapter.endYear);
}

let chapterIndexLookupSource = null;
let chapterIndexLookupCache = null;
function chapterIndexLookupKey(ownerKind, ownerId, chapterKind, startYear, endYear, title) {
  return [ownerKind, Number(ownerId), chapterKind || "", Number(startYear), endYear == null ? "" : Number(endYear), title || ""].join("|");
}
function chapterIndexLookup() {
  const source = indexMaps.chapters;
  if (source === chapterIndexLookupSource && chapterIndexLookupCache) return chapterIndexLookupCache;
  const lookup = new Map();
  for (const entry of source?.values?.() || []) {
    if (entry.ownerKind == null || entry.ownerId == null || entry.startYear == null) continue;
    const key = chapterIndexLookupKey(entry.ownerKind, entry.ownerId, entry.chapterKind || entry.kind, entry.startYear, entry.endYear, entry.title);
    if (!lookup.has(key)) lookup.set(key, entry);
  }
  chapterIndexLookupSource = source;
  chapterIndexLookupCache = lookup;
  return lookup;
}
function chapterIndexEntryFor(ownerKind, ownerId, chapter) {
  if (!ownerKind || ownerId == null || !chapter) return null;
  return chapterIndexLookup().get(chapterIndexLookupKey(ownerKind, ownerId, chapter.kind || chapter.chapterKind, chapter.startYear, chapter.endYear, chapter.title)) || null;
}
function chapterRecordLink(ownerKind, ownerId, chapter) {
  if (chapter?.chapterId != null) return link("chapters", chapter.chapterId, "chapter record", "ref");
  const entry = chapterIndexEntryFor(ownerKind, ownerId, chapter);
  return entry ? link("chapters", entry.id, "chapter record", "ref") : "";
}
function lifeChapterRefs(chapter, ownerKind, ownerId) {
  const refs = [
    chapterRecordLink(ownerKind, ownerId, chapter),
    ...(chapter.subjectRefs || []).map(refLink),
    ...(chapter.sourceEventIds || []).slice(0, 8).map(eventLink)
  ];
  const seen = new Set();
  return refs.filter(html => {
    if (!html || seen.has(html)) return false;
    seen.add(html);
    return true;
  }).slice(0, 18);
}

function chapterOwnerLink(item) {
  if (!item || item.ownerKind == null || item.ownerId == null) return "";
  return link(item.ownerKind, item.ownerId, item.ownerLabel || (String(item.ownerKind).replace(/-/g, " ") + " " + item.ownerId));
}

function chapterWikiSection(kind, item) {
  if (kind !== "chapters") return "";
  const owner = chapterOwnerLink(item);
  const places = [
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    item.fromSettlementId == null ? "" : "from " + settlementLink(item.fromSettlementId),
    item.toSettlementId == null ? "" : "to " + settlementLink(item.toSettlementId)
  ].filter(Boolean);
  const polities = [
    item.civilizationId == null ? "" : civLink(item.civilizationId),
    item.attackerCivilizationId == null ? "" : "attacker " + civLink(item.attackerCivilizationId),
    item.defenderCivilizationId == null ? "" : "defender " + civLink(item.defenderCivilizationId)
  ].filter(Boolean);
  const directRecords = [
    item.personId == null ? "" : personLink(item.personId),
    item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.roadId == null ? "" : roadLink(item.roadId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.mythId == null ? "" : mythLink(item.mythId),
    item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
    item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    item.sacredSiteId == null ? "" : sacredSiteLink(item.sacredSiteId)
  ].filter(Boolean);
  const inner = [
    relationGroup("Overview", [
      factPill((item.chapterType || "record") + " chapter"),
      factPill(item.chapterKind),
      factPill(lifeChapterRange(item)),
      factPill(item.status)
    ].filter(Boolean)),
    relationGroup("Owner", owner ? [owner] : []),
    relationGroup("Places", places),
    relationGroup("Polities", polities),
    relationGroup("Linked Records", directRecords),
    relationGroup("Subjects", (item.subjectRefs || []).slice(0, 16).map(refLink)),
    relationGroup("Source Events", (item.sourceEventIds || []).slice(0, 16).map(eventLink))
  ].join("");
  return inner ? '<h3>Chapter Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function personLifeChaptersSection(kind, item) {
  if (kind !== "people" || !(item.lifeChapters || []).length) return "";
  const order = {
    "birth-family": 0,
    home: 1,
    work: 2,
    "daily-life": 3,
    bonds: 4,
    "faith-culture": 5,
    "public-life": 6,
    "law-intrigue": 7,
    hardship: 8,
    "works-legacy": 9,
    death: 10
  };
  const chapters = (item.lifeChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99) || String(a.kind).localeCompare(String(b.kind)));
  return '<h3>Life Chapters</h3><div class="timeline life-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "people", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function relationshipChaptersSection(kind, item) {
  if (kind !== "relationships" || !(item.relationshipChapters || []).length) return "";
  const order = {
    formation: 0,
    "turning-points": 1,
    conversations: 2,
    "claims-obligations": 3,
    ending: 4
  };
  const chapters = (item.relationshipChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Relationship Chapters</h3><div class="timeline relationship-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "relationships", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function settlementPlaceChaptersSection(kind, item) {
  if (kind !== "settlements" || !(item.placeChapters || []).length) return "";
  const order = {
    "founding-control": 0,
    "people-families": 1,
    "building-work": 2,
    "roads-journeys": 3,
    "faith-culture": 4,
    "law-politics": 5,
    "conflict-hardship": 6,
    "memory-legacy": 7
  };
  const chapters = (item.placeChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Place Chapters</h3><div class="timeline place-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "settlements", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function artifactChaptersSection(kind, item) {
  if (kind !== "artifacts" || !(item.artifactChapters || []).length) return "";
  const order = {
    creation: 0,
    custody: 1,
    travel: 2,
    "conflict-capture": 3,
    "dedication-rites": 4,
    "work-use": 5,
    "records-memory": 6,
    "current-resting-place": 7
  };
  const chapters = (item.artifactChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Artifact Chapters</h3><div class="timeline artifact-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "artifacts", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function roadChaptersSection(kind, item) {
  if (kind !== "roads" || !(item.roadChapters || []).length) return "";
  const order = {
    "opening-route": 0,
    "traffic-journeys": 1,
    "trade-pilgrimage": 2,
    "conflict-danger": 3,
    "records-legacy": 4
  };
  const chapters = (item.roadChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Road Chapters</h3><div class="timeline road-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "roads", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function structureChaptersSection(kind, item) {
  if (kind !== "structures" || !(item.structureChapters || []).length) return "";
  const order = {
    construction: 0,
    institution: 1,
    "residents-households": 2,
    "work-training": 3,
    "rites-culture": 4,
    "law-hardship": 5,
    "assets-records": 6
  };
  const chapters = (item.structureChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Structure Chapters</h3><div class="timeline structure-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "structures", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function conflictChaptersSection(kind, item) {
  if (kind !== "conflicts" || !(item.conflictChapters || []).length) return "";
  const order = {
    outbreak: 0,
    "campaigns-battles": 1,
    "casualties-captures": 2,
    "control-aftermath": 3,
    "oaths-rumors": 4,
    "records-legacy": 5
  };
  const chapters = (item.conflictChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Conflict Chapters</h3><div class="timeline conflict-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "conflicts", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function battleChaptersSection(kind, item) {
  if (kind !== "battles" || !(item.battleChapters || []).length) return "";
  const order = {
    prelude: 0,
    "commanders-sides": 1,
    "fighting-outcome": 2,
    "casualties-wounds": 3,
    "spoils-control": 4,
    "records-memory": 5
  };
  const chapters = (item.battleChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Battle Chapters</h3><div class="timeline battle-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "battles", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function civilizationChaptersSection(kind, item) {
  if (kind !== "civilizations" || !(item.civilizationChapters || []).length) return "";
  const order = {
    "founding-expansion": 0,
    "rule-law": 1,
    "beliefs-goals": 2,
    "war-captures": 3,
    "roads-journeys": 4,
    "people-families": 5,
    "works-records": 6,
    "current-legacy": 7
  };
  const chapters = (item.civilizationChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Civilization Chapters</h3><div class="timeline civilization-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "civilizations", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function organizationChaptersSection(kind, item) {
  if (kind !== "organizations" || !(item.organizationChapters || []).length) return "";
  const order = {
    founding: 0,
    "leadership-membership": 1,
    "work-training": 2,
    "rites-beliefs": 3,
    "assets-works": 4,
    "records-legacy": 5
  };
  const chapters = (item.organizationChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Organization Chapters</h3><div class="timeline organization-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "organizations", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function householdChaptersSection(kind, item) {
  if (kind !== "households" || !(item.householdChapters || []).length) return "";
  const order = {
    "founding-family": 0,
    "homes-members": 1,
    "work-daily-life": 2,
    "bonds-obligations": 3,
    "hardship-memory": 4,
    "assets-legacy": 5
  };
  const chapters = (item.householdChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Household Chapters</h3><div class="timeline household-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "households", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function lineageChaptersSection(kind, item) {
  if (kind !== "lineages" || !(item.lineageChapters || []).length) return "";
  const order = {
    "founding-ancestors": 0,
    "households-branches": 1,
    "members-standing": 2,
    "work-training": 3,
    "conflict-hardship": 4,
    "records-legacy": 5
  };
  const chapters = (item.lineageChapters || [])
    .slice()
    .sort((a, b) => Number(a.startYear) - Number(b.startYear) || (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  return '<h3>Lineage Chapters</h3><div class="timeline lineage-chapters">' + chapters.map(chapter => {
    const refs = lifeChapterRefs(chapter, "lineages", item.id);
    return '<div class="event"><strong>' + esc(lifeChapterRange(chapter) + ': ' + chapter.title) + '</strong>' +
      '<p>' + esc(chapter.description || "") + '</p>' +
      '<div class="refs"><span class="ref">' + esc(chapter.kind) + '</span><span class="ref">' + esc(chapter.status) + '</span>' + refs.join("") + '</div></div>';
  }).join("") + '</div>';
}

function proseList(items) {
  const values = (items || []).filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return values[0] + " and " + values[1];
  return values.slice(0, -1).join(", ") + ", and " + values[values.length - 1];
}

function narrativeParagraphs(paragraphs) {
  const html = paragraphs.filter(Boolean).map(text => '<p>' + text + '</p>').join("");
  return html ? '<div class="narrative">' + html + '</div>' : "";
}

function personNarrative(kind, item) {
  if (kind !== "people") return "";
  const opening = esc(personFullName(item)) + (item.alive ? " is " : " was ") +
    esc(articleFor(item.profession) + " " + item.profession) + " of " + civLink(item.civilizationId) +
    " living in " + settlementLink(item.settlementId) + ". " +
    esc(item.alive ? "They were born " + years(item.bornYear) + "." : "They were born " + years(item.bornYear) + " and died " + years(item.diedYear) + ".");
  const household = [
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId)
  ].filter(Boolean);
  const familyBits = [
    ...(item.parentIds || []).slice(0, 2).map(id => "child of " + personLink(id)),
    item.spouseId == null ? "" : "spouse of " + personLink(item.spouseId),
    (item.childIds || []).length ? "parent of " + proseList((item.childIds || []).slice(0, 3).map(personLink)) : "",
    household.length ? "associated with " + proseList(household) : ""
  ].filter(Boolean);
  const family = familyBits.length ? esc(personFullName(item)) + " is recorded as " + proseList(familyBits) + "." : "";
  const workBits = [
    ...(item.careerIds || []).slice(-2).map(careerLink),
    ...(item.skillRecordIds || []).slice(0, 2).map(skillLink),
    ...(item.holdingIds || []).slice(0, 2).map(holdingLink)
  ];
  const work = workBits.length ? "Their public life is tied to " + proseList(workBits) + "." : "";
  const mind = "Their reputation is " + esc(reputationLabel(item.reputation)) + ", their mind is recorded as " + esc(item.mentalState) +
    ", and their strongest current needs are " + esc(needSummary(item).replace(/^needs /, "") || "steady") + ".";
  const memoryBits = [
    ...strongestMemoryLinks(item, 2),
    ...keyOpinionLinks(item, 2),
    ...keySocialClaimLinks(item, 2),
    ...personalityShiftLinks(item, 2),
    ...notablePersonEvents(item, 3)
  ];
  const memory = memoryBits.length ? "They are remembered through " + proseList(memoryBits) + "." : "";
  return narrativeParagraphs([opening, family, work, mind, memory]);
}

function articleFor(word) {
  return /^[aeiou]/i.test(String(word || "")) ? "an" : "a";
}

function settlementNarrative(kind, item) {
  if (kind !== "settlements") return "";
  const control = currentSettlementControl(item);
  const roads = settlementRoadLinks(item.id, 3);
  const residents = settlementNotablePeople(item.id, 4);
  const artifacts = settlementArtifactLinks(item, 3);
  const opening = settlementLink(item.id) + " is " + esc(articleFor(item.type) + " " + item.type) + " of " + civLink(item.civilizationId) +
    ", founded " + esc(years(item.foundedYear)) + " with a recorded population of " + esc(item.population) + ".";
  const rule = control ? "Its current recorded control is " + settlementControlLink(control.id) + "." : "";
  const people = residents.length ? "Notable figures associated with the place include " + proseList(residents) + "." : "";
  const placeLife = [
    roads.length ? "roads and journeys such as " + proseList(roads) : "",
    artifacts.length ? "artifacts such as " + proseList(artifacts) : "",
    (item.structureIds || []).length ? esc((item.structureIds || []).length + " structures") : ""
  ].filter(Boolean);
  const local = placeLife.length ? "The local record includes " + proseList(placeLife) + "." : "";
  return narrativeParagraphs([opening, rule, people, local]);
}

function artifactNarrative(kind, item) {
  if (kind !== "artifacts") return "";
  const holder = item.ownerAgentId == null ? settlementLink(item.ownerSettlementId) : personLink(item.ownerAgentId);
  const opening = artifactLink(item.id) + " is " + esc(articleFor(item.quality) + " " + item.quality + " " + item.material + " " + item.kind) +
    " created " + esc(years(item.createdYear)) + " by " + personLink(item.creatorAgentId) + ".";
  const held = "It is last recorded with " + holder + " in " + settlementLink(item.ownerSettlementId) +
    (item.structureId == null ? "." : " at " + structureLink(item.structureId) + ".");
  const provenance = (item.provenance || []).length
    ? "Its provenance records " + esc(item.provenance.length) + " turns in its history, including " + proseList(provenanceEventLinks(item, 3)) + "."
    : "";
  const records = [
    ...writtenWorksAbout("artifact", item.id, 2),
    ...rumorsAbout("artifact", item.id, 2),
    ...memoriesAbout("artifact", item.id, 2)
  ];
  const remembered = records.length ? "It appears in later records such as " + proseList(records) + "." : "";
  return narrativeParagraphs([opening, held, provenance, remembered]);
}

function eventNarrative(kind, item) {
  if (kind !== "events") return "";
  const refs = (item.entityRefs || []).slice(0, 6).map(refLink);
  const opening = eventLink(item.id) + " is a " + esc(item.type) + " event from " + esc(years(item.year)) + ".";
  const description = esc(item.description || item.headline || "");
  const participants = refs.length ? "The record links this event to " + proseList(refs) + "." : "";
  return narrativeParagraphs([opening, description, participants]);
}

function narrativeSection(kind, item) {
  return personNarrative(kind, item) ||
    settlementNarrative(kind, item) ||
    artifactNarrative(kind, item) ||
    eventNarrative(kind, item);
}

function clampMapPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number / 1000 * 100));
}

function mapSettlementFor(kind, item) {
  if (kind === "settlements") return item;
  if (kind === "sacred-sites") return item;
  if (kind === "people") return maps.settlements.get(item.settlementId);
  if (kind === "artifacts") return maps.settlements.get(item.ownerSettlementId || item.settlementId);
  if (kind === "story-hooks") return maps.settlements.get(item.settlementId);
  return null;
}

function mapContextText(kind, item, settlement) {
  const coordinates = esc(Math.round(settlement.x) + ", " + Math.round(settlement.y));
  if (kind === "settlements") {
    return settlementLink(settlement.id) + " is shown at map coordinates " + coordinates + ".";
  }
  if (kind === "people") {
    return personLink(item.id) + " is last recorded in " + settlementLink(settlement.id) + " at map coordinates " + coordinates + ".";
  }
  if (kind === "artifacts") {
    return artifactLink(item.id) + " is last recorded in " + settlementLink(settlement.id) + " at map coordinates " + coordinates + ".";
  }
  if (kind === "story-hooks") {
    return storyHookLink(item.id) + " is anchored near " + settlementLink(settlement.id) + " at map coordinates " + coordinates + ".";
  }
  if (kind === "sacred-sites") {
    return sacredSiteLink(item.id) + " is marked near " + settlementLink(item.settlementId) + " at map coordinates " + coordinates + ".";
  }
  return "";
}

function mapContextSection(kind, item) {
  const imagePath = data.viewerMap?.imagePath || "";
  if (!imagePath) return "";
  const settlement = mapSettlementFor(kind, item);
  if (!settlement || settlement.x == null || settlement.y == null) return "";
  const left = clampMapPercent(settlement.x).toFixed(2);
  const top = clampMapPercent(settlement.y).toFixed(2);
  return '<h3>Map Context</h3><div class="map-context"><div class="map-frame"><img src="' + esc(imagePath) + '" alt="Generated world map"><span class="map-marker" style="left:' + left + '%;top:' + top + '%" title="' + esc(settlement.name) + '"></span></div><p class="map-caption">' + mapContextText(kind, item, settlement) + '</p></div>';
}

function currentSettlementControl(settlement) {
  const controls = (settlement.controlIds || [])
    .map(id => maps["settlement-controls"].get(id))
    .filter(Boolean)
    .sort((a, b) => b.startedYear - a.startedYear || b.id - a.id);
  return controls.find(control => control.status === "active") || controls[0];
}

function settlementRoadLinks(settlementId, limit) {
  const indexed = indexLinks(
    "roads",
    road => road.fromSettlementId === settlementId || road.toSettlementId === settlementId,
    (a, b) => Number(b.strength || 0) - Number(a.strength || 0) || Number(a.openedYear || 0) - Number(b.openedYear || 0) || Number(a.id) - Number(b.id),
    limit || 8
  );
  if (indexed.length) return indexed;
  return data.roads
    .filter(road => road.fromSettlementId === settlementId || road.toSettlementId === settlementId)
    .sort((a, b) => b.strength - a.strength || a.openedYear - b.openedYear || a.id - b.id)
    .slice(0, limit || 8)
    .map(road => roadLink(road.id));
}

function settlementNotablePeople(settlementId, limit) {
  const indexed = indexLinks("people", person => person.settlementId === settlementId, byIndexReputation, limit || 10);
  if (indexed.length) return indexed;
  return data.people
    .filter(person => person.settlementId === settlementId)
    .sort((a, b) =>
      (b.alive ? 1 : 0) - (a.alive ? 1 : 0)
      || b.reputation - a.reputation
      || (b.epithets || []).length - (a.epithets || []).length
      || b.age - a.age
      || a.id - b.id
    )
    .slice(0, limit || 10)
    .map(person => personLink(person.id));
}

function settlementArtifactLinks(settlement, limit) {
  const structureIds = new Set(settlement.structureIds || []);
  const indexed = indexLinks(
    "artifacts",
    artifact =>
      artifact.settlementId === settlement.id ||
      artifact.ownerSettlementId === settlement.id ||
      (artifact.structureId != null && structureIds.has(artifact.structureId)),
    (a, b) => Number(b.renown || 0) - Number(a.renown || 0) || Number(a.createdYear || 0) - Number(b.createdYear || 0) || Number(a.id) - Number(b.id),
    limit || 8
  );
  if (indexed.length) return indexed;
  return data.artifacts
    .filter(artifact =>
      artifact.settlementId === settlement.id ||
      artifact.ownerSettlementId === settlement.id ||
      (artifact.structureId != null && structureIds.has(artifact.structureId))
    )
    .sort((a, b) => b.renown - a.renown || a.createdYear - b.createdYear || a.id - b.id)
    .slice(0, limit || 8)
    .map(artifact => artifactLink(artifact.id));
}

function recentEventLinksFor(item, limit) {
  return itemEvents(item)
    .slice()
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 10)
    .sort((a, b) => a.year - b.year || a.id - b.id)
    .map(event => eventLink(event.id));
}

function settlementWikiSection(kind, item) {
  if (kind !== "settlements") return "";
  const currentControl = currentSettlementControl(item);
  const overview = [
    '<span class="ref">' + esc(item.type) + '</span>',
    civLink(item.civilizationId),
    currentControl ? "current control " + settlementControlLink(currentControl.id) : "",
    '<span class="ref">' + esc("founded " + years(item.foundedYear)) + '</span>',
    '<span class="ref">' + esc("population " + item.population) + '</span>',
    '<span class="ref">' + esc("structures " + (item.structureIds || []).length) + '</span>'
  ].filter(Boolean);
  const institutions = [
    ...(item.structureIds || []).slice(0, 6).map(structureLink),
    ...indexLinks("organizations", organization => organization.settlementId === item.id, byIndexYearDesc, 4),
    ...indexLinks("offices", office => office.settlementId === item.id, byIndexYearDesc, 4),
    ...indexLinks("beliefs", belief => belief.originSettlementId === item.id, byIndexYearDesc, 3)
  ];
  const civicHistory = [
    ...(item.controlIds || []).slice(-6).map(settlementControlLink),
    ...conflictsAbout("settlement", item.id, 4),
    ...indexLinks("battles", battle => battle.settlementId === item.id, byIndexYearDesc, 4),
    ...indexLinks("laws", law => law.settlementId === item.id, byIndexYearDesc, 4),
    ...indexLinks("cases", legalCase => legalCase.settlementId === item.id, byIndexYearDesc, 4)
  ];
  const families = [
    ...indexLinks("households", household => household.settlementId === item.id, byIndexYearDesc, 6),
    ...indexLinks("lineages", lineage => lineage.originSettlementId === item.id || lineage.settlementId === item.id, byIndexYearDesc, 6)
  ];
  const roadsAndTravel = [
    ...settlementRoadLinks(item.id, 8),
    ...indexLinks("journeys", journey => journey.fromSettlementId === item.id || journey.toSettlementId === item.id, byIndexYearDesc, 8)
  ];
  const localLife = [
    ...(item.traditionIds || []).slice(0, 6).map(traditionLink),
    ...indexLinks("ceremonies", ceremony => ceremony.settlementId === item.id, byIndexYearDesc, 6),
    ...indexLinks("sacred-sites", site => site.settlementId === item.id, byIndexYearDesc, 4),
    ...indexLinks("activities", activity => activity.settlementId === item.id, byIndexYearDesc, 6),
    ...indexLinks("projects", project => project.settlementId === item.id, byIndexYearDesc, 6)
  ];
  const records = [
    ...indexLinks("chronicles", chronicle => chronicle.settlementId === item.id, byIndexYearDesc, 6),
    ...indexLinks("written-works", work => work.settlementId === item.id, byIndexYearDesc, 6),
    ...indexLinks("memories", memory => memory.settlementId === item.id, byIndexYearDesc, 6),
    ...indexLinks("opinions", opinion => opinion.settlementId === item.id, byIndexYearDesc, 6)
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Notable Residents", settlementNotablePeople(item.id, 10)),
    relationGroup("Institutions", institutions),
    relationGroup("Families", families),
    relationGroup("Roads and Journeys", roadsAndTravel),
    relationGroup("Civic History", civicHistory),
    relationGroup("Local Life", localLife),
    relationGroup("Artifacts", settlementArtifactLinks(item, 8)),
    relationGroup("Records", records),
    relationGroup("Recent Events", recentEventLinksFor(item, 10))
  ].join("");
  return inner ? '<h3>Place Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function provenanceEventLinks(artifact, limit) {
  return (artifact.provenance || [])
    .slice()
    .sort((a, b) => b.year - a.year || (b.eventId || 0) - (a.eventId || 0))
    .slice(0, limit || 8)
    .sort((a, b) => a.year - b.year || (a.eventId || 0) - (b.eventId || 0))
    .map(entry => {
      const label = years(entry.year) + ": " + provenanceKindLabel(entry.kind);
      return entry.eventId == null ? '<span class="ref">' + esc(label) + '</span>' : link("events", entry.eventId, label, "ref");
    });
}

function artifactConditionRecordLinks(artifact, limit) {
  const ids = artifact.conditionRecordIds || [];
  const byIds = ids.map(id => maps["artifact-conditions"].get(id)).filter(Boolean);
  const records = byIds.length
    ? byIds
    : data.artifactConditions.filter(record => record.artifactId === artifact.id);
  return records
    .slice()
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 8)
    .sort((a, b) => a.year - b.year || a.id - b.id)
    .map(record => artifactConditionLink(record.id));
}

function artifactWikiSection(kind, item) {
  if (kind !== "artifacts") return "";
  const holder = item.ownerAgentId == null ? settlementLink(item.ownerSettlementId) : personLink(item.ownerAgentId);
  const overview = [
    '<span class="ref">' + esc((item.scale || "personal") + " " + item.quality + " " + item.material + " " + item.kind) + '</span>',
    '<span class="ref">' + esc("purpose " + (item.purpose || "object")) + '</span>',
    '<span class="ref">' + esc((item.decorationKind || "plain") + " decoration") + '</span>',
    '<span class="ref">' + esc("condition " + (item.condition || "unknown")) + '</span>',
    item.value == null ? "" : '<span class="ref">' + esc("value " + item.value) + '</span>',
    '<span class="ref">' + esc("renown " + item.renown) + '</span>',
    '<span class="ref">' + esc("created " + years(item.createdYear)) + '</span>',
    "creator " + personLink(item.creatorAgentId),
    "holder " + holder,
    settlementLink(item.ownerSettlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.projectId == null ? "" : projectLink(item.projectId),
    civLink(item.civilizationId)
  ].filter(Boolean);
  const conflictAndTravel = [
    ...conflictsAbout("artifact", item.id, 6),
    ...data.battles.filter(battle => (battle.capturedArtifactIds || []).includes(item.id)).slice(0, 6).map(battle => battleLink(battle.id)),
    ...data.journeys.filter(journey => (journey.artifactIds || []).includes(item.id)).slice(0, 6).map(journey => journeyLink(journey.id))
  ];
  const sacredSites = Array.from(new Set((item.provenance || [])
    .filter(entry => entry.sacredSiteId != null)
    .map(entry => sacredSiteLink(entry.sacredSiteId))));
  const records = [
    ...chroniclesAbout("artifact", item.id, 6),
    ...writtenWorksAbout("artifact", item.id, 6),
    ...memoriesAbout("artifact", item.id, 6),
    ...opinionsAbout("artifact", item.id, 6),
    ...socialClaimsAbout("artifact", item.id, 6),
    ...rumorsAbout("artifact", item.id, 6)
  ];
  const vowsAndWork = [
    ...data.oaths.filter(oath => oath.targetArtifactId === item.id || (oath.subjectRefs || []).some(ref => ref.kind === "artifact" && ref.id === item.id)).slice(0, 6).map(oath => oathLink(oath.id)),
    ...ceremoniesAbout("artifact", item.id, 6),
    ...projectsAbout("artifact", item.id, 6),
    ...obligationsAbout("artifact", item.id, 6)
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Physical Detail", [
      item.detail ? '<span class="ref">' + esc(item.detail) + '</span>' : "",
      item.inscription ? '<span class="ref">' + esc('inscription "' + item.inscription + '"') + '</span>' : ""
    ].filter(Boolean)),
    relationGroup("Depicts", (item.depictionRefs || []).slice(0, 12).map(refLink)),
    relationGroup("Dedicated To", (item.dedicationRefs || []).slice(0, 12).map(refLink)),
    relationGroup("Condition Records", artifactConditionRecordLinks(item, 10)),
    relationGroup("Provenance Events", provenanceEventLinks(item, 8)),
    relationGroup("Sacred Sites", sacredSites),
    relationGroup("Conflict and Travel", conflictAndTravel),
    relationGroup("Ambitions", data.ambitions.filter(ambition => ambition.artifactId === item.id).slice(0, 6).map(ambition => ambitionLink(ambition.id))),
    relationGroup("Claims", socialClaimsAbout("artifact", item.id, 8)),
    relationGroup("Vows, Rites, and Work", vowsAndWork),
    relationGroup("Records", records),
    relationGroup("Recent Events", recentEventLinksFor(item, 10))
  ].join("");
  return inner ? '<h3>Artifact Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function roadWikiSection(kind, item) {
  if (kind !== "roads") return "";
  const traffic = data.journeys
    .filter(journey =>
      (journey.roadIds || []).includes(item.id) ||
      (journey.fromSettlementId === item.fromSettlementId && journey.toSettlementId === item.toSettlementId) ||
      (journey.fromSettlementId === item.toSettlementId && journey.toSettlementId === item.fromSettlementId)
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, 12)
    .map(journey => journeyLink(journey.id));
  const overview = [
    '<span class="ref">' + esc(item.type + " road") + '</span>',
    civLink(item.civilizationId),
    "from " + settlementLink(item.fromSettlementId),
    "to " + settlementLink(item.toSettlementId),
    '<span class="ref">' + esc("opened " + years(item.openedYear)) + '</span>',
    '<span class="ref">' + esc("length " + item.length) + '</span>',
    '<span class="ref">' + esc("strength " + item.strength) + '</span>',
    '<span class="ref">' + esc("cost " + item.cost) + '</span>'
  ];
  const linkedPlaces = [
    settlementLink(item.fromSettlementId),
    settlementLink(item.toSettlementId),
    ...data.settlements
      .filter(settlement => settlement.id !== item.fromSettlementId && settlement.id !== item.toSettlementId && settlement.civilizationId === item.civilizationId)
      .slice(0, 4)
      .map(settlement => settlementLink(settlement.id))
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Route", [settlementLink(item.fromSettlementId), settlementLink(item.toSettlementId)]),
    relationGroup("Traffic", traffic),
    relationGroup("Civilization Places", linkedPlaces)
  ].join("");
  return inner ? '<h3>Road Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function notablePeopleLinks(people, limit) {
  return people
    .slice()
    .sort((a, b) =>
      (b.alive ? 1 : 0) - (a.alive ? 1 : 0)
      || b.reputation - a.reputation
      || (b.epithets || []).length - (a.epithets || []).length
      || b.skill - a.skill
      || b.age - a.age
      || a.id - b.id
    )
    .slice(0, limit || 10)
    .map(person => personLink(person.id));
}

function notablePeopleByIds(ids, limit) {
  const idSet = new Set(ids || []);
  return notablePeopleLinks(data.people.filter(person => idSet.has(person.id)), limit);
}

function groupArtifactLinks(agentIds, structureIds, settlementIds, limit) {
  const agentSet = new Set(agentIds || []);
  const structureSet = new Set(structureIds || []);
  const settlementSet = new Set(settlementIds || []);
  return data.artifacts
    .filter(artifact =>
      agentSet.has(artifact.creatorAgentId) ||
      agentSet.has(artifact.ownerAgentId) ||
      structureSet.has(artifact.structureId) ||
      settlementSet.has(artifact.settlementId) ||
      settlementSet.has(artifact.ownerSettlementId)
    )
    .sort((a, b) => b.renown - a.renown || a.createdYear - b.createdYear || a.id - b.id)
    .slice(0, limit || 8)
    .map(artifact => artifactLink(artifact.id));
}

function artifactsAbout(refKind, id, limit) {
  return data.artifacts
    .filter(artifact =>
      (refKind === "person" && (artifact.creatorAgentId === id || artifact.ownerAgentId === id || (artifact.provenance || []).some(entry => entry.actorAgentId === id || entry.ownerAgentId === id || entry.previousOwnerAgentId === id || entry.recipientAgentId === id || entry.creatorAgentId === id))) ||
      (refKind === "settlement" && (artifact.settlementId === id || artifact.ownerSettlementId === id || (artifact.provenance || []).some(entry => entry.settlementId === id || entry.previousSettlementId === id))) ||
      (refKind === "structure" && (artifact.structureId === id || (artifact.provenance || []).some(entry => entry.structureId === id || entry.previousStructureId === id))) ||
      (refKind === "organization" && (artifact.provenance || []).some(entry => entry.organizationId === id)) ||
      (refKind === "belief" && (artifact.provenance || []).some(entry => entry.beliefId === id)) ||
      (refKind === "project" && (artifact.projectId === id || (artifact.provenance || []).some(entry => entry.projectId === id))) ||
      (refKind === "journey" && (artifact.provenance || []).some(entry => entry.journeyId === id)) ||
      (refKind === "sacred-site" && (artifact.provenance || []).some(entry => entry.sacredSiteId === id)) ||
      (refKind === "event" && ((artifact.eventIds || []).includes(id) || (artifact.provenance || []).some(entry => entry.eventId === id)))
    )
    .sort((a, b) => b.renown - a.renown || a.createdYear - b.createdYear || a.id - b.id)
    .slice(0, limit || 80)
    .map(artifact => artifactLink(artifact.id));
}

function artifactConditionsAbout(refKind, id, limit) {
  return data.artifactConditions
    .filter(record =>
      (record.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "artifact" && record.artifactId === id) ||
      (refKind === "person" && record.actorAgentId === id) ||
      (refKind === "settlement" && record.settlementId === id) ||
      (refKind === "civilization" && record.civilizationId === id) ||
      (refKind === "structure" && record.structureId === id) ||
      (refKind === "project" && record.projectId === id) ||
      (refKind === "battle" && record.battleId === id) ||
      (refKind === "event" && (record.sourceEventId === id || (record.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.severity - a.severity || a.id - b.id)
    .slice(0, limit || 80)
    .map(record => artifactConditionLink(record.id));
}

function civilizationWikiSection(kind, item) {
  if (kind !== "civilizations") return "";
  const settlements = data.settlements.filter(settlement => settlement.civilizationId === item.id);
  const people = data.people.filter(person => person.civilizationId === item.id);
  const structures = data.structures.filter(structure => structure.civilizationId === item.id);
  const organizations = data.organizations.filter(organization => organization.civilizationId === item.id);
  const overview = [
    item.status ? '<span class="ref">' + esc(item.status) + '</span>' : "",
    item.originKind ? '<span class="ref">' + esc(item.originKind) + '</span>' : "",
    '<span class="ref">' + esc("population " + item.population) + '</span>',
    "capital " + settlementLink(item.capitalSettlementId),
    item.creationDomain ? '<span class="ref">' + esc("creation " + item.creationDomain) + '</span>' : "",
    item.creationGodId == null ? "" : "creator " + godLink(item.creationGodId),
    item.creationSeatScore == null ? "" : '<span class="ref">' + esc("seat score " + item.creationSeatScore) + '</span>',
    '<span class="ref">' + esc("settlements " + settlements.length) + '</span>',
    '<span class="ref">' + esc("roads " + data.roads.filter(road => road.civilizationId === item.id).length) + '</span>',
    '<span class="ref">' + esc("organizations " + organizations.length) + '</span>',
    '<span class="ref">' + esc("traditions " + (item.traditionIds || []).length) + '</span>'
  ].filter(Boolean);
  const politics = [
    ...settlementControlsAbout("civilization", item.id, 6),
    ...data.offices.filter(office => office.civilizationId === item.id).slice(0, 6).map(office => officeLink(office.id)),
    ...data.laws.filter(law => law.civilizationId === item.id).slice(0, 6).map(law => lawLink(law.id)),
    ...conflictsAbout("civilization", item.id, 6)
  ];
  const places = [
    settlementLink(item.capitalSettlementId),
    ...settlements
      .filter(settlement => settlement.id !== item.capitalSettlementId)
      .sort((a, b) => b.population - a.population || a.foundedYear - b.foundedYear || a.id - b.id)
      .slice(0, 10)
      .map(settlement => settlementLink(settlement.id)),
    ...data.roads.filter(road => road.civilizationId === item.id).slice(0, 8).map(road => roadLink(road.id))
  ];
  const culture = [
    item.creationGodId == null ? "" : godLink(item.creationGodId),
    ...(item.traditionIds || []).slice(0, 8).map(traditionLink),
    ...data.beliefs.filter(belief => belief.civilizationId === item.id).slice(0, 6).map(belief => beliefLink(belief.id)),
    ...data.sacredSites.filter(site => site.civilizationId === item.id).slice(0, 6).map(site => sacredSiteLink(site.id)),
    ...organizations.slice(0, 8).map(organization => organizationLink(organization.id))
  ].filter(Boolean);
  const records = [
    ...data.chronicles.filter(chronicle => chronicle.civilizationId === item.id || (chronicle.subjectRefs || []).some(ref => ref.kind === "civilization" && ref.id === item.id)).slice(0, 8).map(chronicle => chronicleLink(chronicle.id)),
    ...writtenWorksAbout("civilization", item.id, 8),
    ...thoughtsAbout("civilization", item.id, 8),
    ...opinionsAbout("civilization", item.id, 8)
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Lifecycle", [
      item.parentCivilizationId == null ? "" : "parent " + civLink(item.parentCivilizationId),
      item.restoredCivilizationId == null ? "" : "restored " + civLink(item.restoredCivilizationId),
      item.foundedYear == null ? "" : '<span class="ref">' + esc("founded " + years(item.foundedYear)) + '</span>',
      item.fallenYear == null ? "" : '<span class="ref">' + esc("fallen " + years(item.fallenYear)) + '</span>',
      item.collapsePressure == null ? "" : '<span class="ref">' + esc("collapse pressure " + item.collapsePressure) + '</span>',
      item.collapseStage == null ? "" : '<span class="ref">' + esc("collapse stage " + item.collapseStage) + '</span>',
      ...((item.collapseFailureKinds || []).slice(0, 8).map(kind => '<span class="ref">' + esc(kind) + '</span>'))
    ].filter(Boolean)),
    relationGroup("Notable People", notablePeopleLinks(people, 12)),
    relationGroup("Places and Roads", places),
    relationGroup("Politics and War", politics),
    relationGroup("Culture and Institutions", culture),
    relationGroup("Homes and Lineages", [
      ...data.households.filter(household => household.civilizationId === item.id).slice(0, 8).map(household => householdLink(household.id)),
      ...data.lineages.filter(lineage => lineage.civilizationId === item.id).slice(0, 8).map(lineage => lineageLink(lineage.id))
    ]),
    relationGroup("Artifacts", groupArtifactLinks(people.map(person => person.id), structures.map(structure => structure.id), settlements.map(settlement => settlement.id), 10)),
    relationGroup("Records", records),
    relationGroup("Recent Events", recentEventLinksFor(item, 10))
  ].join("");
  return inner ? '<h3>Civilization Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function organizationWikiSection(kind, item) {
  if (kind !== "organizations") return "";
  const memberIds = item.memberIds || [];
  const overview = [
    '<span class="ref">' + esc(item.kind) + '</span>',
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    '<span class="ref">' + esc("founded " + years(item.foundedYear)) + '</span>',
    '<span class="ref">' + esc("members " + memberIds.length) + '</span>',
    item.leaderAgentId == null ? "" : "leader " + personLink(item.leaderAgentId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.beliefId == null ? "" : beliefLink(item.beliefId)
  ].filter(Boolean);
  const work = [
    ...careersAbout("organization", item.id, 8),
    ...data.apprenticeships.filter(apprenticeship => apprenticeship.organizationId === item.id).slice(0, 6).map(apprenticeship => apprenticeshipLink(apprenticeship.id)),
    ...projectsAbout("organization", item.id, 8),
    ...activitiesAbout("organization", item.id, 8)
  ];
  const records = [
    ...chroniclesAbout("organization", item.id, 8),
    ...writtenWorksAbout("organization", item.id, 8),
    ...memoriesAbout("organization", item.id, 8),
    ...opinionsAbout("organization", item.id, 8)
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Notable Members", notablePeopleByIds(memberIds, 12)),
    relationGroup("Membership Records", (item.membershipIds || []).slice(0, 12).map(membershipLink)),
    relationGroup("Work and Training", work),
    relationGroup("Rites and Gatherings", [
      ...traditionsAbout("organization", item.id, 8),
      ...ceremoniesAbout("organization", item.id, 8),
      ...ceremonyParticipationsAbout("organization", item.id, 8)
    ]),
    relationGroup("Assets", [
      ...holdingsAbout("organization", item.id, 8),
      ...belongingsAbout("organization", item.id, 8),
      ...groupArtifactLinks(memberIds, item.structureId == null ? [] : [item.structureId], [item.settlementId], 6)
    ]),
    relationGroup("Records", records),
    relationGroup("Recent Events", recentEventLinksFor(item, 10))
  ].join("");
  return inner ? '<h3>Organization Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function householdWikiSection(kind, item) {
  if (kind !== "households") return "";
  const memberIds = item.memberAgentIds || [];
  const overview = [
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    '<span class="ref">' + esc("founded " + years(item.foundedYear)) + '</span>',
    '<span class="ref">' + esc("members " + memberIds.length) + '</span>',
    item.residenceStructureId == null ? "" : structureLink(item.residenceStructureId),
    ...(item.lineageIds || []).slice(0, 4).map(lineageLink)
  ].filter(Boolean);
  const memberSet = new Set(memberIds);
  const familyRecords = [
    ...(item.founderAgentIds || []).slice(0, 4).map(personLink),
    ...unionsAbout("household", item.id, 8),
    ...data.memorials.filter(memorial => memberSet.has(memorial.personId)).slice(0, 8).map(memorial => memorialLink(memorial.id))
  ];
  const dailyLife = [
    ...residencesAbout("household", item.id, 8),
    ...careersAbout("household", item.id, 8),
    ...activitiesAbout("household", item.id, 8),
    ...data.illnesses.filter(illness => illness.householdId === item.id).slice(0, 6).map(illness => illnessLink(illness.id))
  ];
  const socialRecords = [
    ...data.ceremonies.filter(ceremony => (ceremony.participantAgentIds || []).some(id => memberSet.has(id))).slice(0, 6).map(ceremony => ceremonyLink(ceremony.id)),
    ...data.obligations.filter(obligation => memberSet.has(obligation.creditorAgentId) || memberSet.has(obligation.debtorAgentId) || (obligation.witnessAgentIds || []).some(id => memberSet.has(id))).slice(0, 8).map(obligation => obligationLink(obligation.id)),
    ...data.feuds.filter(feud => (feud.householdIds || []).includes(item.id)).slice(0, 6).map(feud => feudLink(feud.id))
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Notable Members", notablePeopleByIds(memberIds, 12)),
    relationGroup("Family Records", familyRecords),
    relationGroup("Daily Life", dailyLife),
    relationGroup("Assets", [
      ...holdingsAbout("household", item.id, 8),
      ...belongingsAbout("household", item.id, 10),
      ...groupArtifactLinks(memberIds, item.residenceStructureId == null ? [] : [item.residenceStructureId], [item.settlementId], 6)
    ]),
    relationGroup("Social Records", socialRecords),
    relationGroup("Records", [
      ...chroniclesAbout("household", item.id, 8),
      ...writtenWorksAbout("household", item.id, 8),
      ...memoriesAbout("household", item.id, 8),
      ...opinionsAbout("household", item.id, 8)
    ]),
    relationGroup("Recent Events", recentEventLinksFor(item, 10))
  ].join("");
  return inner ? '<h3>Household Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function lineageWikiSection(kind, item) {
  if (kind !== "lineages") return "";
  const memberIds = item.memberAgentIds || [];
  const memberSet = new Set(memberIds);
  const overview = [
    '<span class="ref">' + esc("family " + item.familyName) + '</span>',
    civLink(item.civilizationId),
    settlementLink(item.originSettlementId),
    "founder " + personLink(item.founderAgentId),
    '<span class="ref">' + esc("founded " + years(item.foundedYear)) + '</span>',
    '<span class="ref">' + esc("members " + memberIds.length) + '</span>',
    '<span class="ref">' + esc("households " + (item.householdIds || []).length) + '</span>'
  ];
  const standing = [
    ...data.offices.filter(office => memberSet.has(office.holderAgentId)).slice(0, 6).map(office => officeLink(office.id)),
    ...data.officeTerms.filter(term => memberSet.has(term.holderAgentId)).slice(0, 8).map(term => officeTermLink(term.id)),
    ...data.memorials.filter(memorial => memberSet.has(memorial.personId)).slice(0, 8).map(memorial => memorialLink(memorial.id)),
    ...data.feuds.filter(feud => (feud.lineageIds || []).includes(item.id)).slice(0, 6).map(feud => feudLink(feud.id))
  ];
  const works = [
    ...data.apprenticeships.filter(apprenticeship => apprenticeship.lineageId === item.id || memberSet.has(apprenticeship.mentorAgentId) || memberSet.has(apprenticeship.apprenticeAgentId)).slice(0, 8).map(apprenticeship => apprenticeshipLink(apprenticeship.id)),
    ...data.skills.filter(skill => memberSet.has(skill.agentId) || (skill.subjectRefs || []).some(ref => ref.kind === "lineage" && ref.id === item.id)).slice(0, 8).map(skill => skillLink(skill.id)),
    ...data.projects.filter(project => memberSet.has(project.leadAgentId) || (project.workerAgentIds || []).some(id => memberSet.has(id))).slice(0, 8).map(project => projectLink(project.id))
  ];
  const inner = [
    relationGroup("Overview", overview),
    relationGroup("Households", (item.householdIds || []).slice(0, 12).map(householdLink)),
    relationGroup("Notable Members", notablePeopleByIds(memberIds, 12)),
    relationGroup("Standing and Memory", standing),
    relationGroup("Work and Training", works),
    relationGroup("Artifacts", groupArtifactLinks(memberIds, [], [item.originSettlementId], 10)),
    relationGroup("Records", [
      ...chroniclesAbout("lineage", item.id, 8),
      ...writtenWorksAbout("lineage", item.id, 8),
      ...memoriesAbout("lineage", item.id, 8),
      ...opinionsAbout("lineage", item.id, 8)
    ]),
    relationGroup("Recent Events", recentEventLinksFor(item, 10))
  ].join("");
  return inner ? '<h3>Lineage Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function factPill(text) {
  return text ? '<span class="ref">' + esc(text) + '</span>' : "";
}

function recordLinksFor(refKind, id, limit) {
  return [
    ...chroniclesAbout(refKind, id, limit || 6),
    ...writtenWorksAbout(refKind, id, limit || 6),
    ...memoriesAbout(refKind, id, limit || 6),
    ...thoughtsAbout(refKind, id, limit || 6),
    ...opinionsAbout(refKind, id, limit || 6)
  ];
}

function mythicEchoLinksFor(refKind, id, limit) {
  return [
    ...rumorsAbout(refKind, id, limit || 6),
    ...secretsAbout(refKind, id, Math.max(3, Math.floor((limit || 6) / 2))),
    ...oathsAbout(refKind, id, limit || 6),
    ...obligationsAbout(refKind, id, limit || 6)
  ];
}

function naturalFeatureWikiSection(kind, item) {
  if (kind !== "natural-features") return "";
  const groups = [
    relationGroup("Overview", [
      factPill(item.kind),
      factPill("named " + years(item.year)),
      factPill("elevation " + item.elevation),
      factPill("rainfall " + item.rainfall),
      factPill("flow " + item.flow),
      factPill("prominence " + item.prominence)
    ]),
    relationGroup("Nearby Places", [
      ...(item.settlementIds || []).slice(0, 12).map(settlementLink),
      ...(item.sacredSiteIds || []).slice(0, 12).map(sacredSiteLink)
    ]),
    relationGroup("Roads and Journeys", [
      ...roadsAbout("natural-feature", item.id, 12),
      ...(item.journeyIds || []).slice(0, 12).map(journeyLink)
    ]),
    relationGroup("Culture and Memory", [
      ...traditionsAbout("natural-feature", item.id, 8),
      ...mythsAbout("natural-feature", item.id, 8),
      ...propheciesAbout("natural-feature", item.id, 8),
      ...sacredSitesAbout("natural-feature", item.id, 8)
    ]),
    relationGroup("Records", recordLinksFor("natural-feature", item.id, 8)),
    relationGroup("Social Echoes", mythicEchoLinksFor("natural-feature", item.id, 8)),
    relationGroup("Recent Events", recentEventLinksFor(item, 12))
  ];
  const inner = groups.join("");
  return inner ? '<h3>Natural Feature Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function mythicWikiSection(kind, item) {
  if (!["myths-magic", "beliefs", "gods", "commandments", "destinies", "miracles", "myths", "doctrines", "magic-roles", "prophecies", "civilization-goals", "sacred-sites"].includes(kind)) return "";
  let groups = [];

  if (kind === "myths-magic") {
    groups = [
      relationGroup("Overview", [
        civLink(item.civilizationId),
        "capital " + settlementLink(item.capitalSettlementId),
        factPill("belief roots " + (item.beliefIds || []).length),
        factPill("gods " + (item.godIds || []).length),
        factPill("commandments " + (item.commandmentIds || []).length),
        factPill("active destinies " + (item.activeDestinyIds || []).length),
        factPill("miracles " + (item.miracleIds || []).length),
        factPill("myths " + (item.mythIds || []).length),
        factPill("magic roles " + (item.magicRoleIds || []).length),
        factPill("open prophecies " + (item.openProphecyIds || []).length),
        factPill("active kingdom goals " + (item.activeCivilizationGoalIds || []).length),
        factPill("sacred sites " + (item.sacredSiteIds || []).length)
      ]),
      relationGroup("Religions and Myths", [
        ...(item.beliefIds || []).slice(0, 12).map(beliefLink),
        ...(item.mythIds || []).slice(0, 12).map(mythLink),
        ...(item.doctrineIds || []).slice(0, 12).map(doctrineLink)
      ]),
      relationGroup("Gods and Divine Controls", [
        ...(item.godIds || []).slice(0, 12).map(godLink),
        ...(item.commandmentIds || []).slice(0, 12).map(commandmentLink),
        ...(item.activeDestinyIds || []).slice(0, 12).map(destinyLink),
        ...(item.miracleIds || []).slice(-12).map(miracleLink)
      ]),
      relationGroup("Magic Roles and Holders", [
        ...(item.magicRoleIds || []).slice(0, 12).map(magicRoleLink),
        ...(item.magicRoleHolderIds || []).slice(0, 12).map(personLink)
      ]),
      relationGroup("Prophecies and Kingdom Goals", [
        ...(item.openProphecyIds || []).slice(0, 12).map(prophecyLink),
        ...(item.prophecyIds || []).filter(id => !(item.openProphecyIds || []).includes(id)).slice(0, 8).map(prophecyLink),
        ...(item.activeCivilizationGoalIds || []).slice(0, 12).map(civilizationGoalLink),
        ...(item.civilizationGoalIds || []).filter(id => !(item.activeCivilizationGoalIds || []).includes(id)).slice(0, 8).map(civilizationGoalLink)
      ]),
      relationGroup("Sacred Geography", (item.sacredSiteIds || []).slice(0, 14).map(sacredSiteLink)),
      relationGroup("Source Events", (item.sourceEventIds || []).slice(0, 18).map(eventLink)),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 24).map(refLink)),
      relationGroup("Social Echoes", [
        ...rumorsAbout("civilization", item.civilizationId, 8),
        ...secretsAbout("civilization", item.civilizationId, 6),
        ...oathsAbout("civilization", item.civilizationId, 8),
        ...schemesAbout("civilization", item.civilizationId, 8)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 12))
    ];
  } else if (kind === "beliefs") {
    groups = [
      relationGroup("Overview", [
        factPill(item.domain + " belief"),
        civLink(item.civilizationId),
        "origin " + settlementLink(item.originSettlementId),
        item.founderAgentId == null ? "" : "founder " + personLink(item.founderAgentId),
        item.patronGodId == null ? "" : "patron " + godLink(item.patronGodId),
        factPill("founded " + years(item.foundedYear)),
        factPill("adherents " + (item.adherentIds || []).length)
      ].filter(Boolean)),
      relationGroup("Myths, Magic, and Goals", [
        ...(item.godIds || []).slice(0, 8).map(godLink),
        ...(item.commandmentIds || []).slice(0, 8).map(commandmentLink),
        ...(item.destinyIds || []).slice(0, 8).map(destinyLink),
        ...(item.miracleIds || []).slice(-8).map(miracleLink),
        ...(item.mythIds || []).slice(0, 8).map(mythLink),
        ...(item.doctrineIds || []).slice(0, 8).map(doctrineLink),
        ...(item.magicRoleIds || []).slice(0, 8).map(magicRoleLink),
        ...(item.prophecyIds || []).slice(0, 8).map(prophecyLink),
        ...(item.civilizationGoalIds || []).slice(0, 8).map(civilizationGoalLink),
        ...sacredSitesAbout("belief", item.id, 8)
      ]),
      relationGroup("Communities", [
        ...(item.organizationIds || []).slice(0, 8).map(organizationLink),
        ...(item.structureIds || []).slice(0, 8).map(structureLink),
        ...traditionsAbout("belief", item.id, 8),
        ...ceremoniesAbout("belief", item.id, 8)
      ]),
      relationGroup("Notable Adherents", notablePeopleByIds(item.adherentIds || [], 12)),
      relationGroup("Adherence Records", (item.adherenceIds || []).slice(0, 12).map(beliefAdherenceLink)),
      relationGroup("Records", recordLinksFor("belief", item.id, 6)),
      relationGroup("Social Echoes", mythicEchoLinksFor("belief", item.id, 6)),
      relationGroup("Recent Events", recentEventLinksFor(item, 10))
    ];
  } else if (kind === "gods") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.temperament),
        factPill(item.domain),
        factPill("influence " + item.influence),
        factPill("favor " + item.favor),
        beliefLink(item.beliefId),
        civLink(item.civilizationId),
        "origin " + settlementLink(item.originSettlementId),
        factPill("named " + years(item.foundedYear))
      ]),
      relationGroup("Controls", [
        ...(item.controlSpheres || []).map(factPill),
        item.symbol ? factPill("symbol: " + item.symbol) : "",
        item.demand ? factPill("demand: " + item.demand) : "",
        item.omen ? factPill("omen: " + item.omen) : "",
        item.miracleBias ? factPill("miracle bias: " + item.miracleBias) : "",
        item.commandmentStyle ? factPill("commandments: " + item.commandmentStyle) : ""
      ].filter(Boolean)),
      relationGroup("Divine Control Notes", [
        item.creationClaim ? factPill("creation: " + item.creationClaim) : "",
        item.religiousMandate ? factPill("religion: " + item.religiousMandate) : "",
        item.prophecyMethod ? factPill("prophecy: " + item.prophecyMethod) : "",
        item.destinyPressure ? factPill("destiny: " + item.destinyPressure) : ""
      ].filter(Boolean)),
      relationGroup("Founding Seat", [
        item.originSettlementId == null ? "" : settlementLink(item.originSettlementId),
        ...mythsAbout("god", item.id, 8)
      ]),
      relationGroup("Religion and Law", [
        ...(item.commandmentIds || []).slice(0, 12).map(commandmentLink),
        ...(item.mythIds || []).slice(0, 12).map(mythLink),
        ...(item.doctrineIds || []).slice(0, 12).map(doctrineLink),
        ...(item.magicRoleIds || []).slice(0, 12).map(magicRoleLink)
      ]),
      relationGroup("Destiny, Prophecy, and Miracles", [
        ...(item.destinyIds || []).slice(0, 12).map(destinyLink),
        ...(item.prophecyIds || []).slice(0, 12).map(prophecyLink),
        ...(item.miracleIds || []).slice(-12).map(miracleLink),
        ...(item.civilizationGoalIds || []).slice(0, 12).map(civilizationGoalLink),
        ...(item.sacredSiteIds || []).slice(0, 12).map(sacredSiteLink)
      ]),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("god", item.id, 8)),
      relationGroup("Social Echoes", mythicEchoLinksFor("god", item.id, 8)),
      relationGroup("Recent Events", recentEventLinksFor(item, 12))
    ];
  } else if (kind === "commandments") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " commandment"),
        factPill(item.domain),
        factPill("severity " + item.severity),
        beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
        civLink(item.civilizationId),
        settlementLink(item.settlementId),
        factPill("given " + years(item.givenYear))
      ].filter(Boolean)),
      relationGroup("Teaching", [
        factPill("demand: " + item.demand),
        factPill("virtue: " + item.virtue),
        factPill("taboo: " + item.taboo)
      ]),
      relationGroup("Kingdom Goals", (item.civilizationGoalIds || []).slice(0, 12).map(civilizationGoalLink)),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("commandment", item.id, 8)),
      relationGroup("Social Echoes", mythicEchoLinksFor("commandment", item.id, 8)),
      relationGroup("Recent Events", recentEventLinksFor(item, 12))
    ];
  } else if (kind === "destinies") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " destiny"),
        factPill(item.status),
        factPill("pressure " + item.pressure),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
        civLink(item.civilizationId),
        settlementLink(item.settlementId),
        factPill(years(item.year) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear)))
      ].filter(Boolean)),
      relationGroup("Targets", [
        item.targetAgentId == null ? "" : personLink(item.targetAgentId),
        item.targetSettlementId == null ? "" : settlementLink(item.targetSettlementId),
        item.targetArtifactId == null ? "" : artifactLink(item.targetArtifactId)
      ].filter(Boolean)),
      relationGroup("Events", [
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
        item.resolvedEventId == null ? "" : eventLink(item.resolvedEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("destiny", item.id, 8)),
      relationGroup("Social Echoes", mythicEchoLinksFor("destiny", item.id, 8)),
      relationGroup("Recent Events", recentEventLinksFor(item, 12))
    ];
  } else if (kind === "miracles") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " miracle"),
        factPill("strength " + item.strength),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
        item.sacredSiteId == null ? "" : sacredSiteLink(item.sacredSiteId),
        civLink(item.civilizationId),
        settlementLink(item.settlementId),
        factPill(years(item.year))
      ].filter(Boolean)),
      relationGroup("Effect", [
        factPill(item.effect),
        item.targetAgentId == null ? "" : "target " + personLink(item.targetAgentId)
      ].filter(Boolean)),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("miracle", item.id, 8)),
      relationGroup("Social Echoes", mythicEchoLinksFor("miracle", item.id, 8)),
      relationGroup("Recent Events", recentEventLinksFor(item, 12))
    ];
  } else if (kind === "myths") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " myth"),
        factPill(item.domain),
        beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        civLink(item.civilizationId),
        "origin " + settlementLink(item.originSettlementId),
        item.centralAgentId == null ? "" : "central figure " + personLink(item.centralAgentId),
        factPill(years(item.year))
      ].filter(Boolean)),
      relationGroup("Doctrine and Aims", [
        ...doctrinesAbout("myth", item.id, 8),
        ...civilizationGoalsAbout("myth", item.id, 8),
        ...magicRolesAbout("myth", item.id, 8),
        ...propheciesAbout("myth", item.id, 8),
        ...sacredSitesAbout("myth", item.id, 8)
      ]),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("myth", item.id, 6)),
      relationGroup("Social Echoes", mythicEchoLinksFor("myth", item.id, 6)),
      relationGroup("Recent Events", recentEventLinksFor(item, 10))
    ];
  } else if (kind === "doctrines") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " doctrine"),
        factPill(item.domain),
        beliefLink(item.beliefId),
        item.mythId == null ? "" : mythLink(item.mythId),
        item.godId == null ? "" : godLink(item.godId),
        item.commandmentId == null ? "" : commandmentLink(item.commandmentId),
        civLink(item.civilizationId),
        "origin " + settlementLink(item.originSettlementId),
        factPill("founded " + years(item.foundedYear))
      ].filter(Boolean)),
      relationGroup("Teaching", [
        factPill("principle: " + item.principle),
        factPill("virtue: " + item.virtue),
        factPill("taboo: " + item.taboo)
      ]),
      relationGroup("Goals and Practice", [
        ...(item.civilizationGoalIds || []).slice(0, 12).map(civilizationGoalLink),
        ...sacredSitesAbout("doctrine", item.id, 8),
        ...ceremoniesAbout("doctrine", item.id, 8),
        ...activitiesAbout("doctrine", item.id, 8)
      ]),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("doctrine", item.id, 6)),
      relationGroup("Social Echoes", mythicEchoLinksFor("doctrine", item.id, 6)),
      relationGroup("Recent Events", recentEventLinksFor(item, 10))
    ];
  } else if (kind === "magic-roles") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.status),
        "holder " + personLink(item.agentId),
        civLink(item.civilizationId),
        settlementLink(item.settlementId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.mythId == null ? "" : mythLink(item.mythId),
        factPill(years(item.startedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear)))
      ].filter(Boolean)),
      relationGroup("Prophecy Work and Kingdom Aims", [
        ...(item.prophecyIds || []).slice(0, 12).map(prophecyLink),
        ...(item.civilizationGoalIds || []).slice(0, 12).map(civilizationGoalLink),
        ...sacredSitesAbout("magic-role", item.id, 8),
        ...thoughtsAbout("magic-role", item.id, 8)
      ]),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("magic-role", item.id, 6)),
      relationGroup("Social Echoes", mythicEchoLinksFor("magic-role", item.id, 6)),
      relationGroup("Recent Events", recentEventLinksFor(item, 10))
    ];
  } else if (kind === "prophecies") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " prophecy"),
        factPill(item.status),
        factPill("strength " + item.strength),
        civLink(item.civilizationId),
        settlementLink(item.settlementId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        item.destinyId == null ? "" : destinyLink(item.destinyId),
        item.mythId == null ? "" : mythLink(item.mythId),
        item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
        factPill(years(item.year) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear)))
      ].filter(Boolean)),
      relationGroup("People and Targets", [
        item.speakerAgentId == null ? "" : "speaker " + personLink(item.speakerAgentId),
        item.targetAgentId == null ? "" : "target " + personLink(item.targetAgentId),
        item.targetSettlementId == null ? "" : "target " + settlementLink(item.targetSettlementId),
        item.targetArtifactId == null ? "" : "target " + artifactLink(item.targetArtifactId),
        item.ambitionId == null ? "" : ambitionLink(item.ambitionId)
      ].filter(Boolean)),
      relationGroup("Kingdom Links", [
        ...(item.civilizationGoalIds || []).slice(0, 12).map(civilizationGoalLink),
        item.destinyId == null ? "" : destinyLink(item.destinyId),
        ...miraclesAbout("prophecy", item.id, 8),
        ...sacredSitesAbout("prophecy", item.id, 8)
      ].filter(Boolean)),
      relationGroup("Events", [
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
        item.resolvedEventId == null ? "" : eventLink(item.resolvedEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("prophecy", item.id, 6)),
      relationGroup("Social Echoes", mythicEchoLinksFor("prophecy", item.id, 8)),
      relationGroup("Recent Events", recentEventLinksFor(item, 10))
    ];
  } else if (kind === "civilization-goals") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " goal"),
        factPill(item.status),
        factPill("priority " + item.priority),
        civLink(item.civilizationId),
        item.settlementId == null ? "" : settlementLink(item.settlementId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        item.commandmentId == null ? "" : commandmentLink(item.commandmentId),
        item.destinyId == null ? "" : destinyLink(item.destinyId),
        item.mythId == null ? "" : mythLink(item.mythId),
        item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
        item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
        item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
        factPill(years(item.startedYear) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear)))
      ].filter(Boolean)),
      relationGroup("Targets", [
        item.targetSettlementId == null ? "" : settlementLink(item.targetSettlementId),
        item.targetArtifactId == null ? "" : artifactLink(item.targetArtifactId),
        item.targetCivilizationId == null ? "" : civLink(item.targetCivilizationId)
      ].filter(Boolean)),
      relationGroup("Action and Ritual", [
        ...data.ambitions.filter(ambition => ambition.civilizationGoalId === item.id).slice(0, 10).map(ambitionLink),
        ...miraclesAbout("civilization-goal", item.id, 8),
        ...sacredSitesAbout("civilization-goal", item.id, 8),
        ...projectsAbout("civilization-goal", item.id, 8),
        ...ceremoniesAbout("civilization-goal", item.id, 8),
        ...oathsAbout("civilization-goal", item.id, 8)
      ]),
      relationGroup("Events", [
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
        item.resolvedEventId == null ? "" : eventLink(item.resolvedEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("civilization-goal", item.id, 6)),
      relationGroup("Social Echoes", mythicEchoLinksFor("civilization-goal", item.id, 8)),
      relationGroup("Recent Events", recentEventLinksFor(item, 10))
    ];
  } else if (kind === "sacred-sites") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill("renown " + item.renown),
        civLink(item.civilizationId),
        settlementLink(item.settlementId),
        item.founderAgentId == null ? "" : "founder " + personLink(item.founderAgentId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.godId == null ? "" : godLink(item.godId),
        item.mythId == null ? "" : mythLink(item.mythId),
        item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
        item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
        item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
        factPill("founded " + years(item.foundedYear))
      ].filter(Boolean)),
      relationGroup("Pilgrimage and Relics", [
        ...journeysAbout("sacred-site", item.id, 10),
        ...artifactsAbout("sacred-site", item.id, 10),
        ...miraclesAbout("sacred-site", item.id, 10),
        ...ceremoniesAbout("sacred-site", item.id, 8),
        ...projectsAbout("sacred-site", item.id, 8)
      ]),
      relationGroup("Subjects", (item.subjectRefs || []).slice(0, 18).map(refLink)),
      relationGroup("Records", recordLinksFor("sacred-site", item.id, 6)),
      relationGroup("Social Echoes", mythicEchoLinksFor("sacred-site", item.id, 8)),
      relationGroup("Recent Events", recentEventLinksFor(item, 10))
    ];
  }

  const inner = groups.join("");
  return inner ? '<h3>Mythic Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function uniqueLinkList(links, limit) {
  const seen = new Set();
  const result = [];
  for (const linkHtml of links || []) {
    if (!linkHtml || seen.has(linkHtml)) continue;
    seen.add(linkHtml);
    result.push(linkHtml);
    if (result.length >= (limit || 16)) break;
  }
  return result;
}

function subjectLinks(item, limit) {
  return (item.subjectRefs || []).slice(0, limit || 16).map(refLink);
}

function storyHookWikiSection(kind, item) {
  if (kind !== "story-hooks") return "";
  const focus = [
    item.personId == null ? "" : personLink(item.personId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
    item.secretId == null ? "" : secretLink(item.secretId),
    item.feudId == null ? "" : feudLink(item.feudId),
    item.oathId == null ? "" : oathLink(item.oathId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
    item.godId == null ? "" : godLink(item.godId),
    item.beliefId == null ? "" : beliefLink(item.beliefId)
  ].filter(Boolean);
  const sourceRefs = uniqueLinkList((item.seedRefs || item.subjectRefs || []).map(refLink), 18);
  const events = (item.eventIds || []).slice(0, 14).map(eventLink);
  const overview = [
    factPill(item.kind + " hook"),
    factPill("tone " + item.tone),
    factPill("score " + item.score),
    factPill("urgency " + item.urgency),
    factPill(years(item.year)),
    item.civilizationId == null ? "" : civLink(item.civilizationId)
  ].filter(Boolean);
  const narrative = narrativeParagraphs([
    esc(item.prompt || ""),
    esc(item.stakes || ""),
    esc(item.complication || ""),
    esc(item.suggestedFocus || "")
  ]);
  const groups = [
    relationGroup("Overview", overview),
    relationGroup("Focus", focus),
    relationGroup("Source Records", sourceRefs),
    relationGroup("Timeline Seeds", events)
  ].join("");
  return '<h3>Story Hook</h3>' + narrative + (groups ? '<div class="relations">' + groups + '</div>' : "");
}

function recordEchoLinks(refKind, id, limit) {
  return uniqueLinkList([
    ...chroniclesAbout(refKind, id, 5),
    ...writtenWorksAbout(refKind, id, 5),
    ...burialsAbout(refKind, id, 5),
    ...deathRecordsAbout(refKind, id, 5),
    ...birthsAbout(refKind, id, 5),
    ...ageMilestonesAbout(refKind, id, 5),
    ...appearanceFeaturesAbout(refKind, id, 5),
    ...memoriesAbout(refKind, id, 5),
    ...thoughtsAbout(refKind, id, 5),
    ...personalityShiftsAbout(refKind, id, 5),
    ...ambitionsAbout(refKind, id, 4),
    ...opinionsAbout(refKind, id, 5),
    ...socialClaimsAbout(refKind, id, 5),
    ...conversationsAbout(refKind, id, 5),
    ...reputationMilestonesAbout(refKind, id, 5),
    ...relationshipMilestonesAbout(refKind, id, 5),
    ...testimoniesAbout(refKind, id, 4),
    ...rumorsAbout(refKind, id, 5),
    ...secretsAbout(refKind, id, 5),
    ...schemesAbout(refKind, id, 4),
    ...feudsAbout(refKind, id, 4),
    ...oathsAbout(refKind, id, 4),
    ...organizationRanksAbout(refKind, id, 4),
    ...possessionAttachmentsAbout(refKind, id, 4),
    ...obligationsAbout(refKind, id, 4)
  ], limit || 18);
}

function recordWikiSection(kind, item) {
  if (!["memories", "thoughts", "personality-shifts", "opinions", "social-claims", "conversations", "rumors", "secrets", "schemes", "feuds", "oaths", "obligations", "holdings", "belongings", "possession-attachments", "estates"].includes(kind)) return "";
  let groups = [];

  if (kind === "memories") {
    groups = [
      relationGroup("Overview", [
        factPill(item.emotion + " memory"),
        factPill("intensity " + item.intensity),
        factPill("stress " + item.stressImpact),
        factPill(years(item.year)),
        personLink(item.agentId),
        item.settlementId == null ? "" : settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Source and Subjects", [
        eventLink(item.sourceEventId),
        ...subjectLinks(item, 14)
      ]),
      relationGroup("Aftereffects", [
        ...thoughtsAbout("memory", item.id, 8),
        ...personalityShiftsAbout("memory", item.id, 8),
        ...ambitionsAbout("memory", item.id, 8),
        ...opinionsAbout("memory", item.id, 8),
        ...socialClaimsAbout("memory", item.id, 8),
        ...conversationsAbout("memory", item.id, 8),
        ...testimoniesAbout("memory", item.id, 6)
      ]),
      relationGroup("Social Echoes", recordEchoLinks("memory", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "thoughts") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " thought"),
        factPill("tone " + item.tone),
        factPill("intensity " + item.intensity),
        factPill("mood " + item.moodDelta),
        factPill("stress " + item.stressDelta),
        factPill(years(item.year)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Cause", [
        item.sourceMemoryId == null ? "" : memoryLink(item.sourceMemoryId),
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
        item.activityId == null ? "" : activityLink(item.activityId),
        item.ceremonyId == null ? "" : ceremonyLink(item.ceremonyId),
        item.preferenceId == null ? "" : preferenceLink(item.preferenceId),
        item.traditionId == null ? "" : traditionLink(item.traditionId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Aftereffects", [
        ...opinionsAbout("thought", item.id, 8),
        ...rumorsAbout("thought", item.id, 8),
        ...secretsAbout("thought", item.id, 8),
        ...oathsAbout("thought", item.id, 8)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "personality-shifts") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        item.trait == null ? "" : factPill("trait " + item.trait),
        item.value == null ? "" : factPill("value " + item.value),
        factPill("intensity " + item.intensity),
        factPill(years(item.year)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Cause", [
        memoryLink(item.sourceMemoryId),
        eventLink(item.sourceEventId)
      ]),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Social Echoes", recordEchoLinks("personality-shift", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "opinions") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " opinion"),
        factPill("intensity " + item.intensity),
        factPill("valence " + item.valence),
        factPill("formed " + years(item.year)),
        factPill("updated " + years(item.updatedYear)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Target and Source", [
        item.targetRef == null ? "" : refLink(item.targetRef),
        memoryLink(item.sourceMemoryId),
        eventLink(item.sourceEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Claims", socialClaimsAbout("opinion", item.id, 8)),
      relationGroup("Social Echoes", recordEchoLinks("opinion", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "social-claims") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.status),
        factPill("intensity " + item.intensity),
        factPill("formed " + years(item.year)),
        item.resolvedYear == null ? "" : factPill("resolved " + years(item.resolvedYear)),
        personLink(item.agentId),
        personLink(item.targetAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Source", [
        opinionLink(item.sourceOpinionId),
        memoryLink(item.sourceMemoryId),
        eventLink(item.sourceEventId),
        item.relationshipId == null ? "" : relationshipLink(item.relationshipId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Social Echoes", recordEchoLinks("social-claim", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "conversations") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill("tone " + item.tone),
        factPill(years(item.year)),
        "speaker " + personLink(item.speakerAgentId),
        "listener " + personLink(item.listenerAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Context", [
        item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
        item.activityId == null ? "" : activityLink(item.activityId),
        item.teachingId == null ? "" : teachingLink(item.teachingId),
        item.rumorId == null ? "" : rumorLink(item.rumorId),
        item.secretId == null ? "" : secretLink(item.secretId),
        item.memoryId == null ? "" : memoryLink(item.memoryId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.traditionId == null ? "" : traditionLink(item.traditionId),
        item.artifactId == null ? "" : artifactLink(item.artifactId),
        eventLink(item.sourceEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Aftereffects", [
        ...memoriesAbout("conversation", item.id, 8),
        ...thoughtsAbout("conversation", item.id, 8),
        ...opinionsAbout("conversation", item.id, 8),
        ...testimoniesAbout("conversation", item.id, 6),
        ...rumorsAbout("conversation", item.id, 6),
        ...secretsAbout("conversation", item.id, 6)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "rumors") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " rumor"),
        factPill("strength " + item.strength),
        factPill("certainty " + item.certainty),
        factPill(years(item.year)),
        item.tellerAgentId == null ? "" : "first teller " + personLink(item.tellerAgentId),
        settlementLink(item.originSettlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Spread", [
        ...(item.spreadSettlementIds || []).slice(0, 8).map(settlementLink),
        ...(item.spreadAgentIds || []).slice(0, 10).map(personLink)
      ]),
      relationGroup("Source and Subjects", [
        eventLink(item.sourceEventId),
        ...subjectLinks(item, 14)
      ]),
      relationGroup("Consequences", [
        ...conversationsAbout("rumor", item.id, 10),
        ...testimoniesAbout("rumor", item.id, 6),
        ...secretsAbout("rumor", item.id, 6),
        ...feudsAbout("rumor", item.id, 6),
        ...obligationsAbout("rumor", item.id, 6)
      ]),
      relationGroup("Records", recordLinksFor("rumor", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "secrets") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " secret"),
        factPill(item.status),
        factPill("severity " + item.severity),
        factPill(years(item.year) + (item.revealedYear == null ? "" : " to " + years(item.revealedYear))),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Keepers", (item.keeperAgentIds || []).slice(0, 12).map(personLink)),
      relationGroup("Source and Reveal", [
        eventLink(item.sourceEventId),
        item.revealedEventId == null ? "" : eventLink(item.revealedEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Consequences", [
        ...conversationsAbout("secret", item.id, 10),
        ...testimoniesAbout("secret", item.id, 6),
        ...schemesAbout("secret", item.id, 8),
        ...feudsAbout("secret", item.id, 6),
        ...oathsAbout("secret", item.id, 6),
        ...obligationsAbout("secret", item.id, 6)
      ]),
      relationGroup("Records", recordLinksFor("secret", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "schemes") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " scheme"),
        factPill(item.status),
        factPill("secrecy " + item.secrecy),
        factPill("progress " + item.progress),
        factPill("heat " + item.heat),
        factPill(years(item.startedYear) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear))),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Conspirators", [
        "leader " + personLink(item.leaderAgentId),
        ...(item.conspiratorAgentIds || []).slice(0, 10).map(personLink)
      ]),
      relationGroup("Targets", [
        item.targetAgentId == null ? "" : personLink(item.targetAgentId),
        item.targetOfficeId == null ? "" : officeLink(item.targetOfficeId),
        item.targetCaseId == null ? "" : caseLink(item.targetCaseId),
        item.targetSecretId == null ? "" : secretLink(item.targetSecretId),
        item.targetAmbitionId == null ? "" : ambitionLink(item.targetAmbitionId),
        item.targetFeudId == null ? "" : feudLink(item.targetFeudId),
        item.targetProphecyId == null ? "" : prophecyLink(item.targetProphecyId),
        item.targetCivilizationGoalId == null ? "" : civilizationGoalLink(item.targetCivilizationGoalId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
        item.resolvedEventId == null ? "" : eventLink(item.resolvedEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Fallout", recordEchoLinks("scheme", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "feuds") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " feud"),
        factPill(item.status),
        factPill("severity " + item.severity),
        factPill(years(item.startedYear) + (item.settledYear == null ? "" : " to " + years(item.settledYear))),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Sides", [
        ...(item.sideAAgentIds || []).slice(0, 8).map(personLink),
        ...(item.sideBAgentIds || []).slice(0, 8).map(personLink)
      ]),
      relationGroup("Families", [
        ...(item.householdIds || []).slice(0, 8).map(householdLink),
        ...(item.lineageIds || []).slice(0, 8).map(lineageLink)
      ]),
      relationGroup("Events and Subjects", [
        eventLink(item.sourceEventId),
        item.settledEventId == null ? "" : eventLink(item.settledEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Escalation and Settlement", [
        ...schemesAbout("feud", item.id, 8),
        ...oathsAbout("feud", item.id, 8),
        ...obligationsAbout("feud", item.id, 8),
        ...rumorsAbout("feud", item.id, 8),
        ...secretsAbout("feud", item.id, 8)
      ]),
      relationGroup("Records", recordLinksFor("feud", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "oaths") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " oath"),
        factPill(item.status),
        factPill("strength " + item.strength),
        factPill(years(item.swornYear) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear))),
        personLink(item.swearerAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Witnesses", (item.witnessAgentIds || []).slice(0, 10).map(personLink)),
      relationGroup("Targets", [
        item.targetAgentId == null ? "" : personLink(item.targetAgentId),
        item.targetSettlementId == null ? "" : settlementLink(item.targetSettlementId),
        item.targetArtifactId == null ? "" : artifactLink(item.targetArtifactId),
        item.targetFeudId == null ? "" : feudLink(item.targetFeudId),
        item.targetSecretId == null ? "" : secretLink(item.targetSecretId),
        item.targetBeliefId == null ? "" : beliefLink(item.targetBeliefId),
        item.targetProphecyId == null ? "" : prophecyLink(item.targetProphecyId),
        item.targetCivilizationGoalId == null ? "" : civilizationGoalLink(item.targetCivilizationGoalId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        eventLink(item.sourceEventId),
        item.resolvedEventId == null ? "" : eventLink(item.resolvedEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Consequences", [
        ...obligationsAbout("oath", item.id, 10),
        ...feudsAbout("oath", item.id, 8),
        ...rumorsAbout("oath", item.id, 8),
        ...secretsAbout("oath", item.id, 8)
      ]),
      relationGroup("Records", recordLinksFor("oath", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "obligations") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " obligation"),
        factPill(item.status),
        factPill("amount " + item.amount),
        factPill(years(item.createdYear) + (item.resolvedYear == null ? "" : " to " + years(item.resolvedYear))),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Parties", [
        "creditor " + personLink(item.creditorAgentId),
        "debtor " + personLink(item.debtorAgentId),
        ...(item.witnessAgentIds || []).slice(0, 8).map(personLink)
      ]),
      relationGroup("Basis", [
        eventLink(item.sourceEventId),
        item.resolvedEventId == null ? "" : eventLink(item.resolvedEventId),
        item.artifactId == null ? "" : artifactLink(item.artifactId),
        item.caseId == null ? "" : caseLink(item.caseId),
        item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
        item.projectId == null ? "" : projectLink(item.projectId),
        item.oathId == null ? "" : oathLink(item.oathId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Social Echoes", recordEchoLinks("obligation", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "holdings") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " holding"),
        factPill(item.status),
        factPill("value " + item.value),
        factPill(years(item.foundedYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear))),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Holder", [
        item.ownerAgentId == null ? "" : personLink(item.ownerAgentId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.officeId == null ? "" : officeLink(item.officeId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        eventLink(item.sourceEventId),
        item.transferredEventId == null ? "" : eventLink(item.transferredEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Contents and Claims", [
        ...belongingsAbout("holding", item.id, 10),
        ...obligationsAbout("holding", item.id, 8),
        ...oathsAbout("holding", item.id, 6),
        ...feudsAbout("holding", item.id, 6)
      ]),
      relationGroup("Records", recordLinksFor("holding", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "belongings") {
    groups = [
      relationGroup("Overview", [
        factPill(item.material + " " + item.kind),
        factPill(item.status),
        factPill("value " + item.value),
        factPill("sentiment " + item.sentiment),
        factPill(years(item.acquiredYear) + (item.endedYear == null ? "" : " to " + years(item.endedYear))),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Holder", [
        item.ownerAgentId == null ? "" : personLink(item.ownerAgentId),
        item.previousOwnerAgentId == null ? "" : "previous " + personLink(item.previousOwnerAgentId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.holdingId == null ? "" : holdingLink(item.holdingId),
        item.structureId == null ? "" : structureLink(item.structureId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        eventLink(item.sourceEventId),
        item.transferredEventId == null ? "" : eventLink(item.transferredEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Social Echoes", recordEchoLinks("belonging", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "possession-attachments") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " attachment"),
        factPill("intensity " + item.intensity),
        factPill(years(item.year)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Object", [
        item.artifactId == null ? "" : artifactLink(item.artifactId),
        item.belongingId == null ? "" : belongingLink(item.belongingId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId)
      ].filter(Boolean)),
      relationGroup("Source and Memories", [
        eventLink(item.sourceEventId),
        ...(item.memoryIds || []).slice(0, 10).map(memoryLink),
        ...subjectLinks(item, 12)
      ]),
      relationGroup("Social Echoes", recordEchoLinks("possession-attachment", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "estates") {
    groups = [
      relationGroup("Overview", [
        factPill("estate settlement"),
        factPill(years(item.year)),
        factPill("heirs " + (item.heirAgentIds || []).length),
        factPill("assets " + ((item.artifactIds || []).length + (item.holdingIds || []).length + (item.belongingIds || []).length)),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("People and Family", [
        "decedent " + personLink(item.decedentAgentId),
        ...(item.heirAgentIds || []).slice(0, 8).map(personLink),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId),
        item.memorialId == null ? "" : memorialLink(item.memorialId)
      ].filter(Boolean)),
      relationGroup("Assets", [
        ...(item.artifactIds || []).slice(0, 8).map(artifactLink),
        ...(item.holdingIds || []).slice(0, 8).map(holdingLink),
        ...(item.belongingIds || []).slice(0, 8).map(belongingLink)
      ]),
      relationGroup("Disputes", [
        ...(item.disputeCaseIds || []).slice(0, 6).map(caseLink),
        ...(item.disputeFeudIds || []).slice(0, 6).map(feudLink),
        ...(item.disputeRumorIds || []).slice(0, 6).map(rumorLink),
        ...(item.disputeOathIds || []).slice(0, 6).map(oathLink)
      ]),
      relationGroup("Events and Subjects", [
        eventLink(item.deathEventId),
        ...(item.transferredEventIds || []).slice(0, 8).map(eventLink),
        ...subjectLinks(item, 12)
      ]),
      relationGroup("Social Echoes", recordEchoLinks("estate", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  }

  const inner = groups.join("");
  return inner ? '<h3>Record Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function lifePeriod(startYear, endYear) {
  return years(startYear) + (endYear == null ? "" : " to " + years(endYear));
}

function lifeMilestoneWikiSection(kind, item) {
  if (!["births", "age-milestones", "appearance-features", "epithets", "reputation-milestones", "residences", "careers", "journeys", "relationships", "relationship-milestones", "unions", "ambitions", "apprenticeships", "skills", "injuries", "illnesses", "care-records", "wound-legacies", "memorials", "burials", "death-records"].includes(kind)) return "";
  let groups = [];

  if (kind === "births") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill("born " + years(item.year)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Parents and Kin", [
        ...(item.parentAgentIds || []).slice(0, 2).map(id => "parent " + personLink(id)),
        item.unionId == null ? "" : unionLink(item.unionId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId)
      ].filter(Boolean)),
      relationGroup("Place and Belief", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.beliefId == null ? "" : beliefLink(item.beliefId)
      ].filter(Boolean)),
      relationGroup("Source and Subjects", [
        eventLink(item.birthEventId),
        ...subjectLinks(item, 12)
      ]),
      relationGroup("Life Echoes", recordEchoLinks("birth", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "age-milestones") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill("age " + item.age),
        factPill(item.previousProfession + " to " + item.newProfession),
        factPill(years(item.year)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Work Transition", [
        item.careerId == null ? "" : careerLink(item.careerId),
        eventLink(item.sourceEventId)
      ].filter(Boolean)),
      relationGroup("House and Place", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId),
        item.structureId == null ? "" : structureLink(item.structureId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Life Echoes", recordEchoLinks("age-milestone", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "appearance-features") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill("visibility " + item.visibility),
        factPill(years(item.year)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Traits", (item.traits || []).map(factPill)),
      relationGroup("Source", [
        eventLink(item.sourceEventId),
        item.birthId == null ? "" : birthLink(item.birthId),
        item.ageMilestoneId == null ? "" : ageMilestoneLink(item.ageMilestoneId),
        item.woundLegacyId == null ? "" : woundLegacyLink(item.woundLegacyId)
      ].filter(Boolean)),
      relationGroup("House and Line", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Life Echoes", recordEchoLinks("appearance-feature", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "epithets") {
    groups = [
      relationGroup("Overview", [
        factPill(item.epithet),
        factPill("earned " + years(item.year)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Name and Kin", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId),
        factPill(item.reason)
      ].filter(Boolean)),
      relationGroup("Source and Subjects", [
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Life Echoes", recordEchoLinks("epithet", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "reputation-milestones") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill("reputation " + item.previousReputation + " to " + item.reputation),
        factPill(years(item.year)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Name and Cause", [
        item.epithetId == null ? "" : epithetRecordLink(item.epithetId),
        eventLink(item.sourceEventId),
        factPill(item.reason)
      ].filter(Boolean)),
      relationGroup("House and Line", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Life Echoes", recordEchoLinks("reputation-milestone", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "residences") {
    groups = [
      relationGroup("Overview", [
        factPill(item.reason + " residence"),
        factPill(item.status),
        factPill(lifePeriod(item.startYear, item.endYear)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Home", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.structureId == null ? "" : structureLink(item.structureId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Life Echoes", recordEchoLinks("residence", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "careers") {
    groups = [
      relationGroup("Overview", [
        factPill(item.profession + " career"),
        factPill(item.status),
        factPill("started by " + item.reason),
        item.endReason == null ? "" : factPill("ended by " + item.endReason),
        factPill(lifePeriod(item.startYear, item.endYear)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Workplace", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.officeId == null ? "" : officeLink(item.officeId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Work Echoes", recordEchoLinks("career", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "journeys") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " journey"),
        factPill("distance " + item.distance),
        factPill(years(item.year)),
        civLink(item.civilizationId),
        "from " + settlementLink(item.fromSettlementId),
        "to " + settlementLink(item.toSettlementId)
      ]),
      relationGroup("Route and Purpose", [
        item.originStructureId == null ? "" : structureLink(item.originStructureId),
        item.destinationStructureId == null ? "" : structureLink(item.destinationStructureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.sacredSiteId == null ? "" : sacredSiteLink(item.sacredSiteId),
        ...(item.roadIds || []).slice(0, 8).map(roadLink)
      ].filter(Boolean)),
      relationGroup("Travelers and Cargo", [
        ...(item.participantAgentIds || []).slice(0, 12).map(personLink),
        ...(item.artifactIds || []).slice(0, 8).map(artifactLink)
      ]),
      relationGroup("Personal Aims", data.ambitions.filter(ambition => ambition.journeyId === item.id).slice(0, 8).map(ambition => ambitionLink(ambition.id))),
      relationGroup("Journey Echoes", recordEchoLinks("journey", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "relationships") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " bond"),
        ...relationshipFacetPills(item),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("People", (item.agentIds || []).map(personLink)),
      relationGroup("Context", [
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.lastInteractionEventId == null ? "" : eventLink(item.lastInteractionEventId),
        item.lastInteractionYear == null ? "" : factPill("last interacted " + years(item.lastInteractionYear))
      ].filter(Boolean)),
      relationGroup("Shared Life", [
        ...data.apprenticeships.filter(apprenticeship => apprenticeship.relationshipId === item.id).slice(0, 8).map(apprenticeship => apprenticeshipLink(apprenticeship.id)),
        ...conversationsAbout("relationship", item.id, 10),
        ...obligationsAbout("relationship", item.id, 8)
      ]),
      relationGroup("Memories and Opinions", [
        ...memoriesAbout("relationship", item.id, 8),
        ...opinionsAbout("relationship", item.id, 8),
        ...chroniclesAbout("relationship", item.id, 5)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "relationship-milestones") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.status),
        factPill(years(item.year)),
        relationshipLink(item.relationshipId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("People", (item.agentIds || []).map(personLink)),
      relationGroup("Cause", [
        eventLink(item.sourceEventId),
        item.socialClaimId == null ? "" : socialClaimLink(item.socialClaimId),
        item.conversationId == null ? "" : conversationLink(item.conversationId)
      ].filter(Boolean)),
      relationGroup("Bond State", [
        ...relationshipFacetPills(item),
        factPill("strength " + item.strength)
      ]),
      relationGroup("Life Echoes", recordEchoLinks("relationship-milestone", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "unions") {
    groups = [
      relationGroup("Overview", [
        factPill("union"),
        factPill(item.status),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Partners and Children", [
        ...(item.partnerAgentIds || []).map(personLink),
        ...(item.childAgentIds || []).slice(0, 12).map(personLink)
      ]),
      relationGroup("Home and Lineage", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.structureId == null ? "" : structureLink(item.structureId),
        ...(item.lineageIds || []).slice(0, 8).map(lineageLink)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        item.startEventId == null ? "" : eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Family Echoes", recordEchoLinks("union", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "ambitions") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " ambition"),
        factPill(item.status),
        item.targetWealth == null ? "" : factPill("target wealth " + item.targetWealth),
        factPill(lifePeriod(item.startedYear, item.resolvedYear)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Targets", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.officeId == null ? "" : officeLink(item.officeId),
        item.artifactId == null ? "" : artifactLink(item.artifactId),
        item.journeyId == null ? "" : journeyLink(item.journeyId),
        item.memorialId == null ? "" : memorialLink(item.memorialId)
      ].filter(Boolean)),
      relationGroup("Belief and Purpose", [
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.mythId == null ? "" : mythLink(item.mythId),
        item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
        item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
        item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Pursuit Echoes", recordEchoLinks("ambition", item.id, 16)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "apprenticeships") {
    groups = [
      relationGroup("Overview", [
        factPill(item.specialty + " apprenticeship"),
        factPill(item.status),
        factPill(lifePeriod(item.startedYear, item.completedYear)),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("People", [
        "mentor " + personLink(item.mentorAgentId),
        "apprentice " + personLink(item.apprenticeAgentId)
      ]),
      relationGroup("Institutional Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
        item.lineageId == null ? "" : lineageLink(item.lineageId)
      ].filter(Boolean)),
      relationGroup("Learning Records", [
        ...skillsAbout("apprenticeship", item.id, 8),
        ...teachingsAbout("apprenticeship", item.id, 8),
        ...obligationsAbout("apprenticeship", item.id, 8)
      ]),
      relationGroup("Memories and Opinions", recordEchoLinks("apprenticeship", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "skills") {
    groups = [
      relationGroup("Overview", [
        factPill(item.specialty + " skill"),
        factPill(item.rank),
        factPill("level " + item.level),
        factPill("practice " + item.practiceCount),
        factPill(lifePeriod(item.startedYear, item.updatedYear)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Practice Sources", [
        ...(item.sourceEventIds || []).slice(0, 8).map(eventLink),
        ...(item.projectIds || []).slice(0, 8).map(projectLink),
        ...(item.apprenticeshipIds || []).slice(0, 8).map(apprenticeshipLink),
        ...teachingsAbout("skill", item.id, 8)
      ]),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Reputation Echoes", recordEchoLinks("skill", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "injuries") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.severity),
        factPill(item.status),
        factPill(lifePeriod(item.year, item.healedYear)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.battleId == null ? "" : battleLink(item.battleId),
        item.caseId == null ? "" : caseLink(item.caseId),
        item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId)
      ].filter(Boolean)),
      relationGroup("Related Care", [
        ...battleParticipationsAbout("injury", item.id, 6),
        ...(item.careRecordIds || []).slice(0, 8).map(careRecordLink),
        ...illnessesAbout("injury", item.id, 6),
        ...woundLegaciesAbout("injury", item.id, 6),
        ...projectsAbout("injury", item.id, 6),
        ...obligationsAbout("injury", item.id, 6)
      ]),
      relationGroup("Memories and Records", recordEchoLinks("injury", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "illnesses") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.severity),
        factPill(item.status),
        factPill(lifePeriod(item.onsetYear, item.resolvedYear)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Symptoms and Care", [
        ...(item.symptoms || []).map(factPill),
        injuryLink(item.injuryId),
        ...(item.careRecordIds || []).slice(0, 8).map(careRecordLink),
        ...woundLegaciesAbout("illness", item.id, 6),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.structureId == null ? "" : structureLink(item.structureId),
        item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        eventLink(item.onsetEventId),
        item.resolvedEventId == null ? "" : eventLink(item.resolvedEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Illness Echoes", recordEchoLinks("illness", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "care-records") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.outcome),
        factPill(years(item.year)),
        factPill("health " + item.healthDelta),
        factPill("morale " + item.moraleDelta),
        personLink(item.patientAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Caregivers and Place", [
        item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.structureId == null ? "" : structureLink(item.structureId)
      ].filter(Boolean)),
      relationGroup("Medical Record", [
        injuryLink(item.injuryId),
        item.illnessId == null ? "" : illnessLink(item.illnessId),
        ...woundLegaciesAbout("care-record", item.id, 6),
        eventLink(item.sourceEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Echoes", recordEchoLinks("care-record", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "wound-legacies") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.severity),
        factPill(years(item.year)),
        factPill("health " + item.healthImpact),
        factPill("stress " + item.stressImpact),
        factPill("reputation " + item.reputationImpact),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Source Record", [
        injuryLink(item.injuryId),
        item.illnessId == null ? "" : illnessLink(item.illnessId),
        item.careRecordId == null ? "" : careRecordLink(item.careRecordId),
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId)
      ].filter(Boolean)),
      relationGroup("People and Place", [
        item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.structureId == null ? "" : structureLink(item.structureId)
      ].filter(Boolean)),
      relationGroup("Battle Context", [
        item.battleId == null ? "" : battleLink(item.battleId),
        item.battleParticipationId == null ? "" : battleParticipationLink(item.battleParticipationId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Echoes", recordEchoLinks("wound-legacy", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "memorials") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " memorial"),
        factPill(years(item.year)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Place and Belief", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.battleId == null ? "" : battleLink(item.battleId)
      ].filter(Boolean)),
      relationGroup("Inscription", [factPill(item.inscription)]),
      relationGroup("Legacy", [
        ...data.ambitions.filter(ambition => ambition.memorialId === item.id).slice(0, 8).map(ambition => ambitionLink(ambition.id)),
        ...obligationsAbout("memorial", item.id, 8),
        ...recordEchoLinks("memorial", item.id, 12)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "burials") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " burial"),
        factPill(years(item.year)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Resting Place", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.battleId == null ? "" : battleLink(item.battleId),
        item.memorialId == null ? "" : memorialLink(item.memorialId)
      ].filter(Boolean)),
      relationGroup("Death and Mourners", [
        eventLink(item.deathEventId),
        ...(item.mournerAgentIds || []).slice(0, 10).map(personLink)
      ]),
      relationGroup("Grave Goods", [
        ...(item.graveGoodArtifactIds || []).slice(0, 8).map(artifactLink),
        ...(item.graveGoodBelongingIds || []).slice(0, 8).map(belongingLink)
      ]),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Echoes", recordEchoLinks("burial", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "death-records") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " death"),
        factPill("age " + item.age),
        factPill(years(item.year)),
        personLink(item.personId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Circumstances", [
        eventLink(item.sourceEventId),
        item.battleId == null ? "" : battleLink(item.battleId),
        item.battleParticipationId == null ? "" : battleParticipationLink(item.battleParticipationId),
        ...(item.injuryIds || []).slice(0, 8).map(injuryLink),
        ...(item.illnessIds || []).slice(0, 8).map(illnessLink)
      ].filter(Boolean)),
      relationGroup("Aftermath", [
        item.memorialId == null ? "" : memorialLink(item.memorialId),
        item.burialId == null ? "" : burialLink(item.burialId),
        item.estateId == null ? "" : estateLink(item.estateId)
      ].filter(Boolean)),
      relationGroup("House and Belief", [
        item.householdId == null ? "" : householdLink(item.householdId),
        item.lineageId == null ? "" : lineageLink(item.lineageId),
        item.beliefId == null ? "" : beliefLink(item.beliefId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Echoes", recordEchoLinks("death-record", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  }

  const inner = groups.join("");
  return inner ? '<h3>Life Milestone Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function institutionalWikiSection(kind, item) {
  if (!["preferences", "traditions", "memberships", "organization-ranks", "belief-adherences", "offices", "office-terms", "laws", "cases", "testimonies", "ceremonies", "ceremony-participations", "activities", "teachings", "projects", "project-participations", "chronicles", "written-works"].includes(kind)) return "";
  let groups = [];

  if (kind === "preferences") {
    groups = [
      relationGroup("Overview", [
        factPill(item.sentiment + " " + item.kind),
        factPill(item.targetName),
        factPill("strength " + item.strength),
        factPill("recorded " + years(item.recordedYear)),
        personLink(item.agentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Reason", [factPill(item.reason)]),
      relationGroup("Source and Subjects", [
        item.recordedEventId == null ? "" : eventLink(item.recordedEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Practice", [
        ...activitiesAbout("preference", item.id, 8),
        ...thoughtsAbout("preference", item.id, 8),
        ...opinionsAbout("preference", item.id, 8)
      ]),
      relationGroup("Echoes", recordEchoLinks("preference", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "traditions") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " tradition"),
        factPill("strength " + item.strength),
        factPill("practices " + item.practiceCount),
        factPill("origin " + years(item.originYear)),
        item.founderAgentId == null ? "" : "founder " + personLink(item.founderAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Institutional Roots", [
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.activityKind == null ? "" : factPill("activity " + item.activityKind),
        item.ceremonyKind == null ? "" : factPill("ceremony " + item.ceremonyKind)
      ].filter(Boolean)),
      relationGroup("Adherents and Practice", [
        ...(item.adherentAgentIds || []).slice(0, 10).map(personLink),
        ...(item.activityIds || []).slice(0, 8).map(activityLink),
        ...(item.ceremonyIds || []).slice(0, 8).map(ceremonyLink),
        ...(item.writtenWorkIds || []).slice(0, 8).map(writtenWorkLink)
      ]),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Echoes", recordEchoLinks("tradition", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "memberships") {
    groups = [
      relationGroup("Overview", [
        factPill(item.role),
        factPill(item.status),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        personLink(item.agentId),
        organizationLink(item.organizationId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Institutional Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.currentRankId == null ? "" : "current rank " + organizationRankLink(item.currentRankId)
      ].filter(Boolean)),
      relationGroup("Rank Progression", (item.rankIds || []).slice(0, 12).map(organizationRankLink)),
      relationGroup("Events and Subjects", [
        item.startEventId == null ? "" : eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Work and Memory", [
        ...careersAbout("membership", item.id, 8),
        ...recordEchoLinks("membership", item.id, 12)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "organization-ranks") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " rank"),
        factPill("duty " + item.duty),
        factPill(item.status),
        factPill("prestige " + item.prestige),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        personLink(item.agentId),
        organizationLink(item.organizationId),
        membershipLink(item.membershipId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Institutional Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.sponsorAgentId == null ? "" : "sponsor " + personLink(item.sponsorAgentId),
        item.previousRankId == null ? "" : "previous " + organizationRankLink(item.previousRankId)
      ].filter(Boolean)),
      relationGroup("Source and Subjects", [
        item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Work and Echoes", [
        ...careersAbout("organization-rank", item.id, 6),
        ...teachingsAbout("organization-rank", item.id, 6),
        ...recordEchoLinks("organization-rank", item.id, 14)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "belief-adherences") {
    groups = [
      relationGroup("Overview", [
        factPill(item.status),
        item.endReason == null ? "" : factPill("ended by " + item.endReason),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        personLink(item.agentId),
        beliefLink(item.beliefId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        item.startEventId == null ? "" : eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Faith Practice", [
        ...ceremoniesAbout("belief-adherence", item.id, 8),
        ...projectsAbout("belief-adherence", item.id, 8),
        ...oathsAbout("belief-adherence", item.id, 8)
      ]),
      relationGroup("Echoes", recordEchoLinks("belief-adherence", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "offices") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " office"),
        factPill("created " + years(item.createdYear)),
        civLink(item.civilizationId),
        item.settlementId == null ? "" : settlementLink(item.settlementId),
        item.holderAgentId == null ? "" : "current holder " + personLink(item.holderAgentId),
        item.structureId == null ? "" : structureLink(item.structureId)
      ].filter(Boolean)),
      relationGroup("Terms and Law", [
        ...(item.termIds || []).slice(0, 10).map(officeTermLink),
        ...data.laws.filter(law => law.officeId === item.id).slice(0, 8).map(law => lawLink(law.id)),
        ...data.cases.filter(legalCase => legalCase.officeId === item.id).slice(0, 8).map(legalCase => caseLink(legalCase.id))
      ]),
      relationGroup("Court and Ceremony", [
        ...testimoniesAbout("office", item.id, 8),
        ...ceremoniesAbout("office", item.id, 8),
        ...projectsAbout("office", item.id, 8)
      ]),
      relationGroup("Records", recordLinksFor("office", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "office-terms") {
    groups = [
      relationGroup("Overview", [
        factPill(item.status),
        factPill("started by " + item.startReason),
        item.endReason == null ? "" : factPill("ended by " + item.endReason),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        personLink(item.holderAgentId),
        officeLink(item.officeId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Seat", [
        item.settlementId == null ? "" : settlementLink(item.settlementId),
        item.structureId == null ? "" : structureLink(item.structureId)
      ].filter(Boolean)),
      relationGroup("Events and Subjects", [
        item.startEventId == null ? "" : eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Term Actions", [
        ...data.laws.filter(law => law.officeId === item.officeId && law.enactedYear >= item.startedYear && (item.endedYear == null || law.enactedYear <= item.endedYear)).slice(0, 8).map(law => lawLink(law.id)),
        ...data.cases.filter(legalCase => legalCase.officeId === item.officeId && legalCase.openedYear >= item.startedYear && (item.endedYear == null || legalCase.openedYear <= item.endedYear)).slice(0, 8).map(legalCase => caseLink(legalCase.id))
      ]),
      relationGroup("Echoes", recordEchoLinks("office-term", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "laws") {
    groups = [
      relationGroup("Overview", [
        factPill(item.domain + " law"),
        factPill("strictness " + item.strictness),
        factPill("enacted " + years(item.enactedYear)),
        officeLink(item.officeId),
        item.authorAgentId == null ? "" : "author " + personLink(item.authorAgentId),
        item.settlementId == null ? "" : settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Cases and Testimony", [
        ...data.cases.filter(legalCase => legalCase.lawId === item.id).slice(0, 10).map(legalCase => caseLink(legalCase.id)),
        ...testimoniesAbout("law", item.id, 10)
      ]),
      relationGroup("Records and Obligations", [
        ...recordLinksFor("law", item.id, 10),
        ...obligationsAbout("law", item.id, 8)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "cases") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " case"),
        factPill(item.verdict),
        factPill(lifePeriod(item.openedYear, item.closedYear)),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("People", [
        "accused " + personLink(item.accusedAgentId),
        item.victimAgentId == null ? "" : "victim " + personLink(item.victimAgentId),
        ...(item.witnessAgentIds || []).slice(0, 10).map(personLink)
      ].filter(Boolean)),
      relationGroup("Court Context", [
        item.officeId == null ? "" : officeLink(item.officeId),
        item.lawId == null ? "" : lawLink(item.lawId),
        item.structureId == null ? "" : structureLink(item.structureId),
        item.estateId == null ? "" : estateLink(item.estateId),
        ...(item.testimonyIds || []).slice(0, 10).map(testimonyLink)
      ].filter(Boolean)),
      relationGroup("Consequences", [
        ...projectsAbout("case", item.id, 8),
        ...obligationsAbout("case", item.id, 8),
        ...schemesAbout("case", item.id, 8)
      ]),
      relationGroup("Records", recordLinksFor("case", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "testimonies") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " testimony"),
        factPill(item.stance),
        factPill("credibility " + item.credibility),
        factPill("pressure " + item.pressure),
        factPill(years(item.year)),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("People and Case", [
        caseLink(item.caseId),
        "witness " + personLink(item.witnessAgentId),
        "accused " + personLink(item.accusedAgentId),
        item.victimAgentId == null ? "" : "victim " + personLink(item.victimAgentId)
      ].filter(Boolean)),
      relationGroup("Evidence", [
        item.officeId == null ? "" : officeLink(item.officeId),
        item.lawId == null ? "" : lawLink(item.lawId),
        item.structureId == null ? "" : structureLink(item.structureId),
        item.rumorId == null ? "" : rumorLink(item.rumorId),
        item.secretId == null ? "" : secretLink(item.secretId),
        item.conversationId == null ? "" : conversationLink(item.conversationId),
        item.memoryId == null ? "" : memoryLink(item.memoryId),
        eventLink(item.sourceEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Records", recordLinksFor("testimony", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "ceremonies") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " ceremony"),
        factPill(years(item.year)),
        item.hostAgentId == null ? "" : "host " + personLink(item.hostAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ].filter(Boolean)),
      relationGroup("Sacred and Civic Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
        item.officeId == null ? "" : officeLink(item.officeId),
        ...traditionsAbout("ceremony", item.id, 8)
      ].filter(Boolean)),
      relationGroup("Participants and Artifacts", [
        ...(item.participantAgentIds || []).slice(0, 12).map(personLink),
        ...(item.ceremonyParticipationIds || []).slice(0, 10).map(ceremonyParticipationLink),
        ...(item.artifactIds || []).slice(0, 8).map(artifactLink)
      ]),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Aftereffects", [
        ...recordEchoLinks("ceremony", item.id, 14),
        ...projectsAbout("ceremony", item.id, 6)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "ceremony-participations") {
    groups = [
      relationGroup("Overview", [
        factPill(item.role),
        factPill(item.kind),
        factPill(years(item.year)),
        personLink(item.agentId),
        ceremonyLink(item.ceremonyId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
        item.officeId == null ? "" : officeLink(item.officeId),
        eventLink(item.ceremonyEventId),
        ...(item.artifactIds || []).slice(0, 8).map(artifactLink)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Echoes", recordEchoLinks("ceremony-participation", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "activities") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " activity"),
        factPill("mood " + item.moodDelta),
        factPill("stress " + item.stressDelta),
        factPill(years(item.year)),
        "primary " + personLink(item.primaryAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Participants and Setting", [
        ...(item.participantAgentIds || []).slice(0, 12).map(personLink),
        item.structureId == null ? "" : structureLink(item.structureId),
        item.householdId == null ? "" : householdLink(item.householdId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.beliefId == null ? "" : beliefLink(item.beliefId)
      ].filter(Boolean)),
      relationGroup("Preference and Tradition", [
        ...(item.subjectRefs || []).filter(ref => ref.kind === "preference").slice(0, 8).map(ref => preferenceLink(ref.id)),
        ...(item.subjectRefs || []).filter(ref => ref.kind === "tradition").slice(0, 8).map(ref => traditionLink(ref.id)),
        ...teachingsAbout("activity", item.id, 8),
        ...conversationsAbout("activity", item.id, 8)
      ]),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Echoes", recordEchoLinks("activity", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "teachings") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind),
        factPill(item.specialty),
        factPill("quality " + item.quality),
        factPill(years(item.year)),
        "mentor " + personLink(item.mentorAgentId),
        "student " + personLink(item.studentAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Lesson Context", [
        item.skillId == null ? "" : skillLink(item.skillId),
        item.activityId == null ? "" : activityLink(item.activityId),
        item.apprenticeshipId == null ? "" : apprenticeshipLink(item.apprenticeshipId),
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.traditionId == null ? "" : traditionLink(item.traditionId),
        item.writtenWorkId == null ? "" : writtenWorkLink(item.writtenWorkId),
        eventLink(item.sourceEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Learning Echoes", [
        ...conversationsAbout("teaching", item.id, 8),
        ...recordEchoLinks("teaching", item.id, 12)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "projects") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " project"),
        factPill(item.outcome),
        factPill("quality " + item.quality),
        factPill(years(item.year)),
        "lead " + personLink(item.leadAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Workers and Roles", [
        ...(item.workerAgentIds || []).slice(0, 12).map(personLink),
        ...(item.projectParticipationIds || []).slice(0, 10).map(projectParticipationLink)
      ]),
      relationGroup("Context and Target", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.officeId == null ? "" : officeLink(item.officeId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
        item.artifactId == null ? "" : artifactLink(item.artifactId),
        item.injuryId == null ? "" : injuryLink(item.injuryId),
        item.caseId == null ? "" : caseLink(item.caseId)
      ].filter(Boolean)),
      relationGroup("Material Impact", [
        factPill("food " + item.foodDelta),
        factPill("materials " + item.materialDelta),
        factPill("wealth " + item.wealthDelta),
        factPill("prosperity " + item.prosperityImpact),
        factPill("unrest " + item.unrestImpact)
      ]),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Project Echoes", [
        ...skillsAbout("project", item.id, 8),
        ...obligationsAbout("project", item.id, 8),
        ...belongingsAbout("project", item.id, 8),
        ...recordEchoLinks("project", item.id, 12)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "project-participations") {
    groups = [
      relationGroup("Overview", [
        factPill(item.role),
        factPill(item.outcome),
        factPill(item.specialty),
        factPill("quality " + item.quality),
        factPill(years(item.year)),
        personLink(item.agentId),
        projectLink(item.projectId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.officeId == null ? "" : officeLink(item.officeId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
        item.artifactId == null ? "" : artifactLink(item.artifactId),
        item.injuryId == null ? "" : injuryLink(item.injuryId),
        item.caseId == null ? "" : caseLink(item.caseId),
        eventLink(item.projectEventId)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Work Echoes", [
        ...skillsAbout("project-participation", item.id, 8),
        ...belongingsAbout("project-participation", item.id, 8),
        ...recordEchoLinks("project-participation", item.id, 12)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "chronicles") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " chronicle"),
        factPill(years(item.year)),
        "author " + personLink(item.authorAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Archive Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        ...(item.sourceEventIds || []).slice(0, 10).map(eventLink)
      ].filter(Boolean)),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Derived Works", writtenWorksAbout("chronicle", item.id, 10)),
      relationGroup("Reception", [
        ...memoriesAbout("chronicle", item.id, 8),
        ...opinionsAbout("chronicle", item.id, 8),
        ...rumorsAbout("chronicle", item.id, 8),
        ...secretsAbout("chronicle", item.id, 8),
        ...obligationsAbout("chronicle", item.id, 6)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "written-works") {
    groups = [
      relationGroup("Overview", [
        factPill(item.kind + " written work"),
        factPill("copies " + item.copies),
        factPill("influence " + item.influence),
        factPill(years(item.year)),
        "author " + personLink(item.authorAgentId),
        settlementLink(item.settlementId),
        civLink(item.civilizationId)
      ]),
      relationGroup("Archive Context", [
        item.structureId == null ? "" : structureLink(item.structureId),
        item.organizationId == null ? "" : organizationLink(item.organizationId),
        item.beliefId == null ? "" : beliefLink(item.beliefId),
        item.sourceChronicleId == null ? "" : chronicleLink(item.sourceChronicleId),
        ...(item.sourceEventIds || []).slice(0, 8).map(eventLink)
      ].filter(Boolean)),
      relationGroup("Use and Copies", [
        ...traditionsAbout("written-work", item.id, 8),
        ...teachingsAbout("written-work", item.id, 8),
        ...belongingsAbout("written-work", item.id, 8)
      ]),
      relationGroup("Subjects", subjectLinks(item, 14)),
      relationGroup("Reception", [
        ...chroniclesAbout("written-work", item.id, 6),
        ...memoriesAbout("written-work", item.id, 8),
        ...thoughtsAbout("written-work", item.id, 8),
        ...opinionsAbout("written-work", item.id, 8),
        ...rumorsAbout("written-work", item.id, 8),
        ...secretsAbout("written-work", item.id, 6),
        ...oathsAbout("written-work", item.id, 6),
        ...obligationsAbout("written-work", item.id, 6)
      ]),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  }

  const inner = groups.join("");
  return inner ? '<h3>Institutional Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function casesAboutControl(controlId, limit) {
  return data.cases
    .filter(legalCase => (legalCase.subjectRefs || []).some(ref => ref.kind === "settlement-control" && ref.id === controlId))
    .slice(0, limit || 80)
    .map(legalCase => caseLink(legalCase.id));
}

function memorialsAboutBattleParticipation(participationId, limit) {
  return data.memorials
    .filter(memorial => (memorial.subjectRefs || []).some(ref => ref.kind === "battle-participation" && ref.id === participationId))
    .slice(0, limit || 80)
    .map(memorial => memorialLink(memorial.id));
}

function continuityWikiSection(kind, item) {
  if (!["settlement-controls", "person-allegiances", "battle-participations"].includes(kind)) return "";
  let groups = [];

  if (kind === "settlement-controls") {
    const settlement = maps.settlements.get(item.settlementId);
    const controlChain = (settlement?.controlIds || [])
      .filter(id => id !== item.id)
      .slice(-8)
      .map(settlementControlLink);
    groups = [
      relationGroup("Overview", [
        factPill(item.status),
        factPill("started by " + item.startReason),
        item.endReason == null ? "" : factPill("ended by " + item.endReason),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        settlementLink(item.settlementId),
        "controller " + civLink(item.civilizationId),
        item.previousCivilizationId == null ? "" : "previous " + civLink(item.previousCivilizationId)
      ].filter(Boolean)),
      relationGroup("Transfer Events", [
        item.startEventId == null ? "" : eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("War Context", [
        item.conflictId == null ? "" : conflictLink(item.conflictId),
        item.battleId == null ? "" : battleLink(item.battleId),
        ...(item.battleId == null ? [] : battleParticipationsAbout("battle", item.battleId, 8))
      ].filter(Boolean)),
      relationGroup("Control Chain", controlChain),
      relationGroup("Civic Aftermath", [
        ...personAllegiancesAbout("settlement-control", item.id, 10),
        ...officeTermsAbout("settlement-control", item.id, 8),
        ...casesAboutControl(item.id, 8)
      ]),
      relationGroup("Records and Echoes", recordEchoLinks("settlement-control", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "person-allegiances") {
    groups = [
      relationGroup("Overview", [
        factPill(item.status),
        factPill("started by " + item.startReason),
        item.endReason == null ? "" : factPill("ended by " + item.endReason),
        factPill(lifePeriod(item.startedYear, item.endedYear)),
        personLink(item.agentId),
        civLink(item.civilizationId),
        settlementLink(item.settlementId),
        item.previousCivilizationId == null ? "" : "previous " + civLink(item.previousCivilizationId)
      ].filter(Boolean)),
      relationGroup("Transfer Events", [
        item.startEventId == null ? "" : eventLink(item.startEventId),
        item.endEventId == null ? "" : eventLink(item.endEventId),
        ...subjectLinks(item, 12)
      ].filter(Boolean)),
      relationGroup("Life During This Allegiance", [
        ...residencesAbout("person-allegiance", item.id, 8),
        ...careersAbout("person-allegiance", item.id, 8),
        ...membershipsAbout("person-allegiance", item.id, 8),
        ...beliefAdherencesAbout("person-allegiance", item.id, 8),
        ...officeTermsAbout("person-allegiance", item.id, 8)
      ]),
      relationGroup("War and Capture Context", [
        item.conflictId == null ? "" : conflictLink(item.conflictId),
        item.battleId == null ? "" : battleLink(item.battleId),
        ...battleParticipationsAbout("person", item.agentId, 8),
        ...settlementControlsAbout("person-allegiance", item.id, 8)
      ].filter(Boolean)),
      relationGroup("Social Echoes", [
        ...conversationsAbout("person-allegiance", item.id, 8),
        ...rumorsAbout("person-allegiance", item.id, 8),
        ...secretsAbout("person-allegiance", item.id, 8),
        ...feudsAbout("person-allegiance", item.id, 8),
        ...oathsAbout("person-allegiance", item.id, 8),
        ...obligationsAbout("person-allegiance", item.id, 8)
      ]),
      relationGroup("Records", recordLinksFor("person-allegiance", item.id, 12)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  } else if (kind === "battle-participations") {
    const battle = maps.battles.get(item.battleId);
    const alliedIds = battle
      ? (item.side === "attacker" ? battle.attackerParticipantIds : battle.defenderParticipantIds) || []
      : [];
    const opposingIds = battle
      ? (item.side === "attacker" ? battle.defenderParticipantIds : battle.attackerParticipantIds) || []
      : [];
    const commanderId = battle
      ? (item.side === "attacker" ? battle.attackerCommanderId : battle.defenderCommanderId)
      : null;
    groups = [
      relationGroup("Overview", [
        factPill(item.side),
        factPill(item.role),
        factPill(item.outcome),
        factPill(years(item.year)),
        personLink(item.agentId),
        battleLink(item.battleId),
        settlementLink(item.settlementId),
        "side " + civLink(item.civilizationId),
        "opposed " + civLink(item.opposingCivilizationId)
      ]),
      relationGroup("Battle Context", [
        item.conflictId == null ? "" : conflictLink(item.conflictId),
        item.battleEventId == null ? "" : eventLink(item.battleEventId),
        item.casualtyEventId == null ? "" : eventLink(item.casualtyEventId),
        battle == null ? "" : factPill("battle outcome " + battle.outcome),
        commanderId == null ? "" : "commander " + personLink(commanderId)
      ].filter(Boolean)),
      relationGroup("Side and Opponents", [
        ...alliedIds.filter(id => id !== item.agentId).slice(0, 8).map(personLink),
        ...opposingIds.slice(0, 8).map(personLink)
      ]),
      relationGroup("Wounds and Consequences", [
        ...(item.injuryIds || []).slice(0, 8).map(injuryLink),
        ...memorialsAboutBattleParticipation(item.id, 8),
        ...personAllegiancesAbout("battle-participation", item.id, 8),
        ...settlementControlsAbout("battle-participation", item.id, 8)
      ]),
      relationGroup("Subjects", subjectLinks(item, 12)),
      relationGroup("Records and Echoes", recordEchoLinks("battle-participation", item.id, 14)),
      relationGroup("Recent Events", recentEventLinksFor(item, 8))
    ];
  }

  const inner = groups.join("");
  return inner ? '<h3>Continuity Summary</h3><div class="relations">' + inner + '</div>' : "";
}

function eventRefsOfKinds(item, refKinds, limit) {
  const wanted = new Set(refKinds || []);
  return uniqueLinkList(
    (item.entityRefs || [])
      .filter(ref => wanted.has(ref.kind))
      .map(refLink),
    limit || 16
  );
}

function eventFieldLinks(item, fields, limit) {
  return uniqueLinkList(
    fields.map(([field, label, linker]) => item[field] == null ? "" : (label ? label + " " : "") + linker(item[field])),
    limit || 16
  );
}

function eventWikiSection(kind, item) {
  if (kind !== "events") return "";
  const sourceChain = uniqueLinkList([
    item.sourceEventId == null ? "" : "source " + eventLink(item.sourceEventId),
    ...eventRefsOfKinds(item, ["event"], 12)
  ], 12);
  const primaryRecords = eventFieldLinks(item, [
    ["settlementControlId", "control", settlementControlLink],
    ["personAllegianceId", "allegiance", personAllegianceLink],
    ["preferenceId", "preference", preferenceLink],
    ["traditionId", "tradition", traditionLink],
    ["epithetId", "epithet", epithetRecordLink],
    ["reputationMilestoneId", "reputation milestone", reputationMilestoneLink],
    ["artifactId", "artifact", artifactLink],
    ["chronicleId", "chronicle", chronicleLink],
    ["writtenWorkId", "written work", writtenWorkLink],
    ["memoryId", "memory", memoryLink],
    ["thoughtId", "thought", thoughtLink],
    ["opinionId", "opinion", opinionLink],
    ["conversationId", "conversation", conversationLink],
    ["rumorId", "rumor", rumorLink],
    ["secretId", "secret", secretLink],
    ["schemeId", "scheme", schemeLink],
    ["feudId", "feud", feudLink],
    ["oathId", "oath", oathLink],
    ["ceremonyId", "ceremony", ceremonyLink],
    ["ceremonyParticipationId", "ceremony role", ceremonyParticipationLink],
    ["activityId", "activity", activityLink],
    ["teachingId", "teaching", teachingLink],
    ["projectId", "project", projectLink],
    ["projectParticipationId", "project role", projectParticipationLink],
    ["obligationId", "obligation", obligationLink],
    ["holdingId", "holding", holdingLink],
    ["belongingId", "belonging", belongingLink],
    ["possessionAttachmentId", "attachment", possessionAttachmentLink],
    ["organizationId", "organization", organizationLink],
    ["membershipId", "membership", membershipLink],
    ["organizationRankId", "rank", organizationRankLink],
    ["relationshipId", "relationship", relationshipLink],
    ["relationshipMilestoneId", "relationship milestone", relationshipMilestoneLink],
    ["unionId", "union", unionLink],
    ["beliefId", "belief", beliefLink],
    ["beliefAdherenceId", "adherence", beliefAdherenceLink],
    ["mythId", "myth", mythLink],
    ["doctrineId", "doctrine", doctrineLink],
    ["magicRoleId", "magic role", magicRoleLink],
    ["prophecyId", "prophecy", prophecyLink],
    ["civilizationGoalId", "civ goal", civilizationGoalLink],
    ["sacredSiteId", "sacred site", sacredSiteLink],
    ["officeId", "office", officeLink],
    ["officeTermId", "office term", officeTermLink],
    ["lawId", "law", lawLink],
    ["caseId", "case", caseLink],
    ["testimonyId", "testimony", testimonyLink],
    ["conflictId", "conflict", conflictLink],
    ["battleId", "battle", battleLink],
    ["battleParticipationId", "battle role", battleParticipationLink],
    ["injuryId", "injury", injuryLink],
    ["illnessId", "illness", illnessLink],
    ["careRecordId", "care", careRecordLink],
    ["woundLegacyId", "wound legacy", woundLegacyLink],
    ["memorialId", "memorial", memorialLink],
    ["burialId", "burial", burialLink],
    ["ambitionId", "ambition", ambitionLink],
    ["apprenticeshipId", "apprenticeship", apprenticeshipLink],
    ["skillId", "skill", skillLink],
    ["residenceId", "residence", residenceLink],
    ["careerId", "career", careerLink],
    ["journeyId", "journey", journeyLink],
    ["structureId", "structure", structureLink],
    ["householdId", "household", householdLink],
    ["lineageId", "lineage", lineageLink]
  ], 18);
  const aftermath = uniqueLinkList([
    ...recordEchoLinks("event", item.id, 12),
    ...settlementControlsAbout("event", item.id, 6),
    ...personAllegiancesAbout("event", item.id, 6),
    ...battleParticipationsAbout("event", item.id, 6),
    ...ceremoniesAbout("event", item.id, 6),
    ...projectsAbout("event", item.id, 6),
    ...relationshipMilestonesAbout("event", item.id, 6),
    ...reputationMilestonesAbout("event", item.id, 6),
    ...obligationsAbout("event", item.id, 6),
    ...holdingsAbout("event", item.id, 6),
    ...belongingsAbout("event", item.id, 6),
    ...careRecordsAbout("event", item.id, 6),
    ...woundLegaciesAbout("event", item.id, 6)
  ], 18);
  const groups = [
    relationGroup("Overview", [
      factPill(item.type),
      factPill(years(item.year)),
      factPill("event " + item.id),
      item.epithet == null ? "" : factPill("epithet " + item.epithet)
    ].filter(Boolean)),
    relationGroup("Primary Records", primaryRecords),
    relationGroup("People", eventRefsOfKinds(item, ["person"], 16)),
    relationGroup("Places and Polities", eventRefsOfKinds(item, ["settlement", "civilization", "structure", "road", "household", "lineage"], 18)),
    relationGroup("Institutions and Beliefs", eventRefsOfKinds(item, ["organization", "membership", "belief", "belief-adherence", "myth", "doctrine", "magic-role", "prophecy", "civilization-goal", "sacred-site", "office", "office-term", "law", "case", "testimony"], 18)),
    relationGroup("Conflict and Hardship", eventRefsOfKinds(item, ["conflict", "battle", "battle-participation", "injury", "illness", "care-record", "wound-legacy", "memorial"], 18)),
    relationGroup("Life, Work, and Material", eventRefsOfKinds(item, ["person-allegiance", "preference", "tradition", "epithet", "reputation-milestone", "relationship", "union", "ambition", "apprenticeship", "skill", "residence", "career", "age-milestone", "appearance-feature", "journey", "artifact", "chronicle", "written-work", "ceremony", "ceremony-participation", "activity", "teaching", "project", "project-participation", "obligation", "holding", "belonging"], 22)),
    relationGroup("Social Echoes", eventRefsOfKinds(item, ["memory", "thought", "opinion", "conversation", "rumor", "secret", "scheme", "feud", "oath"], 20)),
    relationGroup("Source Chain", sourceChain),
    relationGroup("Aftermath and Backlinks", aftermath)
  ].join("");
  return groups ? '<h3>Event Summary</h3><div class="relations">' + groups + '</div>' : "";
}

function profileSection(kind, item) {
  if (kind !== "people") return "";
  const groups = [
    relationGroup("Epithets", (item.epithets || []).map(epithetLink)),
    relationGroup("Reputation Milestones", (item.reputationMilestoneIds || []).slice(0, 12).map(reputationMilestoneLink)),
    relationGroup("Preferences", (item.preferenceIds || []).slice(0, 12).map(preferenceLink)),
    relationGroup("Authored Works", (item.writtenWorkIds || []).slice(0, 12).map(writtenWorkLink)),
    relationGroup("Traditions", (item.traditionIds || []).slice(0, 12).map(traditionLink)),
    relationGroup("Thoughts", (item.thoughtIds || []).slice(0, 12).map(thoughtLink)),
    relationGroup("Traits", (item.traits || []).map(value => '<span class="ref">' + esc(value) + '</span>')),
    relationGroup("Values", (item.values || []).map(value => '<span class="ref">' + esc(value) + '</span>')),
    relationGroup("Specialties", (item.specialties || []).map(value => '<span class="ref">' + esc(value) + '</span>')),
    relationGroup("Reputation", ['<span class="ref">' + esc(reputationLabel(item.reputation) + " " + item.reputation) + '</span>']),
    relationGroup("Mind", [
      '<span class="ref">' + esc(item.mentalState) + '</span>',
      '<span class="ref">' + esc("stress " + stressLabel(item.stress) + " " + item.stress) + '</span>',
      '<span class="ref">' + esc("resilience " + item.resilience) + '</span>',
      '<span class="ref">' + esc("morale " + item.morale) + '</span>'
    ]),
    relationGroup("Needs", (item.needStates || []).map(needPill))
  ].join("");
  return groups ? '<h3>Profile</h3><div class="relations">' + groups + '</div>' : "";
}
function linkedMeta(kind, item) {
  if (kind === "story-hooks") return [
    esc(item.kind),
    esc("tone " + item.tone),
    esc("score " + item.score),
    esc("urgency " + item.urgency),
    esc(years(item.year)),
    item.civilizationId == null ? "" : civLink(item.civilizationId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    item.personId == null ? "" : personLink(item.personId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId)
  ].filter(Boolean);
  if (kind === "people") return [
    ...(item.epithets || []).slice(0, 2).map(epithet => esc(epithet.name)),
    esc(item.profession),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.birthId == null ? "" : birthLink(item.birthId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.spouseId == null ? "" : "spouse " + personLink(item.spouseId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    esc("reputation " + reputationLabel(item.reputation)),
    esc("mind " + item.mentalState),
    esc("stress " + stressLabel(item.stress)),
    needSummary(item) ? esc(needSummary(item)) : "",
    esc(item.alive ? "alive" : "dead"),
    esc("born " + years(item.bornYear))
  ].filter(Boolean);
  if (kind === "births") return [
    esc(item.kind),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.unionId == null ? "" : unionLink(item.unionId),
    ...(item.parentAgentIds || []).slice(0, 2).map(id => "parent " + personLink(id)),
    "source " + eventLink(item.birthEventId),
    esc("born " + years(item.year))
  ].filter(Boolean);
  if (kind === "age-milestones") return [
    esc(item.kind),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.careerId == null ? "" : careerLink(item.careerId),
    "source " + eventLink(item.sourceEventId),
    esc("age " + item.age),
    esc(item.previousProfession + " to " + item.newProfession),
    esc("recorded " + years(item.year))
  ].filter(Boolean);
  if (kind === "appearance-features") return [
    esc(item.kind),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.birthId == null ? "" : birthLink(item.birthId),
    item.ageMilestoneId == null ? "" : ageMilestoneLink(item.ageMilestoneId),
    item.woundLegacyId == null ? "" : woundLegacyLink(item.woundLegacyId),
    "source " + eventLink(item.sourceEventId),
    esc("visibility " + item.visibility),
    esc("traits " + (item.traits || []).slice(0, 3).join(", ")),
    esc("recorded " + years(item.year))
  ].filter(Boolean);
  if (kind === "person-allegiances") return [
    esc(item.status),
    esc(item.startReason),
    item.endReason == null ? "" : esc("ended by " + item.endReason),
    "person " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.previousCivilizationId == null ? "" : "previous " + civLink(item.previousCivilizationId),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.startEventId == null ? "" : "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("from " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("to " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "preferences") return [
    esc(item.sentiment),
    esc(item.kind),
    esc(item.targetName),
    "person " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.recordedEventId == null ? "" : "recorded by " + eventLink(item.recordedEventId),
    esc("strength " + item.strength),
    esc("recorded " + years(item.recordedYear))
  ].filter(Boolean);
  if (kind === "traditions") return [
    esc(item.kind),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.founderAgentId == null ? "" : "founder " + personLink(item.founderAgentId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.activityKind == null ? "" : esc("activity " + item.activityKind),
    item.ceremonyKind == null ? "" : esc("ceremony " + item.ceremonyKind),
    esc("origin " + years(item.originYear)),
    esc("strength " + item.strength),
    esc("practices " + item.practiceCount)
  ].filter(Boolean);
  if (kind === "epithets") return [
    esc(item.epithet),
    "person " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.sourceMemoryId == null ? "" : "source memory " + memoryLink(item.sourceMemoryId),
    item.personalityShiftId == null ? "" : "source shift " + personalityShiftLink(item.personalityShiftId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.sourceEventId == null ? "" : "source " + eventLink(item.sourceEventId),
    esc(item.reason),
    esc("earned " + years(item.year))
  ].filter(Boolean);
  if (kind === "reputation-milestones") return [
    esc(item.kind),
    "person " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.epithetId == null ? "" : epithetRecordLink(item.epithetId),
    "source " + eventLink(item.sourceEventId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    esc("reputation " + item.previousReputation + " to " + item.reputation),
    esc(item.reason),
    esc("recorded " + years(item.year))
  ].filter(Boolean);
  if (kind === "settlements") return [
    esc(item.type),
    civLink(item.civilizationId),
    esc("founded " + years(item.foundedYear)),
    esc("population " + item.population),
    esc("control terms " + (item.controlIds || []).length)
  ];
  if (kind === "settlement-controls") return [
    esc(item.status),
    esc(item.startReason),
    item.endReason == null ? "" : esc("ended by " + item.endReason),
    settlementLink(item.settlementId),
    civLink(item.civilizationId),
    item.previousCivilizationId == null ? "" : "previous " + civLink(item.previousCivilizationId),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.startEventId == null ? "" : "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("from " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("to " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "natural-features") return [
    esc(item.kind),
    esc("named " + years(item.year)),
    esc("elevation " + item.elevation),
    esc("rainfall " + item.rainfall),
    esc("flow " + item.flow),
    esc("prominence " + item.prominence),
    ...(item.settlementIds || []).slice(0, 4).map(settlementLink),
    ...(item.sacredSiteIds || []).slice(0, 4).map(sacredSiteLink)
  ].filter(Boolean);
  if (kind === "structures") return [
    esc(item.kind),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.founderAgentId == null ? "" : "builder " + personLink(item.founderAgentId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.officeId == null ? "" : officeLink(item.officeId),
    esc("built " + years(item.builtYear)),
    esc("workers " + item.workerAgentIds.length)
  ].filter(Boolean);
  if (kind === "households") return [
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.residenceStructureId == null ? "" : structureLink(item.residenceStructureId),
    ...(item.lineageIds || []).slice(0, 3).map(lineageLink),
    esc("founded " + years(item.foundedYear)),
    esc("members " + item.memberAgentIds.length)
  ].filter(Boolean);
  if (kind === "lineages") return [
    civLink(item.civilizationId),
    settlementLink(item.originSettlementId),
    "founder " + personLink(item.founderAgentId),
    esc("family " + item.familyName),
    esc("founded " + years(item.foundedYear)),
    esc("members " + item.memberAgentIds.length),
    esc("households " + item.householdIds.length)
  ].filter(Boolean);
  if (kind === "chapters") return [
    esc((item.chapterType || "record") + " chapter"),
    esc(item.chapterKind || item.kind),
    chapterOwnerLink(item),
    item.civilizationId == null ? "" : civLink(item.civilizationId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    item.fromSettlementId == null ? "" : "from " + settlementLink(item.fromSettlementId),
    item.toSettlementId == null ? "" : "to " + settlementLink(item.toSettlementId),
    item.attackerCivilizationId == null ? "" : "attacker " + civLink(item.attackerCivilizationId),
    item.defenderCivilizationId == null ? "" : "defender " + civLink(item.defenderCivilizationId),
    esc(lifeChapterRange(item)),
    esc(item.status)
  ].filter(Boolean);
  if (kind === "organizations") return [
    esc(item.kind),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.structureId == null ? "" : structureLink(item.structureId),
    esc("founded " + years(item.foundedYear)),
    item.leaderAgentId == null ? "" : "leader " + personLink(item.leaderAgentId),
    esc("members " + item.memberIds.length)
  ].filter(Boolean);
  if (kind === "memberships") return [
    esc(item.role),
    esc(item.status),
    "person " + personLink(item.agentId),
    organizationLink(item.organizationId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.startEventId == null ? "" : "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("from " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("to " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "organization-ranks") return [
    esc(item.kind),
    esc(item.duty),
    esc(item.status),
    "person " + personLink(item.agentId),
    organizationLink(item.organizationId),
    membershipLink(item.membershipId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.sponsorAgentId == null ? "" : "sponsor " + personLink(item.sponsorAgentId),
    item.previousRankId == null ? "" : "previous " + organizationRankLink(item.previousRankId),
    item.sourceEventId == null ? "" : "source " + eventLink(item.sourceEventId),
    esc("prestige " + item.prestige),
    esc("from " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("to " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "beliefs") return [
    esc(item.domain),
    civLink(item.civilizationId),
    settlementLink(item.originSettlementId),
    item.patronGodId == null ? "" : "patron " + godLink(item.patronGodId),
    item.founderAgentId == null ? "" : "founder " + personLink(item.founderAgentId),
    (item.structureIds || []).length ? structureLink(item.structureIds[0]) : "",
    esc("founded " + years(item.foundedYear)),
    esc("adherents " + item.adherentIds.length),
    esc("adherence records " + (item.adherenceIds || []).length),
    esc("organizations " + item.organizationIds.length)
  ].filter(Boolean);
  if (kind === "belief-adherences") return [
    esc(item.status),
    item.endReason == null ? "" : esc("ended by " + item.endReason),
    "person " + personLink(item.agentId),
    beliefLink(item.beliefId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.startEventId == null ? "" : "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("from " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("to " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "myths-magic") return [
    civLink(item.civilizationId),
    settlementLink(item.capitalSettlementId),
    esc("beliefs " + (item.beliefIds || []).length),
    esc("gods " + (item.godIds || []).length),
    esc("commandments " + (item.commandmentIds || []).length),
    esc("active destinies " + (item.activeDestinyIds || []).length),
    esc("miracles " + (item.miracleIds || []).length),
    esc("myths " + (item.mythIds || []).length),
    esc("doctrines " + (item.doctrineIds || []).length),
    esc("magic roles " + (item.magicRoleIds || []).length),
    esc("open prophecies " + (item.openProphecyIds || []).length),
    esc("active goals " + (item.activeCivilizationGoalIds || []).length),
    esc("sacred sites " + (item.sacredSiteIds || []).length)
  ].filter(Boolean);
  if (kind === "gods") return [
    esc(item.kind),
    esc(item.temperament),
    esc(item.domain),
    beliefLink(item.beliefId),
    civLink(item.civilizationId),
    settlementLink(item.originSettlementId),
    esc("controls " + (item.controlSpheres || []).join(", ")),
    esc("symbol " + item.symbol),
    item.miracleBias ? esc("miracle bias " + item.miracleBias) : "",
    item.commandmentStyle ? esc("commandments " + item.commandmentStyle) : "",
    item.creationClaim ? esc("creation " + item.creationClaim) : "",
    item.prophecyMethod ? esc("prophecy " + item.prophecyMethod) : "",
    esc("influence " + item.influence),
    esc("favor " + item.favor),
    esc("named " + years(item.foundedYear))
  ].filter(Boolean);
  if (kind === "commandments") return [
    esc(item.kind),
    esc(item.domain),
    beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    esc("severity " + item.severity),
    esc("given " + years(item.givenYear))
  ].filter(Boolean);
  if (kind === "destinies") return [
    esc(item.kind),
    esc(item.status),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.targetAgentId == null ? "" : "target " + personLink(item.targetAgentId),
    item.targetSettlementId == null ? "" : "target " + settlementLink(item.targetSettlementId),
    item.targetArtifactId == null ? "" : "target " + artifactLink(item.targetArtifactId),
    esc("pressure " + item.pressure),
    esc("declared " + years(item.year)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "miracles") return [
    esc(item.kind),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    item.sacredSiteId == null ? "" : sacredSiteLink(item.sacredSiteId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.targetAgentId == null ? "" : "target " + personLink(item.targetAgentId),
    esc("strength " + item.strength),
    esc(item.effect),
    esc("witnessed " + years(item.year))
  ].filter(Boolean);
  if (kind === "myths") return [
    esc(item.kind),
    esc(item.domain),
    beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    civLink(item.civilizationId),
    settlementLink(item.originSettlementId),
    item.centralAgentId == null ? "" : "central figure " + personLink(item.centralAgentId),
    esc("first told " + years(item.year))
  ].filter(Boolean);
  if (kind === "doctrines") return [
    esc(item.kind),
    esc(item.domain),
    beliefLink(item.beliefId),
    item.mythId == null ? "" : mythLink(item.mythId),
    item.godId == null ? "" : godLink(item.godId),
    item.commandmentId == null ? "" : commandmentLink(item.commandmentId),
    civLink(item.civilizationId),
    settlementLink(item.originSettlementId),
    esc("virtue " + item.virtue),
    esc("taboo " + item.taboo),
    esc("founded " + years(item.foundedYear)),
    esc("goals " + (item.civilizationGoalIds || []).length)
  ].filter(Boolean);
  if (kind === "magic-roles") return [
    esc(item.kind),
    esc(item.status),
    "holder " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.mythId == null ? "" : mythLink(item.mythId),
    esc("started " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("ended " + years(item.endedYear)),
    esc("prophecies " + (item.prophecyIds || []).length),
    esc("goals " + (item.civilizationGoalIds || []).length)
  ].filter(Boolean);
  if (kind === "prophecies") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    item.destinyId == null ? "" : destinyLink(item.destinyId),
    item.mythId == null ? "" : mythLink(item.mythId),
    item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
    item.speakerAgentId == null ? "" : "speaker " + personLink(item.speakerAgentId),
    item.targetAgentId == null ? "" : "target " + personLink(item.targetAgentId),
    item.targetSettlementId == null ? "" : "place " + settlementLink(item.targetSettlementId),
    item.targetArtifactId == null ? "" : "artifact " + artifactLink(item.targetArtifactId),
    item.ambitionId == null ? "" : ambitionLink(item.ambitionId),
    ...(item.civilizationGoalIds || []).slice(0, 3).map(civilizationGoalLink),
    item.sourceEventId == null ? "" : "spoken event " + eventLink(item.sourceEventId),
    item.resolvedEventId == null ? "" : "resolved by " + eventLink(item.resolvedEventId),
    esc("strength " + item.strength),
    esc("spoken " + years(item.year)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "civilization-goals") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    item.commandmentId == null ? "" : commandmentLink(item.commandmentId),
    item.destinyId == null ? "" : destinyLink(item.destinyId),
    item.mythId == null ? "" : mythLink(item.mythId),
    item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
    item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
    item.targetSettlementId == null ? "" : "target " + settlementLink(item.targetSettlementId),
    item.targetArtifactId == null ? "" : "target " + artifactLink(item.targetArtifactId),
    item.targetCivilizationId == null ? "" : "target " + civLink(item.targetCivilizationId),
    item.sourceEventId == null ? "" : "formed by " + eventLink(item.sourceEventId),
    item.resolvedEventId == null ? "" : "resolved by " + eventLink(item.resolvedEventId),
    esc("priority " + item.priority),
    esc("started " + years(item.startedYear)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "sacred-sites") return [
    esc(item.kind),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.founderAgentId == null ? "" : "founder " + personLink(item.founderAgentId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.godId == null ? "" : godLink(item.godId),
    item.mythId == null ? "" : mythLink(item.mythId),
    item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
    item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    esc("renown " + item.renown),
    esc("founded " + years(item.foundedYear))
  ].filter(Boolean);
  if (kind === "offices") return [
    esc(item.kind),
    civLink(item.civilizationId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    item.holderAgentId == null ? "vacant" : "holder " + personLink(item.holderAgentId),
    item.structureId == null ? "" : structureLink(item.structureId),
    esc("created " + years(item.createdYear))
  ].filter(Boolean);
  if (kind === "office-terms") return [
    esc(item.status),
    esc(item.startReason),
    item.endReason == null ? "" : esc("ended by " + item.endReason),
    "holder " + personLink(item.holderAgentId),
    officeLink(item.officeId),
    civLink(item.civilizationId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.startEventId == null ? "" : "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("from " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("to " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "laws") return [
    esc(item.domain),
    civLink(item.civilizationId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    officeLink(item.officeId),
    item.authorAgentId == null ? "" : "author " + personLink(item.authorAgentId),
    esc("enacted " + years(item.enactedYear)),
    esc("strictness " + item.strictness)
  ].filter(Boolean);
  if (kind === "cases") return [
    esc(item.kind),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "accused " + personLink(item.accusedAgentId),
    item.victimAgentId == null ? "" : "victim " + personLink(item.victimAgentId),
    esc("testimonies " + (item.testimonyIds || []).length),
    item.officeId == null ? "" : officeLink(item.officeId),
    item.lawId == null ? "" : lawLink(item.lawId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.estateId == null ? "" : estateLink(item.estateId),
    esc("opened " + years(item.openedYear)),
    esc("verdict " + item.verdict)
  ].filter(Boolean);
  if (kind === "testimonies") return [
    esc(item.kind),
    esc(item.stance),
    "witness " + personLink(item.witnessAgentId),
    "accused " + personLink(item.accusedAgentId),
    item.victimAgentId == null ? "" : "victim " + personLink(item.victimAgentId),
    caseLink(item.caseId),
    item.lawId == null ? "" : lawLink(item.lawId),
    item.rumorId == null ? "" : rumorLink(item.rumorId),
    item.secretId == null ? "" : secretLink(item.secretId),
    item.conversationId == null ? "" : conversationLink(item.conversationId),
    item.memoryId == null ? "" : memoryLink(item.memoryId),
    esc("credibility " + item.credibility),
    esc("pressure " + item.pressure),
    esc(years(item.year))
  ].filter(Boolean);
  if (kind === "conflicts") return [
    esc(item.kind),
    esc(item.status),
    "instigator " + civLink(item.instigatorCivilizationId),
    "side " + civLink(item.attackerCivilizationId),
    "side " + civLink(item.defenderCivilizationId),
    item.targetSettlementId == null ? "" : "target " + settlementLink(item.targetSettlementId),
    esc("started " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("ended " + years(item.endedYear)),
    esc("last battle " + years(item.lastBattleYear)),
    esc("battles " + (item.battleIds || []).length),
    esc("casualties " + (item.casualtyAgentIds || []).length),
    esc("captured places " + (item.capturedSettlementIds || []).length),
    esc("captured artifacts " + (item.capturedArtifactIds || []).length),
    esc("spy ops " + (item.spyOperationIds || []).length)
  ].filter(Boolean);
  if (kind === "battles") return [
    esc(item.kind),
    esc(item.outcome),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    settlementLink(item.settlementId),
    esc(item.battlefieldName || ""),
    esc(item.battlefieldTerrain || ""),
    item.battlefieldX == null || item.battlefieldY == null ? "" : esc("field " + item.battlefieldX + ", " + item.battlefieldY),
    item.battlefieldTriangle == null ? "" : esc("triangle " + item.battlefieldTriangle),
    "attacker " + civLink(item.attackerCivilizationId),
    "defender " + civLink(item.defenderCivilizationId),
    item.attackerCommanderId == null ? "" : "attacker commander " + personLink(item.attackerCommanderId),
    item.defenderCommanderId == null ? "" : "defender commander " + personLink(item.defenderCommanderId),
    esc("attacker power " + (item.attackerPower ?? 0)),
    esc("defender power " + (item.defenderPower ?? 0)),
    esc("intelligence " + (item.intelligenceAdvantage ?? 0)),
    esc("attacker units " + (item.attackerUnitIds || []).length),
    esc("defender units " + (item.defenderUnitIds || []).length),
    esc("spy ops " + (item.spyOperationIds || []).length),
    esc("fought " + years(item.year)),
    esc("casualties " + item.casualtyAgentIds.length)
  ].filter(Boolean);
  if (kind === "battle-participations") return [
    esc(item.side),
    esc(item.role),
    esc(item.outcome),
    "person " + personLink(item.agentId),
    battleLink(item.battleId),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    settlementLink(item.settlementId),
    "side " + civLink(item.civilizationId),
    "opposed " + civLink(item.opposingCivilizationId),
    item.battleEventId == null ? "" : "battle event " + eventLink(item.battleEventId),
    item.casualtyEventId == null ? "" : "casualty event " + eventLink(item.casualtyEventId),
    esc("wounds " + (item.injuryIds || []).length),
    esc("fought " + years(item.year))
  ].filter(Boolean);
  if (kind === "military-units") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.commanderAgentId == null ? "" : "commander " + personLink(item.commanderAgentId),
    esc("troops " + (item.troopAgentIds || []).length),
    esc("strength " + item.strength),
    esc("training " + item.training),
    esc("morale " + item.morale),
    esc("supply " + item.supply),
    esc("weapons " + item.weaponClass + " q" + item.weaponQuality),
    esc("armor " + item.armorClass + " q" + item.armorQuality),
    esc("formed " + years(item.formedYear)),
    item.disbandedYear == null ? "" : esc("disbanded " + years(item.disbandedYear))
  ].filter(Boolean);
  if (kind === "equipment-caches") return [
    esc(item.kind),
    esc(item.condition),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.unitId == null ? "" : militaryUnitLink(item.unitId),
    item.weaponClass == null ? "" : esc("weapon " + item.weaponClass),
    item.armorClass == null ? "" : esc("armor " + item.armorClass),
    esc("quality " + item.quality),
    esc("quantity " + item.quantity),
    item.sourceEventId == null ? "" : eventLink(item.sourceEventId),
    esc("stocked " + years(item.year))
  ].filter(Boolean);
  if (kind === "spy-networks") return [
    esc(item.status),
    esc(item.cover),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.targetCivilizationId == null ? "" : "target civ " + civLink(item.targetCivilizationId),
    item.targetSettlementId == null ? "" : "target " + settlementLink(item.targetSettlementId),
    item.handlerAgentId == null ? "" : "handler " + personLink(item.handlerAgentId),
    esc("agents " + (item.agentIds || []).length),
    esc("operations " + (item.operationIds || []).length),
    esc("secrecy " + item.secrecy),
    esc("infiltration " + item.infiltration),
    esc("intelligence " + item.intelligence),
    esc("formed " + years(item.formedYear)),
    item.exposedYear == null ? "" : esc("exposed " + years(item.exposedYear))
  ].filter(Boolean);
  if (kind === "spy-operations") return [
    esc(item.kind),
    esc(item.outcome),
    spyNetworkLink(item.networkId),
    civLink(item.civilizationId),
    "target civ " + civLink(item.targetCivilizationId),
    "target " + settlementLink(item.targetSettlementId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.conflictId == null ? "" : conflictLink(item.conflictId),
    esc("agents " + (item.agentIds || []).length),
    esc("risk " + item.risk),
    esc("success " + item.success),
    esc(item.detected ? "detected" : "not detected"),
    esc(years(item.year))
  ].filter(Boolean);
  if (kind === "injuries") return [
    esc(item.severity + " " + item.kind),
    esc(item.status),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.caseId == null ? "" : caseLink(item.caseId),
    item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId),
    esc("care records " + (item.careRecordIds || []).length),
    esc("sustained " + years(item.year)),
    item.healedYear == null ? "" : esc("healed " + years(item.healedYear))
  ].filter(Boolean);
  if (kind === "illnesses") return [
    esc(item.severity + " " + item.kind),
    esc(item.status),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId),
    injuryLink(item.injuryId),
    esc("care records " + (item.careRecordIds || []).length),
    "onset " + eventLink(item.onsetEventId),
    item.resolvedEventId == null ? "" : "resolved by " + eventLink(item.resolvedEventId),
    esc("symptoms " + (item.symptoms || []).join(", ")),
    esc("began " + years(item.onsetYear)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "care-records") return [
    esc(item.kind),
    esc(item.outcome),
    "patient " + personLink(item.patientAgentId),
    item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    injuryLink(item.injuryId),
    item.illnessId == null ? "" : illnessLink(item.illnessId),
    "source " + eventLink(item.sourceEventId),
    esc("health " + item.healthDelta),
    esc("morale " + item.moraleDelta),
    esc("healer skill " + item.healerSkillDelta),
    esc(years(item.year))
  ].filter(Boolean);
  if (kind === "wound-legacies") return [
    esc(item.kind),
    esc(item.severity),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    injuryLink(item.injuryId),
    item.illnessId == null ? "" : illnessLink(item.illnessId),
    item.careRecordId == null ? "" : careRecordLink(item.careRecordId),
    item.healerAgentId == null ? "" : "healer " + personLink(item.healerAgentId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.battleParticipationId == null ? "" : battleParticipationLink(item.battleParticipationId),
    esc("health " + item.healthImpact),
    esc("stress " + item.stressImpact),
    esc("reputation " + item.reputationImpact),
    esc(years(item.year))
  ].filter(Boolean);
  if (kind === "memorials") return [
    esc(item.kind),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.battleId == null ? "" : battleLink(item.battleId),
    esc("raised " + years(item.year)),
    esc(item.inscription || "")
  ].filter(Boolean);
  if (kind === "burials") return [
    esc(item.kind),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.memorialId == null ? "" : memorialLink(item.memorialId),
    "death " + eventLink(item.deathEventId),
    esc("mourners " + (item.mournerAgentIds || []).length),
    esc("grave goods " + ((item.graveGoodArtifactIds || []).length + (item.graveGoodBelongingIds || []).length)),
    esc("laid to rest " + years(item.year))
  ].filter(Boolean);
  if (kind === "death-records") return [
    esc(item.kind + " death"),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.battleId == null ? "" : battleLink(item.battleId),
    item.battleParticipationId == null ? "" : battleParticipationLink(item.battleParticipationId),
    item.memorialId == null ? "" : memorialLink(item.memorialId),
    item.burialId == null ? "" : burialLink(item.burialId),
    item.estateId == null ? "" : estateLink(item.estateId),
    "source " + eventLink(item.sourceEventId),
    esc("age " + item.age),
    esc("died " + years(item.year))
  ].filter(Boolean);
  if (kind === "ambitions") return [
    esc(item.kind),
    esc(item.status),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.officeId == null ? "" : officeLink(item.officeId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.journeyId == null ? "" : journeyLink(item.journeyId),
    item.memorialId == null ? "" : memorialLink(item.memorialId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.mythId == null ? "" : mythLink(item.mythId),
    item.doctrineId == null ? "" : doctrineLink(item.doctrineId),
    item.magicRoleId == null ? "" : magicRoleLink(item.magicRoleId),
    item.prophecyId == null ? "" : prophecyLink(item.prophecyId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    item.targetWealth == null ? "" : esc("target wealth " + item.targetWealth),
    esc("formed " + years(item.startedYear)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "apprenticeships") return [
    esc(item.specialty),
    esc(item.status),
    "mentor " + personLink(item.mentorAgentId),
    "apprentice " + personLink(item.apprenticeAgentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    esc("started " + years(item.startedYear)),
    item.completedYear == null ? "" : esc("ended " + years(item.completedYear))
  ].filter(Boolean);
  if (kind === "skills") return [
    esc(item.rank + " " + item.specialty),
    "person " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    esc("level " + item.level),
    esc("practices " + item.practiceCount),
    esc("source events " + (item.sourceEventIds || []).length),
    esc("started " + years(item.startedYear)),
    esc("updated " + years(item.updatedYear))
  ].filter(Boolean);
  if (kind === "residences") return [
    esc(item.status),
    esc(item.reason),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("from " + years(item.startYear)),
    item.endYear == null ? "" : esc("to " + years(item.endYear))
  ].filter(Boolean);
  if (kind === "careers") return [
    esc(item.profession),
    esc(item.status),
    esc(item.reason),
    item.endReason == null ? "" : esc("ended by " + item.endReason),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.officeId == null ? "" : officeLink(item.officeId),
    "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("from " + years(item.startYear)),
    item.endYear == null ? "" : esc("to " + years(item.endYear))
  ].filter(Boolean);
  if (kind === "journeys") return [
    esc(item.kind),
    civLink(item.civilizationId),
    "from " + settlementLink(item.fromSettlementId),
    "to " + settlementLink(item.toSettlementId),
    item.originStructureId == null ? "" : "origin " + structureLink(item.originStructureId),
    item.destinationStructureId == null ? "" : "destination " + structureLink(item.destinationStructureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.sacredSiteId == null ? "" : sacredSiteLink(item.sacredSiteId),
    esc("travelers " + item.participantAgentIds.length),
    esc("distance " + item.distance)
  ].filter(Boolean);
  if (kind === "roads") return [
    esc(item.type),
    civLink(item.civilizationId),
    "from " + settlementLink(item.fromSettlementId),
    "to " + settlementLink(item.toSettlementId),
    esc("opened " + years(item.openedYear)),
    esc("length " + item.length),
    esc("strength " + item.strength),
    esc("cost " + item.cost),
    esc("points " + (item.pointCount || (item.points || []).length))
  ].filter(Boolean);
  if (kind === "relationships") return [
    esc(relationshipKindLabel(item.kind)),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    esc("started " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("ended " + years(item.endedYear)),
    item.lastInteractionEventId == null ? "" : "last interaction " + eventLink(item.lastInteractionEventId),
    esc(item.active ? "active" : "ended"),
    esc("strength " + item.strength),
    esc("status " + relationshipStatusLabel(item)),
    esc("affinity " + bondValue(item.affinity, 0).toFixed(3)),
    esc("trust " + bondValue(item.trust, 0).toFixed(3)),
    esc("tension " + bondValue(item.tension, 0).toFixed(3)),
    esc("familiarity " + bondValue(item.familiarity, 0).toFixed(3))
  ].filter(Boolean);
  if (kind === "relationship-milestones") return [
    esc(item.kind),
    esc(item.status),
    relationshipLink(item.relationshipId),
    "person " + personLink(item.agentIds[0]),
    "person " + personLink(item.agentIds[1]),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    "source " + eventLink(item.sourceEventId),
    item.socialClaimId == null ? "" : socialClaimLink(item.socialClaimId),
    item.conversationId == null ? "" : conversationLink(item.conversationId),
    esc("strength " + item.strength),
    esc("affinity " + bondValue(item.affinity, 0).toFixed(3)),
    esc("trust " + bondValue(item.trust, 0).toFixed(3)),
    esc("tension " + bondValue(item.tension, 0).toFixed(3)),
    esc("familiarity " + bondValue(item.familiarity, 0).toFixed(3)),
    esc(years(item.year))
  ].filter(Boolean);
  if (kind === "unions") return [
    esc(item.status),
    "partner " + personLink(item.partnerAgentIds[0]),
    "partner " + personLink(item.partnerAgentIds[1]),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    ...(item.lineageIds || []).slice(0, 3).map(lineageLink),
    item.startEventId == null ? "" : "started by " + eventLink(item.startEventId),
    item.endEventId == null ? "" : "ended by " + eventLink(item.endEventId),
    esc("children " + (item.childAgentIds || []).length),
    esc("from " + years(item.startedYear)),
    item.endedYear == null ? "" : esc("to " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "artifacts") {
    const owner = item.ownerAgentId == null ? settlementLink(item.ownerSettlementId) : personLink(item.ownerAgentId);
    return [
      esc(item.scale || "personal"),
      esc(item.purpose || "object"),
      esc((item.decorationKind || "plain") + " decoration"),
      esc(item.quality + " " + item.material + " " + item.kind),
      esc("condition " + (item.condition || "unknown")),
      item.value == null ? "" : esc("value " + item.value),
      esc("renown " + item.renown),
      esc("created " + years(item.createdYear)),
      "creator " + personLink(item.creatorAgentId),
      "holder " + owner,
      item.structureId == null ? "" : structureLink(item.structureId),
      item.projectId == null ? "" : projectLink(item.projectId),
      settlementLink(item.ownerSettlementId)
    ].filter(Boolean);
  }
  if (kind === "artifact-conditions") return [
    esc(item.kind),
    esc("condition " + item.condition),
    artifactLink(item.artifactId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.actorAgentId == null ? "" : "actor " + personLink(item.actorAgentId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.projectId == null ? "" : projectLink(item.projectId),
    item.battleId == null ? "" : battleLink(item.battleId),
    "source " + eventLink(item.sourceEventId),
    esc("severity " + item.severity),
    esc("recorded " + years(item.year))
  ].filter(Boolean);
  if (kind === "chronicles") return [
    esc(item.kind),
    "author " + personLink(item.authorAgentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    esc("written " + years(item.year)),
    esc("source events " + item.sourceEventIds.length),
    esc("subjects " + item.subjectRefs.length)
  ].filter(Boolean);
  if (kind === "written-works") return [
    esc(item.kind),
    "author " + personLink(item.authorAgentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.sourceChronicleId == null ? "" : "source chronicle " + chronicleLink(item.sourceChronicleId),
    esc("authored " + years(item.year)),
    esc("source events " + (item.sourceEventIds || []).length),
    esc("copies " + item.copies),
    esc("influence " + item.influence)
  ].filter(Boolean);
  if (kind === "memories") return [
    esc(item.emotion),
    esc("intensity " + item.intensity),
    esc("stress " + item.stressImpact),
    "remembered by " + personLink(item.agentId),
    civLink(item.civilizationId),
    item.settlementId == null ? "" : settlementLink(item.settlementId),
    "source " + eventLink(item.sourceEventId),
    esc("formed " + years(item.year))
  ].filter(Boolean);
  if (kind === "thoughts") return [
    esc(item.tone),
    esc(item.kind),
    "held by " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.sourceMemoryId == null ? "" : "memory " + memoryLink(item.sourceMemoryId),
    item.sourceEventId == null ? "" : "source " + eventLink(item.sourceEventId),
    item.activityId == null ? "" : activityLink(item.activityId),
    item.ceremonyId == null ? "" : ceremonyLink(item.ceremonyId),
    item.preferenceId == null ? "" : preferenceLink(item.preferenceId),
    item.traditionId == null ? "" : traditionLink(item.traditionId),
    esc("intensity " + item.intensity),
    esc("mood " + item.moodDelta),
    esc("stress " + item.stressDelta),
    esc("formed " + years(item.year))
  ].filter(Boolean);
  if (kind === "personality-shifts") return [
    esc(item.kind),
    item.trait == null ? "" : esc("trait " + item.trait),
    item.value == null ? "" : esc("value " + item.value),
    "changed " + personLink(item.agentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "memory " + memoryLink(item.sourceMemoryId),
    "source " + eventLink(item.sourceEventId),
    esc("intensity " + item.intensity),
    esc("formed " + years(item.year))
  ].filter(Boolean);
  if (kind === "need-episodes") return [
    esc(item.kind),
    esc(item.status),
    esc("trigger " + item.trigger),
    "person " + personLink(item.personId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.sourceEventId == null ? "" : "source " + eventLink(item.sourceEventId),
    item.resolvedEventId == null ? "" : "resolved by " + eventLink(item.resolvedEventId),
    item.sourceMemoryId == null ? "" : memoryLink(item.sourceMemoryId),
    item.sourcePersonalityShiftId == null ? "" : personalityShiftLink(item.sourcePersonalityShiftId),
    item.lastActivityId == null ? "" : activityLink(item.lastActivityId),
    item.lastCeremonyId == null ? "" : ceremonyLink(item.lastCeremonyId),
    item.lastThoughtId == null ? "" : thoughtLink(item.lastThoughtId),
    esc("urgency " + item.urgency),
    esc("satisfaction " + item.satisfaction),
    esc("peak " + item.peakUrgency),
    esc("lowest " + item.lowestSatisfaction),
    esc("relief " + item.relief),
    esc("started " + years(item.startedYear)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "opinions") return [
    esc(item.kind),
    "held by " + personLink(item.agentId),
    item.targetRef == null ? "" : refLink(item.targetRef),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "memory " + memoryLink(item.sourceMemoryId),
    "source " + eventLink(item.sourceEventId),
    esc("intensity " + item.intensity),
    esc("valence " + item.valence),
    esc("formed " + years(item.year)),
    item.updatedYear === item.year ? "" : esc("updated " + years(item.updatedYear))
  ].filter(Boolean);
  if (kind === "social-claims") return [
    esc(item.kind),
    esc(item.status),
    "held by " + personLink(item.agentId),
    "target " + personLink(item.targetAgentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
    "opinion " + opinionLink(item.sourceOpinionId),
    "memory " + memoryLink(item.sourceMemoryId),
    "source " + eventLink(item.sourceEventId),
    esc("intensity " + item.intensity),
    esc("formed " + years(item.year)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "rumors") return [
    esc(item.kind),
    civLink(item.civilizationId),
    "origin " + settlementLink(item.originSettlementId),
    item.tellerAgentId == null ? "" : "first teller " + personLink(item.tellerAgentId),
    "source " + eventLink(item.sourceEventId),
    esc("spread places " + (item.spreadSettlementIds || []).length),
    esc("strength " + item.strength),
    esc("certainty " + item.certainty),
    esc("began " + years(item.year))
  ].filter(Boolean);
  if (kind === "secrets") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "source " + eventLink(item.sourceEventId),
    item.revealedEventId == null ? "" : "revealed by " + eventLink(item.revealedEventId),
    esc("severity " + item.severity),
    esc("keepers " + (item.keeperAgentIds || []).length),
    esc("began " + years(item.year)),
    item.revealedYear == null ? "" : esc("revealed " + years(item.revealedYear))
  ].filter(Boolean);
  if (kind === "schemes") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "leader " + personLink(item.leaderAgentId),
    item.targetAgentId == null ? "" : "target " + personLink(item.targetAgentId),
    item.targetOfficeId == null ? "" : officeLink(item.targetOfficeId),
    item.targetCaseId == null ? "" : caseLink(item.targetCaseId),
    item.targetSecretId == null ? "" : secretLink(item.targetSecretId),
    item.targetAmbitionId == null ? "" : ambitionLink(item.targetAmbitionId),
    item.targetFeudId == null ? "" : feudLink(item.targetFeudId),
    item.targetProphecyId == null ? "" : prophecyLink(item.targetProphecyId),
    item.targetCivilizationGoalId == null ? "" : civilizationGoalLink(item.targetCivilizationGoalId),
    item.sourceEventId == null ? "" : "source " + eventLink(item.sourceEventId),
    item.resolvedEventId == null ? "" : "resolved by " + eventLink(item.resolvedEventId),
    esc("secrecy " + item.secrecy),
    esc("progress " + item.progress),
    esc("heat " + item.heat),
    esc("started " + years(item.startedYear)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "feuds") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "source " + eventLink(item.sourceEventId),
    item.settledEventId == null ? "" : "settled by " + eventLink(item.settledEventId),
    esc("severity " + item.severity),
    esc("side A " + (item.sideAAgentIds || []).length),
    esc("side B " + (item.sideBAgentIds || []).length),
    esc("started " + years(item.startedYear)),
    item.settledYear == null ? "" : esc("settled " + years(item.settledYear))
  ].filter(Boolean);
  if (kind === "oaths") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "swearer " + personLink(item.swearerAgentId),
    item.targetProphecyId == null ? "" : prophecyLink(item.targetProphecyId),
    item.targetCivilizationGoalId == null ? "" : civilizationGoalLink(item.targetCivilizationGoalId),
    item.targetBeliefId == null ? "" : beliefLink(item.targetBeliefId),
    item.targetSecretId == null ? "" : secretLink(item.targetSecretId),
    item.targetFeudId == null ? "" : feudLink(item.targetFeudId),
    "source " + eventLink(item.sourceEventId),
    item.resolvedEventId == null ? "" : "resolved by " + eventLink(item.resolvedEventId),
    esc("strength " + item.strength),
    esc("witnesses " + (item.witnessAgentIds || []).length),
    esc("sworn " + years(item.swornYear)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "ceremonies") return [
    esc(item.kind),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    item.officeId == null ? "" : officeLink(item.officeId),
    item.hostAgentId == null ? "" : "host " + personLink(item.hostAgentId),
    esc("participants " + (item.participantAgentIds || []).length),
    esc("artifacts " + (item.artifactIds || []).length),
    esc("held " + years(item.year))
  ].filter(Boolean);
  if (kind === "ceremony-participations") return [
    esc(item.role),
    esc(item.kind),
    "person " + personLink(item.agentId),
    ceremonyLink(item.ceremonyId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    item.officeId == null ? "" : officeLink(item.officeId),
    "ceremony event " + eventLink(item.ceremonyEventId),
    esc("artifacts " + (item.artifactIds || []).length),
    esc("attended " + years(item.year))
  ].filter(Boolean);
  if (kind === "activities") return [
    esc(item.kind),
    "primary " + personLink(item.primaryAgentId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    esc("participants " + (item.participantAgentIds || []).length),
    esc("mood " + item.moodDelta),
    esc("stress " + item.stressDelta),
    esc("happened " + years(item.year))
  ].filter(Boolean);
  if (kind === "projects") return [
    esc(item.kind),
    esc(item.outcome),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "lead " + personLink(item.leadAgentId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.officeId == null ? "" : officeLink(item.officeId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.injuryId == null ? "" : injuryLink(item.injuryId),
    item.caseId == null ? "" : caseLink(item.caseId),
    esc("workers " + (item.workerAgentIds || []).length),
    esc("quality " + item.quality),
    esc("food " + item.foodDelta),
    esc("materials " + item.materialDelta),
    esc("wealth " + item.wealthDelta),
    esc("held " + years(item.year))
  ].filter(Boolean);
  if (kind === "project-participations") return [
    esc(item.role),
    esc(item.outcome),
    esc(item.specialty),
    "person " + personLink(item.agentId),
    projectLink(item.projectId),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.officeId == null ? "" : officeLink(item.officeId),
    item.beliefId == null ? "" : beliefLink(item.beliefId),
    item.civilizationGoalId == null ? "" : civilizationGoalLink(item.civilizationGoalId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.injuryId == null ? "" : injuryLink(item.injuryId),
    item.caseId == null ? "" : caseLink(item.caseId),
    "project event " + eventLink(item.projectEventId),
    esc("quality " + item.quality),
    esc("worked " + years(item.year))
  ].filter(Boolean);
  if (kind === "obligations") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    "creditor " + personLink(item.creditorAgentId),
    "debtor " + personLink(item.debtorAgentId),
    "source " + eventLink(item.sourceEventId),
    item.resolvedEventId == null ? "" : "resolved by " + eventLink(item.resolvedEventId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.caseId == null ? "" : caseLink(item.caseId),
    item.relationshipId == null ? "" : relationshipLink(item.relationshipId),
    item.projectId == null ? "" : projectLink(item.projectId),
    item.oathId == null ? "" : oathLink(item.oathId),
    esc("amount " + item.amount),
    esc("created " + years(item.createdYear)),
    item.resolvedYear == null ? "" : esc("resolved " + years(item.resolvedYear))
  ].filter(Boolean);
  if (kind === "holdings") return [
    esc(item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.ownerAgentId == null ? "" : "owner " + personLink(item.ownerAgentId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.structureId == null ? "" : structureLink(item.structureId),
    item.organizationId == null ? "" : organizationLink(item.organizationId),
    item.officeId == null ? "" : officeLink(item.officeId),
    "source " + eventLink(item.sourceEventId),
    item.transferredEventId == null ? "" : "last transfer " + eventLink(item.transferredEventId),
    esc("value " + item.value),
    esc("claimed " + years(item.foundedYear)),
    item.endedYear == null ? "" : esc("ended " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "belongings") return [
    esc(item.material + " " + item.kind),
    esc(item.status),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.ownerAgentId == null ? "" : "owner " + personLink(item.ownerAgentId),
    item.previousOwnerAgentId == null ? "" : "previous " + personLink(item.previousOwnerAgentId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.holdingId == null ? "" : holdingLink(item.holdingId),
    item.structureId == null ? "" : structureLink(item.structureId),
    "source " + eventLink(item.sourceEventId),
    item.transferredEventId == null ? "" : "last change " + eventLink(item.transferredEventId),
    esc("value " + item.value),
    esc("sentiment " + item.sentiment),
    esc("acquired " + years(item.acquiredYear)),
    item.endedYear == null ? "" : esc("ended " + years(item.endedYear))
  ].filter(Boolean);
  if (kind === "possession-attachments") return [
    esc(item.kind),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    personLink(item.agentId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.artifactId == null ? "" : artifactLink(item.artifactId),
    item.belongingId == null ? "" : belongingLink(item.belongingId),
    "source " + eventLink(item.sourceEventId),
    ...(item.memoryIds || []).slice(0, 4).map(memoryLink),
    esc("intensity " + item.intensity),
    esc("formed " + years(item.year))
  ].filter(Boolean);
  if (kind === "estates") return [
    "decedent " + personLink(item.decedentAgentId),
    ...(item.heirAgentIds || []).slice(0, 6).map(id => "heir " + personLink(id)),
    civLink(item.civilizationId),
    settlementLink(item.settlementId),
    item.householdId == null ? "" : householdLink(item.householdId),
    item.lineageId == null ? "" : lineageLink(item.lineageId),
    item.memorialId == null ? "" : memorialLink(item.memorialId),
    "death " + eventLink(item.deathEventId),
    esc("artifacts " + (item.artifactIds || []).length),
    esc("holdings " + (item.holdingIds || []).length),
    esc("belongings " + (item.belongingIds || []).length),
    esc("disputes " + (item.disputeCaseIds || []).length),
    esc("settled " + years(item.year))
  ].filter(Boolean);
  if (kind === "civilizations") return [
    item.status == null ? "" : esc(item.status),
    item.originKind == null ? "" : esc(item.originKind),
    esc("population " + item.population),
    "capital " + settlementLink(item.capitalSettlementId),
    item.parentCivilizationId == null ? "" : "parent " + civLink(item.parentCivilizationId),
    item.restoredCivilizationId == null ? "" : "restored " + civLink(item.restoredCivilizationId),
    item.foundedYear == null ? "" : esc("founded " + years(item.foundedYear)),
    item.fallenYear == null ? "" : esc("fallen " + years(item.fallenYear)),
    item.collapsePressure == null ? "" : esc("collapse pressure " + item.collapsePressure),
    item.creationDomain == null ? "" : esc("creation " + item.creationDomain),
    item.creationGodId == null ? "" : "creator " + godLink(item.creationGodId),
    item.creationSeatScore == null ? "" : esc("seat score " + item.creationSeatScore)
  ];
  return [esc(item.type), esc(years(item.year))];
}
function relationGroup(label, links) {
  if (!links.length) return "";
  return '<div class="relation-group"><strong>' + esc(label) + '</strong><div class="refs">' + links.join("") + '</div></div>';
}
function settlementControlsAbout(refKind, id, limit) {
  return data.settlementControls
    .filter(control =>
      (control.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "settlement" && control.settlementId === id) ||
      (refKind === "civilization" && (control.civilizationId === id || control.previousCivilizationId === id)) ||
      (refKind === "conflict" && control.conflictId === id) ||
      (refKind === "battle" && control.battleId === id) ||
      (refKind === "event" && (control.startEventId === id || control.endEventId === id || (control.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(control => settlementControlLink(control.id));
}
function personAllegiancesAbout(refKind, id, limit) {
  return data.personAllegiances
    .filter(allegiance =>
      (allegiance.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && allegiance.agentId === id) ||
      (refKind === "civilization" && (allegiance.civilizationId === id || allegiance.previousCivilizationId === id)) ||
      (refKind === "settlement" && allegiance.settlementId === id) ||
      (refKind === "conflict" && allegiance.conflictId === id) ||
      (refKind === "battle" && allegiance.battleId === id) ||
      (refKind === "event" && (allegiance.startEventId === id || allegiance.endEventId === id || (allegiance.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(allegiance => personAllegianceLink(allegiance.id));
}
function preferencesAbout(refKind, id, limit) {
  return data.preferences
    .filter(preference =>
      (preference.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && preference.agentId === id) ||
      (refKind === "settlement" && preference.settlementId === id) ||
      (refKind === "civilization" && preference.civilizationId === id) ||
      (refKind === "event" && ((preference.eventIds || []).includes(id) || preference.recordedEventId === id))
    )
    .slice(0, limit || 80)
    .map(preference => preferenceLink(preference.id));
}
function traditionsAbout(refKind, id, limit) {
  return data.traditions
    .filter(tradition =>
      (tradition.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && ((tradition.adherentAgentIds || []).includes(id) || tradition.founderAgentId === id)) ||
      (refKind === "settlement" && tradition.settlementId === id) ||
      (refKind === "civilization" && tradition.civilizationId === id) ||
      (refKind === "belief" && tradition.beliefId === id) ||
      (refKind === "organization" && tradition.organizationId === id) ||
      (refKind === "activity" && (tradition.activityIds || []).includes(id)) ||
      (refKind === "ceremony" && (tradition.ceremonyIds || []).includes(id)) ||
      (refKind === "written-work" && (tradition.writtenWorkIds || []).includes(id)) ||
      (refKind === "event" && (tradition.eventIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(tradition => traditionLink(tradition.id));
}
function battleParticipationsAbout(refKind, id, limit) {
  return data.battleParticipations
    .filter(participation =>
      (participation.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && participation.agentId === id) ||
      (refKind === "battle" && participation.battleId === id) ||
      (refKind === "conflict" && participation.conflictId === id) ||
      (refKind === "settlement" && participation.settlementId === id) ||
      (refKind === "civilization" && (participation.civilizationId === id || participation.opposingCivilizationId === id)) ||
      (refKind === "injury" && (participation.injuryIds || []).includes(id)) ||
      (refKind === "event" && (participation.battleEventId === id || participation.casualtyEventId === id || (participation.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(participation => battleParticipationLink(participation.id));
}
function chroniclesAbout(refKind, id, limit) {
  return data.chronicles
    .filter(chronicle => (chronicle.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id))
    .slice(0, limit || 80)
    .map(chronicle => chronicleLink(chronicle.id));
}
function writtenWorksAbout(refKind, id, limit) {
  return data.writtenWorks
    .filter(work =>
      (work.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && work.authorAgentId === id) ||
      (refKind === "settlement" && work.settlementId === id) ||
      (refKind === "civilization" && work.civilizationId === id) ||
      (refKind === "structure" && work.structureId === id) ||
      (refKind === "organization" && work.organizationId === id) ||
      (refKind === "belief" && work.beliefId === id) ||
      (refKind === "chronicle" && work.sourceChronicleId === id) ||
      (refKind === "event" && (work.sourceEventIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(work => writtenWorkLink(work.id));
}
function memoriesAbout(refKind, id, limit) {
  return data.memories
    .filter(memory =>
      (memory.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && memory.agentId === id) ||
      (refKind === "settlement" && memory.settlementId === id) ||
      (refKind === "civilization" && memory.civilizationId === id) ||
      (refKind === "event" && (memory.sourceEventId === id || (memory.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(memory => memoryLink(memory.id));
}
function thoughtsAbout(refKind, id, limit) {
  return data.thoughts
    .filter(thought =>
      (thought.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && thought.agentId === id) ||
      (refKind === "settlement" && thought.settlementId === id) ||
      (refKind === "civilization" && thought.civilizationId === id) ||
      (refKind === "memory" && thought.sourceMemoryId === id) ||
      (refKind === "activity" && thought.activityId === id) ||
      (refKind === "ceremony" && thought.ceremonyId === id) ||
      (refKind === "preference" && thought.preferenceId === id) ||
      (refKind === "tradition" && thought.traditionId === id) ||
      (refKind === "event" && (thought.sourceEventId === id || (thought.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(thought => thoughtLink(thought.id));
}
function personalityShiftsAbout(refKind, id, limit) {
  return data.personalityShifts
    .filter(shift =>
      (shift.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && shift.agentId === id) ||
      (refKind === "settlement" && shift.settlementId === id) ||
      (refKind === "civilization" && shift.civilizationId === id) ||
      (refKind === "memory" && shift.sourceMemoryId === id) ||
      (refKind === "event" && (shift.sourceEventId === id || (shift.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.intensity - a.intensity || a.id - b.id)
    .slice(0, limit || 80)
    .map(shift => personalityShiftLink(shift.id));
}
function needEpisodesAbout(refKind, id, limit) {
  return data.needEpisodes
    .filter(episode =>
      (episode.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && episode.personId === id) ||
      (refKind === "settlement" && episode.settlementId === id) ||
      (refKind === "civilization" && episode.civilizationId === id) ||
      (refKind === "household" && episode.householdId === id) ||
      (refKind === "structure" && episode.structureId === id) ||
      (refKind === "memory" && episode.sourceMemoryId === id) ||
      (refKind === "personality-shift" && episode.sourcePersonalityShiftId === id) ||
      (refKind === "activity" && episode.lastActivityId === id) ||
      (refKind === "ceremony" && episode.lastCeremonyId === id) ||
      (refKind === "thought" && episode.lastThoughtId === id) ||
      (refKind === "event" && (episode.sourceEventId === id || episode.resolvedEventId === id || (episode.eventIds || []).includes(id)))
    )
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.startedYear - a.startedYear || a.id - b.id)
    .slice(0, limit || 80)
    .map(episode => needEpisodeLink(episode.id));
}
function ambitionsAbout(refKind, id, limit) {
  return data.ambitions
    .filter(ambition =>
      (ambition.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && ambition.personId === id) ||
      (refKind === "settlement" && ambition.settlementId === id) ||
      (refKind === "civilization" && ambition.civilizationId === id) ||
      (refKind === "memory" && ambition.sourceMemoryId === id) ||
      (refKind === "personality-shift" && ambition.personalityShiftId === id) ||
      (refKind === "belief" && ambition.beliefId === id) ||
      (refKind === "myth" && ambition.mythId === id) ||
      (refKind === "doctrine" && ambition.doctrineId === id) ||
      (refKind === "magic-role" && ambition.magicRoleId === id) ||
      (refKind === "prophecy" && ambition.prophecyId === id) ||
      (refKind === "civilization-goal" && ambition.civilizationGoalId === id) ||
      (refKind === "event" && (ambition.eventIds || []).includes(id))
    )
    .sort((a, b) => b.startedYear - a.startedYear || a.id - b.id)
    .slice(0, limit || 80)
    .map(ambition => ambitionLink(ambition.id));
}
function opinionsAbout(refKind, id, limit) {
  return data.opinions
    .filter(opinion =>
      (opinion.targetRef && opinion.targetRef.kind === refKind && opinion.targetRef.id === id) ||
      (opinion.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && opinion.agentId === id) ||
      (refKind === "settlement" && opinion.settlementId === id) ||
      (refKind === "memory" && opinion.sourceMemoryId === id) ||
      (refKind === "event" && opinion.sourceEventId === id)
    )
    .slice(0, limit || 80)
    .map(opinion => opinionLink(opinion.id));
}
function socialClaimsAbout(refKind, id, limit) {
  return data.socialClaims
    .filter(claim =>
      (claim.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (claim.agentId === id || claim.targetAgentId === id)) ||
      (refKind === "settlement" && claim.settlementId === id) ||
      (refKind === "civilization" && claim.civilizationId === id) ||
      (refKind === "relationship" && claim.relationshipId === id) ||
      (refKind === "opinion" && claim.sourceOpinionId === id) ||
      (refKind === "memory" && claim.sourceMemoryId === id) ||
      (refKind === "event" && (claim.sourceEventId === id || (claim.eventIds || []).includes(id)))
    )
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.intensity - a.intensity || b.year - a.year || a.id - b.id)
    .slice(0, limit || 80)
    .map(claim => socialClaimLink(claim.id));
}
function conversationsAbout(refKind, id, limit) {
  return data.conversations
    .filter(conversation =>
      (conversation.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (conversation.speakerAgentId === id || conversation.listenerAgentId === id)) ||
      (refKind === "settlement" && conversation.settlementId === id) ||
      (refKind === "civilization" && conversation.civilizationId === id) ||
      (refKind === "relationship" && conversation.relationshipId === id) ||
      (refKind === "activity" && conversation.activityId === id) ||
      (refKind === "teaching" && conversation.teachingId === id) ||
      (refKind === "rumor" && conversation.rumorId === id) ||
      (refKind === "secret" && conversation.secretId === id) ||
      (refKind === "memory" && conversation.memoryId === id) ||
      (refKind === "belief" && conversation.beliefId === id) ||
      (refKind === "tradition" && conversation.traditionId === id) ||
      (refKind === "artifact" && conversation.artifactId === id) ||
      (refKind === "event" && (conversation.sourceEventId === id || (conversation.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 80)
    .map(conversation => conversationLink(conversation.id));
}
function relationshipMilestonesAbout(refKind, id, limit) {
  return data.relationshipMilestones
    .filter(milestone =>
      (milestone.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (milestone.agentIds || []).includes(id)) ||
      (refKind === "relationship" && milestone.relationshipId === id) ||
      (refKind === "settlement" && milestone.settlementId === id) ||
      (refKind === "civilization" && milestone.civilizationId === id) ||
      (refKind === "organization" && milestone.organizationId === id) ||
      (refKind === "social-claim" && milestone.socialClaimId === id) ||
      (refKind === "conversation" && milestone.conversationId === id) ||
      (refKind === "event" && (milestone.sourceEventId === id || (milestone.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 80)
    .map(milestone => relationshipMilestoneLink(milestone.id));
}
function reputationMilestonesAbout(refKind, id, limit) {
  return data.reputationMilestones
    .filter(milestone =>
      (milestone.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && milestone.agentId === id) ||
      (refKind === "settlement" && milestone.settlementId === id) ||
      (refKind === "civilization" && milestone.civilizationId === id) ||
      (refKind === "household" && milestone.householdId === id) ||
      (refKind === "lineage" && milestone.lineageId === id) ||
      (refKind === "epithet" && milestone.epithetId === id) ||
      (refKind === "event" && (milestone.sourceEventId === id || (milestone.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.reputation - a.reputation || b.id - a.id)
    .slice(0, limit || 80)
    .map(milestone => reputationMilestoneLink(milestone.id));
}
function testimoniesAbout(refKind, id, limit) {
  return data.testimonies
    .filter(testimony =>
      (testimony.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (testimony.witnessAgentId === id || testimony.accusedAgentId === id || testimony.victimAgentId === id)) ||
      (refKind === "settlement" && testimony.settlementId === id) ||
      (refKind === "civilization" && testimony.civilizationId === id) ||
      (refKind === "case" && testimony.caseId === id) ||
      (refKind === "law" && testimony.lawId === id) ||
      (refKind === "office" && testimony.officeId === id) ||
      (refKind === "structure" && testimony.structureId === id) ||
      (refKind === "rumor" && testimony.rumorId === id) ||
      (refKind === "secret" && testimony.secretId === id) ||
      (refKind === "conversation" && testimony.conversationId === id) ||
      (refKind === "memory" && testimony.memoryId === id) ||
      (refKind === "event" && (testimony.sourceEventId === id || (testimony.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 80)
    .map(testimony => testimonyLink(testimony.id));
}
function epithetsAbout(refKind, id, limit) {
  return data.epithets
    .filter(epithet =>
      (epithet.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && epithet.agentId === id) ||
      (refKind === "settlement" && epithet.settlementId === id) ||
      (refKind === "civilization" && epithet.civilizationId === id) ||
      (refKind === "household" && epithet.householdId === id) ||
      (refKind === "lineage" && epithet.lineageId === id) ||
      (refKind === "event" && (epithet.sourceEventId === id || (epithet.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || a.id - b.id)
    .slice(0, limit || 80)
    .map(epithet => epithetRecordLink(epithet.id));
}
function organizationRanksAbout(refKind, id, limit) {
  return data.organizationRanks
    .filter(rank =>
      (rank.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (rank.agentId === id || rank.sponsorAgentId === id)) ||
      (refKind === "settlement" && rank.settlementId === id) ||
      (refKind === "civilization" && rank.civilizationId === id) ||
      (refKind === "organization" && rank.organizationId === id) ||
      (refKind === "membership" && rank.membershipId === id) ||
      (refKind === "structure" && rank.structureId === id) ||
      (refKind === "belief" && rank.beliefId === id) ||
      (refKind === "organization-rank" && rank.previousRankId === id) ||
      (refKind === "event" && (rank.sourceEventId === id || (rank.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.startedYear - a.startedYear || b.prestige - a.prestige || a.id - b.id)
    .slice(0, limit || 80)
    .map(rank => organizationRankLink(rank.id));
}
function skillsAbout(refKind, id, limit) {
  return data.skills
    .filter(skill =>
      (skill.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && skill.agentId === id) ||
      (refKind === "settlement" && skill.settlementId === id) ||
      (refKind === "project" && (skill.projectIds || []).includes(id)) ||
      (refKind === "apprenticeship" && (skill.apprenticeshipIds || []).includes(id)) ||
      (refKind === "event" && (skill.sourceEventIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(skill => skillLink(skill.id));
}
function residencesAbout(refKind, id, limit) {
  return data.residences
    .filter(residence =>
      (residence.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && residence.personId === id) ||
      (refKind === "settlement" && residence.settlementId === id) ||
      (refKind === "civilization" && residence.civilizationId === id) ||
      (refKind === "household" && residence.householdId === id) ||
      (refKind === "structure" && residence.structureId === id) ||
      (refKind === "event" && (residence.startEventId === id || residence.endEventId === id || (residence.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(residence => residenceLink(residence.id));
}
function careersAbout(refKind, id, limit) {
  return data.careers
    .filter(career =>
      (career.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && career.personId === id) ||
      (refKind === "settlement" && career.settlementId === id) ||
      (refKind === "civilization" && career.civilizationId === id) ||
      (refKind === "household" && career.householdId === id) ||
      (refKind === "structure" && career.structureId === id) ||
      (refKind === "organization" && career.organizationId === id) ||
      (refKind === "office" && career.officeId === id) ||
      (refKind === "event" && (career.startEventId === id || career.endEventId === id || (career.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(career => careerLink(career.id));
}
function membershipsAbout(refKind, id, limit) {
  return data.memberships
    .filter(membership =>
      (membership.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && membership.agentId === id) ||
      (refKind === "organization" && membership.organizationId === id) ||
      (refKind === "settlement" && membership.settlementId === id) ||
      (refKind === "civilization" && membership.civilizationId === id) ||
      (refKind === "structure" && membership.structureId === id) ||
      (refKind === "belief" && membership.beliefId === id) ||
      (refKind === "event" && (membership.startEventId === id || membership.endEventId === id || (membership.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(membership => membershipLink(membership.id));
}
function beliefAdherencesAbout(refKind, id, limit) {
  return data.beliefAdherences
    .filter(adherence =>
      (adherence.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && adherence.agentId === id) ||
      (refKind === "belief" && adherence.beliefId === id) ||
      (refKind === "settlement" && adherence.settlementId === id) ||
      (refKind === "civilization" && adherence.civilizationId === id) ||
      (refKind === "event" && (adherence.startEventId === id || adherence.endEventId === id || (adherence.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(adherence => beliefAdherenceLink(adherence.id));
}
function officeTermsAbout(refKind, id, limit) {
  return data.officeTerms
    .filter(term =>
      (term.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && term.holderAgentId === id) ||
      (refKind === "office" && term.officeId === id) ||
      (refKind === "settlement" && term.settlementId === id) ||
      (refKind === "civilization" && term.civilizationId === id) ||
      (refKind === "structure" && term.structureId === id) ||
      (refKind === "event" && (term.startEventId === id || term.endEventId === id || (term.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(term => officeTermLink(term.id));
}
function illnessesAbout(refKind, id, limit) {
  return data.illnesses
    .filter(illness =>
      (illness.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (illness.personId === id || illness.healerAgentId === id)) ||
      (refKind === "settlement" && illness.settlementId === id) ||
      (refKind === "civilization" && illness.civilizationId === id) ||
      (refKind === "household" && illness.householdId === id) ||
      (refKind === "structure" && illness.structureId === id) ||
      (refKind === "injury" && illness.injuryId === id) ||
      (refKind === "event" && (illness.onsetEventId === id || illness.resolvedEventId === id || (illness.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(illness => illnessLink(illness.id));
}
function careRecordsAbout(refKind, id, limit) {
  return data.careRecords
    .filter(care =>
      (care.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (care.patientAgentId === id || care.healerAgentId === id)) ||
      (refKind === "settlement" && care.settlementId === id) ||
      (refKind === "civilization" && care.civilizationId === id) ||
      (refKind === "household" && care.householdId === id) ||
      (refKind === "structure" && care.structureId === id) ||
      (refKind === "injury" && care.injuryId === id) ||
      (refKind === "illness" && care.illnessId === id) ||
      (refKind === "event" && (care.sourceEventId === id || (care.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(care => careRecordLink(care.id));
}
function woundLegaciesAbout(refKind, id, limit) {
  return data.woundLegacies
    .filter(legacy =>
      (legacy.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (legacy.personId === id || legacy.healerAgentId === id)) ||
      (refKind === "settlement" && legacy.settlementId === id) ||
      (refKind === "civilization" && legacy.civilizationId === id) ||
      (refKind === "household" && legacy.householdId === id) ||
      (refKind === "structure" && legacy.structureId === id) ||
      (refKind === "injury" && legacy.injuryId === id) ||
      (refKind === "illness" && legacy.illnessId === id) ||
      (refKind === "care-record" && legacy.careRecordId === id) ||
      (refKind === "battle" && legacy.battleId === id) ||
      (refKind === "battle-participation" && legacy.battleParticipationId === id) ||
      (refKind === "event" && (legacy.sourceEventId === id || (legacy.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(legacy => woundLegacyLink(legacy.id));
}
function unionsAbout(refKind, id, limit) {
  return data.unions
    .filter(union =>
      (union.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && ((union.partnerAgentIds || []).includes(id) || (union.childAgentIds || []).includes(id))) ||
      (refKind === "settlement" && union.settlementId === id) ||
      (refKind === "civilization" && union.civilizationId === id) ||
      (refKind === "household" && union.householdId === id) ||
      (refKind === "structure" && union.structureId === id) ||
      (refKind === "lineage" && (union.lineageIds || []).includes(id)) ||
      (refKind === "event" && (union.startEventId === id || union.endEventId === id || (union.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(union => unionLink(union.id));
}
function conflictsAbout(refKind, id, limit) {
  return data.conflicts
    .filter(conflict =>
      (refKind === "civilization" && (conflict.attackerCivilizationId === id || conflict.defenderCivilizationId === id || conflict.instigatorCivilizationId === id)) ||
      (refKind === "settlement" && (conflict.targetSettlementId === id || (conflict.contestedSettlementIds || []).includes(id) || (conflict.capturedSettlementIds || []).includes(id))) ||
      (refKind === "battle" && (conflict.battleIds || []).includes(id)) ||
      (refKind === "person" && (conflict.casualtyAgentIds || []).includes(id)) ||
      (refKind === "artifact" && (conflict.capturedArtifactIds || []).includes(id)) ||
      (refKind === "event" && (conflict.startedEventId === id || conflict.endedEventId === id || (conflict.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(conflict => conflictLink(conflict.id));
}
function rumorsAbout(refKind, id, limit) {
  return data.rumors
    .filter(rumor => (rumor.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id))
    .slice(0, limit || 80)
    .map(rumor => rumorLink(rumor.id));
}
function secretsAbout(refKind, id, limit) {
  return data.secrets
    .filter(secret => (secret.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id))
    .slice(0, limit || 80)
    .map(secret => secretLink(secret.id));
}
function schemesAbout(refKind, id, limit) {
  return data.schemes
    .filter(scheme =>
      (scheme.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (scheme.leaderAgentId === id || scheme.targetAgentId === id || (scheme.conspiratorAgentIds || []).includes(id))) ||
      (refKind === "civilization" && scheme.civilizationId === id) ||
      (refKind === "settlement" && scheme.settlementId === id) ||
      (refKind === "office" && scheme.targetOfficeId === id) ||
      (refKind === "case" && scheme.targetCaseId === id) ||
      (refKind === "secret" && scheme.targetSecretId === id) ||
      (refKind === "ambition" && scheme.targetAmbitionId === id) ||
      (refKind === "feud" && scheme.targetFeudId === id) ||
      (refKind === "prophecy" && scheme.targetProphecyId === id) ||
      (refKind === "civilization-goal" && scheme.targetCivilizationGoalId === id) ||
      (refKind === "event" && (scheme.sourceEventId === id || scheme.resolvedEventId === id || (scheme.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(scheme => schemeLink(scheme.id));
}
function feudsAbout(refKind, id, limit) {
  return data.feuds
    .filter(feud => (feud.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id))
    .slice(0, limit || 80)
    .map(feud => feudLink(feud.id));
}
function oathsAbout(refKind, id, limit) {
  return data.oaths
    .filter(oath =>
      (oath.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "prophecy" && oath.targetProphecyId === id) ||
      (refKind === "civilization-goal" && oath.targetCivilizationGoalId === id) ||
      (refKind === "belief" && oath.targetBeliefId === id) ||
      (refKind === "secret" && oath.targetSecretId === id) ||
      (refKind === "feud" && oath.targetFeudId === id) ||
      (refKind === "artifact" && oath.targetArtifactId === id) ||
      (refKind === "settlement" && oath.targetSettlementId === id) ||
      (refKind === "person" && (oath.swearerAgentId === id || oath.targetAgentId === id || (oath.witnessAgentIds || []).includes(id))) ||
      (refKind === "event" && (oath.sourceEventId === id || oath.resolvedEventId === id))
    )
    .slice(0, limit || 80)
    .map(oath => oathLink(oath.id));
}
function ceremoniesAbout(refKind, id, limit) {
  return data.ceremonies
    .filter(ceremony =>
      (ceremony.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (ceremony.hostAgentId === id || (ceremony.participantAgentIds || []).includes(id))) ||
      (refKind === "settlement" && ceremony.settlementId === id) ||
      (refKind === "structure" && ceremony.structureId === id) ||
      (refKind === "organization" && ceremony.organizationId === id) ||
      (refKind === "belief" && ceremony.beliefId === id) ||
      (refKind === "office" && ceremony.officeId === id) ||
      (refKind === "artifact" && (ceremony.artifactIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(ceremony => ceremonyLink(ceremony.id));
}
function ceremonyParticipationsAbout(refKind, id, limit) {
  return data.ceremonyParticipations
    .filter(participation =>
      (participation.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && participation.agentId === id) ||
      (refKind === "ceremony" && participation.ceremonyId === id) ||
      (refKind === "settlement" && participation.settlementId === id) ||
      (refKind === "civilization" && participation.civilizationId === id) ||
      (refKind === "structure" && participation.structureId === id) ||
      (refKind === "organization" && participation.organizationId === id) ||
      (refKind === "belief" && participation.beliefId === id) ||
      (refKind === "office" && participation.officeId === id) ||
      (refKind === "artifact" && (participation.artifactIds || []).includes(id)) ||
      (refKind === "event" && (participation.ceremonyEventId === id || (participation.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(participation => ceremonyParticipationLink(participation.id));
}
function activitiesAbout(refKind, id, limit) {
  return data.activities
    .filter(activity =>
      (activity.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && ((activity.participantAgentIds || []).includes(id) || activity.primaryAgentId === id)) ||
      (refKind === "settlement" && activity.settlementId === id) ||
      (refKind === "civilization" && activity.civilizationId === id) ||
      (refKind === "structure" && activity.structureId === id) ||
      (refKind === "household" && activity.householdId === id) ||
      (refKind === "organization" && activity.organizationId === id) ||
      (refKind === "belief" && activity.beliefId === id) ||
      (refKind === "event" && (activity.eventIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(activity => activityLink(activity.id));
}
function teachingsAbout(refKind, id, limit) {
  return data.teachings
    .filter(teaching =>
      (teaching.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (teaching.mentorAgentId === id || teaching.studentAgentId === id)) ||
      (refKind === "settlement" && teaching.settlementId === id) ||
      (refKind === "civilization" && teaching.civilizationId === id) ||
      (refKind === "structure" && teaching.structureId === id) ||
      (refKind === "organization" && teaching.organizationId === id) ||
      (refKind === "belief" && teaching.beliefId === id) ||
      (refKind === "tradition" && teaching.traditionId === id) ||
      (refKind === "written-work" && teaching.writtenWorkId === id) ||
      (refKind === "skill" && teaching.skillId === id) ||
      (refKind === "activity" && teaching.activityId === id) ||
      (refKind === "apprenticeship" && teaching.apprenticeshipId === id) ||
      (refKind === "event" && (teaching.sourceEventId === id || (teaching.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.quality - a.quality || b.id - a.id)
    .slice(0, limit || 80)
    .map(teaching => teachingLink(teaching.id));
}
function projectsAbout(refKind, id, limit) {
  return data.projects
    .filter(project =>
      (project.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (project.leadAgentId === id || (project.workerAgentIds || []).includes(id))) ||
      (refKind === "settlement" && project.settlementId === id) ||
      (refKind === "structure" && project.structureId === id) ||
      (refKind === "organization" && project.organizationId === id) ||
      (refKind === "belief" && project.beliefId === id) ||
      (refKind === "office" && project.officeId === id) ||
      (refKind === "artifact" && project.artifactId === id) ||
      (refKind === "injury" && project.injuryId === id) ||
      (refKind === "case" && project.caseId === id)
    )
    .slice(0, limit || 80)
    .map(project => projectLink(project.id));
}
function projectParticipationsAbout(refKind, id, limit) {
  return data.projectParticipations
    .filter(participation =>
      (participation.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && participation.agentId === id) ||
      (refKind === "project" && participation.projectId === id) ||
      (refKind === "settlement" && participation.settlementId === id) ||
      (refKind === "civilization" && participation.civilizationId === id) ||
      (refKind === "structure" && participation.structureId === id) ||
      (refKind === "organization" && participation.organizationId === id) ||
      (refKind === "belief" && participation.beliefId === id) ||
      (refKind === "office" && participation.officeId === id) ||
      (refKind === "artifact" && participation.artifactId === id) ||
      (refKind === "injury" && participation.injuryId === id) ||
      (refKind === "case" && participation.caseId === id) ||
      (refKind === "event" && (participation.projectEventId === id || (participation.eventIds || []).includes(id)))
    )
    .slice(0, limit || 80)
    .map(participation => projectParticipationLink(participation.id));
}
function obligationsAbout(refKind, id, limit) {
  return data.obligations
    .filter(obligation =>
      (obligation.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (obligation.creditorAgentId === id || obligation.debtorAgentId === id || (obligation.witnessAgentIds || []).includes(id))) ||
      (refKind === "settlement" && obligation.settlementId === id) ||
      (refKind === "artifact" && obligation.artifactId === id) ||
      (refKind === "case" && obligation.caseId === id) ||
      (refKind === "relationship" && obligation.relationshipId === id) ||
      (refKind === "project" && obligation.projectId === id) ||
      (refKind === "oath" && obligation.oathId === id) ||
      (refKind === "event" && (obligation.sourceEventId === id || obligation.resolvedEventId === id))
    )
    .slice(0, limit || 80)
    .map(obligation => obligationLink(obligation.id));
}
function holdingsAbout(refKind, id, limit) {
  return data.holdings
    .filter(holding =>
      (holding.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && holding.ownerAgentId === id) ||
      (refKind === "settlement" && holding.settlementId === id) ||
      (refKind === "household" && holding.householdId === id) ||
      (refKind === "structure" && holding.structureId === id) ||
      (refKind === "organization" && holding.organizationId === id) ||
      (refKind === "office" && holding.officeId === id) ||
      (refKind === "event" && (holding.sourceEventId === id || holding.transferredEventId === id))
    )
    .slice(0, limit || 80)
    .map(holding => holdingLink(holding.id));
}
function belongingsAbout(refKind, id, limit) {
  return data.belongings
    .filter(belonging =>
      (belonging.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (belonging.ownerAgentId === id || belonging.previousOwnerAgentId === id)) ||
      (refKind === "settlement" && belonging.settlementId === id) ||
      (refKind === "household" && belonging.householdId === id) ||
      (refKind === "holding" && belonging.holdingId === id) ||
      (refKind === "structure" && belonging.structureId === id) ||
      (refKind === "organization" && (belonging.subjectRefs || []).some(ref => ref.kind === "organization" && ref.id === id)) ||
      (refKind === "belief" && (belonging.subjectRefs || []).some(ref => ref.kind === "belief" && ref.id === id)) ||
      (refKind === "office" && (belonging.subjectRefs || []).some(ref => ref.kind === "office" && ref.id === id)) ||
      (refKind === "project" && (belonging.subjectRefs || []).some(ref => ref.kind === "project" && ref.id === id)) ||
      (refKind === "event" && (belonging.sourceEventId === id || belonging.transferredEventId === id))
    )
    .slice(0, limit || 80)
    .map(belonging => belongingLink(belonging.id));
}
function possessionAttachmentsAbout(refKind, id, limit) {
  return data.possessionAttachments
    .filter(attachment =>
      (attachment.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && attachment.agentId === id) ||
      (refKind === "settlement" && attachment.settlementId === id) ||
      (refKind === "civilization" && attachment.civilizationId === id) ||
      (refKind === "household" && attachment.householdId === id) ||
      (refKind === "lineage" && attachment.lineageId === id) ||
      (refKind === "artifact" && attachment.artifactId === id) ||
      (refKind === "belonging" && attachment.belongingId === id) ||
      (refKind === "memory" && (attachment.memoryIds || []).includes(id)) ||
      (refKind === "event" && (attachment.sourceEventId === id || (attachment.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.intensity - a.intensity || a.id - b.id)
    .slice(0, limit || 80)
    .map(attachment => possessionAttachmentLink(attachment.id));
}
function godsAbout(refKind, id, limit) {
  return data.gods
    .filter(god =>
      (god.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "belief" && god.beliefId === id) ||
      (refKind === "settlement" && god.originSettlementId === id) ||
      (refKind === "myth" && (god.mythIds || []).includes(id)) ||
      (refKind === "doctrine" && (god.doctrineIds || []).includes(id)) ||
      (refKind === "magic-role" && (god.magicRoleIds || []).includes(id)) ||
      (refKind === "prophecy" && (god.prophecyIds || []).includes(id)) ||
      (refKind === "civilization-goal" && (god.civilizationGoalIds || []).includes(id)) ||
      (refKind === "sacred-site" && (god.sacredSiteIds || []).includes(id)) ||
      (refKind === "commandment" && (god.commandmentIds || []).includes(id)) ||
      (refKind === "destiny" && (god.destinyIds || []).includes(id)) ||
      (refKind === "miracle" && (god.miracleIds || []).includes(id)) ||
      (refKind === "event" && (god.eventIds || []).includes(id)) ||
      (refKind === "civilization" && god.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(god => godLink(god.id));
}
function commandmentsAbout(refKind, id, limit) {
  return data.commandments
    .filter(commandment =>
      (commandment.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "belief" && commandment.beliefId === id) ||
      (refKind === "god" && commandment.godId === id) ||
      (refKind === "doctrine" && commandment.doctrineId === id) ||
      (refKind === "civilization-goal" && (commandment.civilizationGoalIds || []).includes(id)) ||
      (refKind === "settlement" && commandment.settlementId === id) ||
      (refKind === "event" && (commandment.eventIds || []).includes(id)) ||
      (refKind === "civilization" && commandment.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(commandment => commandmentLink(commandment.id));
}
function destiniesAbout(refKind, id, limit) {
  return data.destinies
    .filter(destiny =>
      (destiny.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "belief" && destiny.beliefId === id) ||
      (refKind === "god" && destiny.godId === id) ||
      (refKind === "prophecy" && destiny.prophecyId === id) ||
      (refKind === "civilization-goal" && destiny.civilizationGoalId === id) ||
      (refKind === "person" && destiny.targetAgentId === id) ||
      (refKind === "settlement" && (destiny.settlementId === id || destiny.targetSettlementId === id)) ||
      (refKind === "artifact" && destiny.targetArtifactId === id) ||
      (refKind === "event" && (destiny.sourceEventId === id || destiny.resolvedEventId === id || (destiny.eventIds || []).includes(id))) ||
      (refKind === "civilization" && destiny.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(destiny => destinyLink(destiny.id));
}
function miraclesAbout(refKind, id, limit) {
  return data.miracles
    .filter(miracle =>
      (miracle.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "belief" && miracle.beliefId === id) ||
      (refKind === "god" && miracle.godId === id) ||
      (refKind === "prophecy" && miracle.prophecyId === id) ||
      (refKind === "civilization-goal" && miracle.civilizationGoalId === id) ||
      (refKind === "sacred-site" && miracle.sacredSiteId === id) ||
      (refKind === "person" && miracle.targetAgentId === id) ||
      (refKind === "settlement" && miracle.settlementId === id) ||
      (refKind === "event" && (miracle.eventIds || []).includes(id)) ||
      (refKind === "civilization" && miracle.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(miracle => miracleLink(miracle.id));
}
function mythsAbout(refKind, id, limit) {
  return data.myths
    .filter(myth =>
      (myth.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "belief" && myth.beliefId === id) ||
      (refKind === "god" && myth.godId === id) ||
      (refKind === "person" && myth.centralAgentId === id) ||
      (refKind === "settlement" && myth.originSettlementId === id) ||
      (refKind === "civilization" && myth.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(myth => mythLink(myth.id));
}
function doctrinesAbout(refKind, id, limit) {
  return data.doctrines
    .filter(doctrine =>
      (doctrine.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "belief" && doctrine.beliefId === id) ||
      (refKind === "myth" && doctrine.mythId === id) ||
      (refKind === "god" && doctrine.godId === id) ||
      (refKind === "commandment" && doctrine.commandmentId === id) ||
      (refKind === "settlement" && doctrine.originSettlementId === id) ||
      (refKind === "event" && (doctrine.eventIds || []).includes(id)) ||
      (refKind === "civilization" && doctrine.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(doctrine => doctrineLink(doctrine.id));
}
function magicRolesAbout(refKind, id, limit) {
  return data.magicRoles
    .filter(role =>
      (role.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && role.agentId === id) ||
      (refKind === "belief" && role.beliefId === id) ||
      (refKind === "myth" && role.mythId === id) ||
      (refKind === "god" && role.godId === id) ||
      (refKind === "organization" && role.organizationId === id) ||
      (refKind === "settlement" && role.settlementId === id) ||
      (refKind === "civilization" && role.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(role => magicRoleLink(role.id));
}
function propheciesAbout(refKind, id, limit) {
  return data.prophecies
    .filter(prophecy =>
      (prophecy.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (prophecy.speakerAgentId === id || prophecy.targetAgentId === id)) ||
      (refKind === "belief" && prophecy.beliefId === id) ||
      (refKind === "myth" && prophecy.mythId === id) ||
      (refKind === "god" && prophecy.godId === id) ||
      (refKind === "destiny" && prophecy.destinyId === id) ||
      (refKind === "magic-role" && prophecy.magicRoleId === id) ||
      (refKind === "settlement" && (prophecy.settlementId === id || prophecy.targetSettlementId === id)) ||
      (refKind === "artifact" && prophecy.targetArtifactId === id) ||
      (refKind === "ambition" && prophecy.ambitionId === id) ||
      (refKind === "event" && (prophecy.sourceEventId === id || prophecy.resolvedEventId === id)) ||
      (refKind === "civilization" && prophecy.civilizationId === id)
    )
    .slice(0, limit || 80)
    .map(prophecy => prophecyLink(prophecy.id));
}
function civilizationGoalsAbout(refKind, id, limit) {
  return data.civilizationGoals
    .filter(goal =>
      (goal.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "civilization" && (goal.civilizationId === id || goal.targetCivilizationId === id)) ||
      (refKind === "settlement" && (goal.settlementId === id || goal.targetSettlementId === id)) ||
      (refKind === "belief" && goal.beliefId === id) ||
      (refKind === "myth" && goal.mythId === id) ||
      (refKind === "doctrine" && goal.doctrineId === id) ||
      (refKind === "magic-role" && goal.magicRoleId === id) ||
      (refKind === "prophecy" && goal.prophecyId === id) ||
      (refKind === "god" && goal.godId === id) ||
      (refKind === "commandment" && goal.commandmentId === id) ||
      (refKind === "destiny" && goal.destinyId === id) ||
      (refKind === "artifact" && goal.targetArtifactId === id) ||
      (refKind === "event" && (goal.sourceEventId === id || goal.resolvedEventId === id))
    )
    .slice(0, limit || 80)
    .map(goal => civilizationGoalLink(goal.id));
}
function sacredSitesAbout(refKind, id, limit) {
  return data.sacredSites
    .filter(site =>
      (site.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "civilization" && site.civilizationId === id) ||
      (refKind === "settlement" && site.settlementId === id) ||
      (refKind === "natural-feature" && (site.subjectRefs || []).some(ref => ref.kind === "natural-feature" && ref.id === id)) ||
      (refKind === "person" && site.founderAgentId === id) ||
      (refKind === "belief" && site.beliefId === id) ||
      (refKind === "myth" && site.mythId === id) ||
      (refKind === "doctrine" && site.doctrineId === id) ||
      (refKind === "magic-role" && site.magicRoleId === id) ||
      (refKind === "prophecy" && site.prophecyId === id) ||
      (refKind === "civilization-goal" && site.civilizationGoalId === id) ||
      (refKind === "god" && site.godId === id) ||
      (refKind === "event" && (site.eventIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(site => sacredSiteLink(site.id));
}
function naturalFeaturesAbout(refKind, id, limit) {
  return data.naturalFeatures
    .filter(feature =>
      (feature.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "settlement" && (feature.settlementIds || []).includes(id)) ||
      (refKind === "sacred-site" && (feature.sacredSiteIds || []).includes(id)) ||
      (refKind === "journey" && (feature.journeyIds || []).includes(id)) ||
      (refKind === "event" && (feature.eventIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(feature => naturalFeatureLink(feature.id));
}
function roadsAbout(refKind, id, limit) {
  return data.roads
    .filter(road => {
      if (refKind === "settlement") return road.fromSettlementId === id || road.toSettlementId === id;
      if (refKind === "civilization") return road.civilizationId === id;
      if (refKind === "journey") return (road.journeyIds || []).includes(id);
      if (refKind === "event") return (road.eventIds || []).includes(id);
      if (refKind === "natural-feature") {
        const feature = maps["natural-features"].get(id);
        const nearby = new Set(feature?.settlementIds || []);
        return nearby.has(road.fromSettlementId) || nearby.has(road.toSettlementId);
      }
      return false;
    })
    .slice(0, limit || 80)
    .map(road => roadLink(road.id));
}
function journeysAbout(refKind, id, limit) {
  return data.journeys
    .filter(journey =>
      (refKind === "person" && (journey.participantAgentIds || []).includes(id)) ||
      (refKind === "settlement" && (journey.fromSettlementId === id || journey.toSettlementId === id)) ||
      (refKind === "civilization" && journey.civilizationId === id) ||
      (refKind === "natural-feature" && data.naturalFeatures.some(feature => feature.id === id && (feature.journeyIds || []).includes(journey.id))) ||
      (refKind === "structure" && (journey.originStructureId === id || journey.destinationStructureId === id)) ||
      (refKind === "organization" && journey.organizationId === id) ||
      (refKind === "belief" && journey.beliefId === id) ||
      (refKind === "sacred-site" && journey.sacredSiteId === id) ||
      (refKind === "artifact" && (journey.artifactIds || []).includes(id)) ||
      (refKind === "road" && (journey.roadIds || []).includes(id)) ||
      (refKind === "event" && (journey.eventIds || []).includes(id))
    )
    .slice(0, limit || 80)
    .map(journey => journeyLink(journey.id));
}
function burialsAbout(refKind, id, limit) {
  return data.burials
    .filter(burial =>
      (burial.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (burial.personId === id || (burial.mournerAgentIds || []).includes(id))) ||
      (refKind === "settlement" && burial.settlementId === id) ||
      (refKind === "civilization" && burial.civilizationId === id) ||
      (refKind === "structure" && burial.structureId === id) ||
      (refKind === "household" && burial.householdId === id) ||
      (refKind === "lineage" && burial.lineageId === id) ||
      (refKind === "belief" && burial.beliefId === id) ||
      (refKind === "battle" && burial.battleId === id) ||
      (refKind === "memorial" && burial.memorialId === id) ||
      (refKind === "artifact" && (burial.graveGoodArtifactIds || []).includes(id)) ||
      (refKind === "belonging" && (burial.graveGoodBelongingIds || []).includes(id)) ||
      (refKind === "event" && (burial.deathEventId === id || (burial.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 80)
    .map(burial => burialLink(burial.id));
}
function birthsAbout(refKind, id, limit) {
  return data.births
    .filter(birth =>
      (birth.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && (birth.personId === id || (birth.parentAgentIds || []).includes(id))) ||
      (refKind === "settlement" && birth.settlementId === id) ||
      (refKind === "civilization" && birth.civilizationId === id) ||
      (refKind === "structure" && birth.structureId === id) ||
      (refKind === "household" && birth.householdId === id) ||
      (refKind === "lineage" && birth.lineageId === id) ||
      (refKind === "belief" && birth.beliefId === id) ||
      (refKind === "union" && birth.unionId === id) ||
      (refKind === "event" && (birth.birthEventId === id || (birth.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 80)
    .map(birth => birthLink(birth.id));
}
function deathRecordsAbout(refKind, id, limit) {
  return data.deathRecords
    .filter(record =>
      (record.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && record.personId === id) ||
      (refKind === "settlement" && record.settlementId === id) ||
      (refKind === "civilization" && record.civilizationId === id) ||
      (refKind === "household" && record.householdId === id) ||
      (refKind === "lineage" && record.lineageId === id) ||
      (refKind === "belief" && record.beliefId === id) ||
      (refKind === "battle" && record.battleId === id) ||
      (refKind === "battle-participation" && record.battleParticipationId === id) ||
      (refKind === "injury" && (record.injuryIds || []).includes(id)) ||
      (refKind === "illness" && (record.illnessIds || []).includes(id)) ||
      (refKind === "memorial" && record.memorialId === id) ||
      (refKind === "burial" && record.burialId === id) ||
      (refKind === "estate" && record.estateId === id) ||
      (refKind === "event" && (record.sourceEventId === id || (record.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 80)
    .map(record => deathRecordLink(record.id));
}
function ageMilestonesAbout(refKind, id, limit) {
  return data.ageMilestones
    .filter(milestone =>
      (milestone.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && milestone.personId === id) ||
      (refKind === "settlement" && milestone.settlementId === id) ||
      (refKind === "civilization" && milestone.civilizationId === id) ||
      (refKind === "structure" && milestone.structureId === id) ||
      (refKind === "household" && milestone.householdId === id) ||
      (refKind === "lineage" && milestone.lineageId === id) ||
      (refKind === "career" && milestone.careerId === id) ||
      (refKind === "event" && (milestone.sourceEventId === id || (milestone.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.id - a.id)
    .slice(0, limit || 80)
    .map(milestone => ageMilestoneLink(milestone.id));
}
function appearanceFeaturesAbout(refKind, id, limit) {
  return data.appearanceFeatures
    .filter(feature =>
      (feature.subjectRefs || []).some(ref => ref.kind === refKind && ref.id === id) ||
      (refKind === "person" && feature.personId === id) ||
      (refKind === "settlement" && feature.settlementId === id) ||
      (refKind === "civilization" && feature.civilizationId === id) ||
      (refKind === "household" && feature.householdId === id) ||
      (refKind === "lineage" && feature.lineageId === id) ||
      (refKind === "birth" && feature.birthId === id) ||
      (refKind === "age-milestone" && feature.ageMilestoneId === id) ||
      (refKind === "wound-legacy" && feature.woundLegacyId === id) ||
      (refKind === "event" && (feature.sourceEventId === id || (feature.eventIds || []).includes(id)))
    )
    .sort((a, b) => b.year - a.year || b.visibility - a.visibility || b.id - a.id)
    .slice(0, limit || 80)
    .map(feature => appearanceFeatureLink(feature.id));
}
function relationsSection(kind, item) {
  const groups = [];
  if (kind === "people") {
    groups.push(relationGroup("Allegiance History", (item.personAllegianceIds || []).slice(0, 80).map(personAllegianceLink)));
    groups.push(relationGroup("Preferences", (item.preferenceIds || []).slice(0, 120).map(preferenceLink)));
    groups.push(relationGroup("Traditions", (item.traditionIds || []).slice(0, 120).map(traditionLink)));
    groups.push(relationGroup("Traditions About", traditionsAbout("person", item.id, 60)));
    groups.push(relationGroup("Epithets", epithetsAbout("person", item.id, 80)));
    groups.push(relationGroup("Reputation Milestones", reputationMilestonesAbout("person", item.id, 100)));
    if (item.spouseId != null) groups.push(relationGroup("Spouse", [personLink(item.spouseId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.birthId != null) groups.push(relationGroup("Birth Record", [birthLink(item.birthId)]));
    if (item.deathRecordId != null) groups.push(relationGroup("Death Record", [deathRecordLink(item.deathRecordId)]));
    groups.push(relationGroup("Age Milestones", (item.ageMilestoneIds || []).slice(0, 80).map(ageMilestoneLink)));
    groups.push(relationGroup("Appearance", (item.appearanceFeatureIds || []).slice(0, 80).map(appearanceFeatureLink)));
    groups.push(relationGroup("Births as Parent", data.births.filter(birth => birth.personId !== item.id && (birth.parentAgentIds || []).includes(item.id)).slice(0, 80).map(birth => birthLink(birth.id))));
    groups.push(relationGroup("Parents", (item.parentIds || []).map(personLink)));
    groups.push(relationGroup("Siblings", sortedPeopleLinks(siblingIds(item), 40)));
    groups.push(relationGroup("Children", (item.childIds || []).slice(0, 24).map(personLink)));
    groups.push(relationGroup("Ancestors", sortedPeopleLinks(ancestorIds(item, 80), 80)));
    groups.push(relationGroup("Descendants", sortedPeopleLinks(descendantIds(item, 120), 120)));
    groups.push(relationGroup("Household Kin", sortedPeopleLinks(householdKinIds(item), 80)));
    groups.push(relationGroup("Lineage Kin", sortedPeopleLinks(lineageKinIds(item), 120)));
    if (item.lineageId != null) groups.push(relationGroup("Lineage", [lineageLink(item.lineageId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    groups.push(relationGroup("Belief Adherence History", (item.beliefAdherenceIds || []).slice(0, 80).map(beliefAdherenceLink)));
    groups.push(relationGroup("Magic Roles", (item.magicRoleIds || []).slice(0, 40).map(magicRoleLink)));
    groups.push(relationGroup("Sacred Sites Founded", sacredSitesAbout("person", item.id, 20)));
    groups.push(relationGroup("Divine Links", [
      ...destiniesAbout("person", item.id, 20),
      ...miraclesAbout("person", item.id, 20)
    ]));
    groups.push(relationGroup("Myths About", mythsAbout("person", item.id, 40)));
    groups.push(relationGroup("Prophecies", propheciesAbout("person", item.id, 60)));
    groups.push(relationGroup("Offices", (item.officeIds || []).map(officeLink)));
    groups.push(relationGroup("Office Terms", (item.officeTermIds || []).slice(0, 80).map(officeTermLink)));
    groups.push(relationGroup("Cases", (item.caseIds || []).slice(0, 40).map(caseLink)));
    groups.push(relationGroup("Testimonies", testimoniesAbout("person", item.id, 80)));
    groups.push(relationGroup("Battles", (item.battleIds || []).slice(0, 40).map(battleLink)));
    groups.push(relationGroup("Battle Roles", (item.battleParticipationIds || []).slice(0, 80).map(battleParticipationLink)));
    groups.push(relationGroup("Conflicts", conflictsAbout("person", item.id, 40)));
    groups.push(relationGroup("Military Units", data.militaryUnits.filter(unit => unit.commanderAgentId === item.id || (unit.troopAgentIds || []).includes(item.id)).slice(0, 60).map(unit => militaryUnitLink(unit.id))));
    groups.push(relationGroup("Spy Networks", data.spyNetworks.filter(network => network.handlerAgentId === item.id || (network.agentIds || []).includes(item.id)).slice(0, 40).map(network => spyNetworkLink(network.id))));
    groups.push(relationGroup("Spy Operations", data.spyOperations.filter(operation => (operation.agentIds || []).includes(item.id)).slice(0, 60).map(operation => spyOperationLink(operation.id))));
    groups.push(relationGroup("Injuries", (item.injuryIds || []).slice(0, 40).map(injuryLink)));
    groups.push(relationGroup("Illnesses", (item.illnessIds || []).slice(0, 40).map(illnessLink)));
    groups.push(relationGroup("Care Records", careRecordsAbout("person", item.id, 80)));
    groups.push(relationGroup("Wound Legacies", (item.woundLegacyIds || []).slice(0, 80).map(woundLegacyLink)));
    groups.push(relationGroup("Illnesses Treated", data.illnesses.filter(illness => illness.healerAgentId === item.id).slice(0, 40).map(illness => illnessLink(illness.id))));
    groups.push(relationGroup("Memorials", (item.memorialIds || []).slice(0, 40).map(memorialLink)));
    groups.push(relationGroup("Burials", (item.burialIds || []).slice(0, 40).map(burialLink)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("person", item.id, 40)));
    groups.push(relationGroup("Burials Attended", data.burials.filter(burial => burial.personId !== item.id && (burial.mournerAgentIds || []).includes(item.id)).slice(0, 40).map(burial => burialLink(burial.id))));
    groups.push(relationGroup("Death Events", eventLinksByTypes(item, ["person-died", "battle-casualty"], 20)));
    groups.push(relationGroup("Estates", data.estates.filter(estate => estate.decedentAgentId === item.id || (estate.heirAgentIds || []).includes(item.id)).slice(0, 60).map(estate => estateLink(estate.id))));
    groups.push(relationGroup("Fatal Injuries", (item.injuryIds || []).map(id => maps.injuries.get(id)).filter(injury => injury && injury.status === "fatal").slice(0, 20).map(injury => injuryLink(injury.id))));
    groups.push(relationGroup("Fatal Illnesses", (item.illnessIds || []).map(id => maps.illnesses.get(id)).filter(illness => illness && illness.status === "fatal").slice(0, 20).map(illness => illnessLink(illness.id))));
    groups.push(relationGroup("Ambitions", (item.ambitionIds || []).slice(0, 40).map(ambitionLink)));
    groups.push(relationGroup("Apprenticeships", (item.apprenticeshipIds || []).slice(0, 40).map(apprenticeshipLink)));
    groups.push(relationGroup("Skills", (item.skillRecordIds || []).slice(0, 80).map(skillLink)));
    groups.push(relationGroup("Teachings Given", data.teachings.filter(teaching => teaching.mentorAgentId === item.id).slice(0, 80).map(teaching => teachingLink(teaching.id))));
    groups.push(relationGroup("Teachings Received", data.teachings.filter(teaching => teaching.studentAgentId === item.id).slice(0, 80).map(teaching => teachingLink(teaching.id))));
    groups.push(relationGroup("Residence History", (item.residenceIds || []).slice(0, 80).map(residenceLink)));
    groups.push(relationGroup("Career History", (item.careerIds || []).slice(0, 80).map(careerLink)));
    groups.push(relationGroup("Journeys", (item.journeyIds || []).slice(0, 40).map(journeyLink)));
    groups.push(relationGroup("Structures", (item.structureIds || []).slice(0, 40).map(structureLink)));
    groups.push(relationGroup("Organizations", (item.organizationIds || []).map(organizationLink)));
    groups.push(relationGroup("Membership History", (item.membershipIds || []).slice(0, 80).map(membershipLink)));
    groups.push(relationGroup("Organization Ranks", organizationRanksAbout("person", item.id, 100)));
    groups.push(relationGroup("Relationships", (item.socialBondIds || []).slice(0, 40).map(relationshipLink)));
    groups.push(relationGroup("Relationship Milestones", relationshipMilestonesAbout("person", item.id, 100)));
    const personRelationships = (item.socialBondIds || []).map(id => maps.relationships.get(id)).filter(Boolean);
    groups.push(relationGroup("Close Relationships", personRelationships
      .filter(relationship => relationship.active && relationshipStatusLabel(relationship) === "close")
      .slice(0, 20)
      .map(relationship => relationshipLink(relationship.id))));
    groups.push(relationGroup("Strained Relationships", personRelationships
      .filter(relationship => relationshipStatusLabel(relationship) === "volatile" || relationshipStatusLabel(relationship) === "strained")
      .slice(0, 20)
      .map(relationship => relationshipLink(relationship.id))));
    groups.push(relationGroup("Unions", (item.unionIds || []).slice(0, 40).map(unionLink)));
    groups.push(relationGroup("Unions About", unionsAbout("person", item.id, 40)));
    groups.push(relationGroup("Conversations", conversationsAbout("person", item.id, 120)));
    const created = data.artifacts.filter(artifact => artifact.creatorAgentId === item.id).slice(0, 12).map(artifact => artifactLink(artifact.id));
    const held = data.artifacts.filter(artifact => artifact.ownerAgentId === item.id).slice(0, 12).map(artifact => artifactLink(artifact.id));
    groups.push(relationGroup("Created Artifacts", created));
    groups.push(relationGroup("Held Artifacts", held));
    groups.push(relationGroup("Artifacts Passed On", personArtifactLinks(item, artifact => (artifact.provenance || []).some(entry => entry.previousOwnerAgentId === item.id), 40)));
    groups.push(relationGroup("Artifact Condition Records", artifactConditionsAbout("person", item.id, 60)));
    groups.push(relationGroup("Authored Chronicles", data.chronicles.filter(chronicle => chronicle.authorAgentId === item.id).slice(0, 40).map(chronicle => chronicleLink(chronicle.id))));
    groups.push(relationGroup("Chronicles About", chroniclesAbout("person", item.id, 40)));
    groups.push(relationGroup("Authored Written Works", (item.writtenWorkIds || []).slice(0, 60).map(writtenWorkLink)));
    groups.push(relationGroup("Written Works About", writtenWorksAbout("person", item.id, 60)));
    groups.push(relationGroup("Memories", (item.memoryIds || []).slice(0, 80).map(memoryLink)));
    groups.push(relationGroup("Memories About", memoriesAbout("person", item.id, 40)));
    groups.push(relationGroup("Thoughts", (item.thoughtIds || []).slice(0, 80).map(thoughtLink)));
    groups.push(relationGroup("Thoughts About", thoughtsAbout("person", item.id, 40)));
    groups.push(relationGroup("Personality Shifts", (item.personalityShiftIds || []).slice(0, 40).map(personalityShiftLink)));
    groups.push(relationGroup("Personality Shifts About", personalityShiftsAbout("person", item.id, 40)));
    groups.push(relationGroup("Need Episodes", (item.needEpisodeIds || []).slice(0, 60).map(needEpisodeLink)));
    groups.push(relationGroup("Need Episodes About", needEpisodesAbout("person", item.id, 40)));
    groups.push(relationGroup("Opinions Held", (item.opinionIds || []).slice(0, 80).map(opinionLink)));
    groups.push(relationGroup("Opinions About", data.opinions.filter(opinion => opinion.targetRef && opinion.targetRef.kind === "person" && opinion.targetRef.id === item.id).slice(0, 60).map(opinion => opinionLink(opinion.id))));
    groups.push(relationGroup("Claims Held", (item.socialClaimIds || []).slice(0, 80).map(socialClaimLink)));
    groups.push(relationGroup("Claims About", data.socialClaims.filter(claim => claim.targetAgentId === item.id).slice(0, 80).map(claim => socialClaimLink(claim.id))));
    groups.push(relationGroup("Rumors", (item.rumorIds || []).slice(0, 60).map(rumorLink)));
    groups.push(relationGroup("Rumors About", rumorsAbout("person", item.id, 40)));
    groups.push(relationGroup("Secrets", (item.secretIds || []).slice(0, 60).map(secretLink)));
    groups.push(relationGroup("Secrets About", secretsAbout("person", item.id, 40)));
    groups.push(relationGroup("Schemes", (item.schemeIds || []).slice(0, 60).map(schemeLink)));
    groups.push(relationGroup("Schemes About", schemesAbout("person", item.id, 40)));
    groups.push(relationGroup("Feuds", (item.feudIds || []).slice(0, 60).map(feudLink)));
    groups.push(relationGroup("Feuds About", feudsAbout("person", item.id, 40)));
    groups.push(relationGroup("Oaths", (item.oathIds || []).slice(0, 60).map(oathLink)));
    groups.push(relationGroup("Oaths About", oathsAbout("person", item.id, 40)));
    groups.push(relationGroup("Ceremonies", (item.ceremonyIds || []).slice(0, 80).map(ceremonyLink)));
    groups.push(relationGroup("Ceremony Roles", (item.ceremonyParticipationIds || []).slice(0, 100).map(ceremonyParticipationLink)));
    groups.push(relationGroup("Activities", (item.activityIds || []).slice(0, 120).map(activityLink)));
    groups.push(relationGroup("Ceremonies About", ceremoniesAbout("person", item.id, 40)));
    groups.push(relationGroup("Projects", (item.projectIds || []).slice(0, 80).map(projectLink)));
    groups.push(relationGroup("Project Roles", (item.projectParticipationIds || []).slice(0, 100).map(projectParticipationLink)));
    groups.push(relationGroup("Projects About", projectsAbout("person", item.id, 40)));
    groups.push(relationGroup("Obligations", (item.obligationIds || []).slice(0, 80).map(obligationLink)));
    groups.push(relationGroup("Obligations About", obligationsAbout("person", item.id, 40)));
    groups.push(relationGroup("Holdings", (item.holdingIds || []).slice(0, 80).map(holdingLink)));
    groups.push(relationGroup("Holdings About", holdingsAbout("person", item.id, 40)));
    groups.push(relationGroup("Belongings", (item.belongingIds || []).slice(0, 100).map(belongingLink)));
    groups.push(relationGroup("Belongings About", belongingsAbout("person", item.id, 40)));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("person", item.id, 80)));
    groups.push(relationGroup("Belongings Passed On", data.belongings.filter(belonging => belonging.previousOwnerAgentId === item.id).slice(0, 40).map(belonging => belongingLink(belonging.id))));
    groups.push(relationGroup("Estate Assets", data.estates.filter(estate => estate.decedentAgentId === item.id || (estate.heirAgentIds || []).includes(item.id)).slice(0, 40).map(estate => estateLink(estate.id))));
  } else if (kind === "births") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Parents", (item.parentAgentIds || []).map(personLink)));
    groups.push(relationGroup("Family", [
      item.unionId == null ? "" : unionLink(item.unionId),
      item.householdId == null ? "" : householdLink(item.householdId),
      item.lineageId == null ? "" : lineageLink(item.lineageId)
    ].filter(Boolean)));
    groups.push(relationGroup("Place and Belief", [
      settlementLink(item.settlementId),
      civLink(item.civilizationId),
      item.structureId == null ? "" : structureLink(item.structureId),
      item.beliefId == null ? "" : beliefLink(item.beliefId)
    ].filter(Boolean)));
    groups.push(relationGroup("Birth Event", [eventLink(item.birthEventId)]));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("birth", item.id, 40)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Records and Echoes", recordEchoLinks("birth", item.id, 40)));
  } else if (kind === "age-milestones") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Transition", [
      item.careerId == null ? "" : careerLink(item.careerId),
      eventLink(item.sourceEventId),
      '<span class="ref">' + esc(item.previousProfession + " to " + item.newProfession) + '</span>',
      '<span class="ref">' + esc("age " + item.age) + '</span>'
    ].filter(Boolean)));
    groups.push(relationGroup("Place", [
      settlementLink(item.settlementId),
      civLink(item.civilizationId),
      item.structureId == null ? "" : structureLink(item.structureId)
    ].filter(Boolean)));
    groups.push(relationGroup("House and Line", [
      item.householdId == null ? "" : householdLink(item.householdId),
      item.lineageId == null ? "" : lineageLink(item.lineageId)
    ].filter(Boolean)));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("age-milestone", item.id, 40)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Records and Echoes", recordEchoLinks("age-milestone", item.id, 40)));
  } else if (kind === "appearance-features") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Source", [
      eventLink(item.sourceEventId),
      item.birthId == null ? "" : birthLink(item.birthId),
      item.ageMilestoneId == null ? "" : ageMilestoneLink(item.ageMilestoneId),
      item.woundLegacyId == null ? "" : woundLegacyLink(item.woundLegacyId)
    ].filter(Boolean)));
    groups.push(relationGroup("House and Line", [
      item.householdId == null ? "" : householdLink(item.householdId),
      item.lineageId == null ? "" : lineageLink(item.lineageId)
    ].filter(Boolean)));
    groups.push(relationGroup("Traits", (item.traits || []).map(factPill)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Records and Echoes", recordEchoLinks("appearance-feature", item.id, 40)));
  } else if (kind === "person-allegiances") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    if (item.previousCivilizationId != null) groups.push(relationGroup("Previous Civilization", [civLink(item.previousCivilizationId)]));
    if (item.conflictId != null) groups.push(relationGroup("Conflict", [conflictLink(item.conflictId)]));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    if (item.startEventId != null) groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("person-allegiance", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("person-allegiance", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("person-allegiance", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("person-allegiance", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("person-allegiance", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("person-allegiance", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("person-allegiance", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("person-allegiance", item.id, 40)));
  } else if (kind === "preferences") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.recordedEventId != null) groups.push(relationGroup("Recorded Event", [eventLink(item.recordedEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Activities", activitiesAbout("preference", item.id, 80)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("preference", item.id, 40)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("preference", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("preference", item.id, 40)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("preference", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("preference", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("preference", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("preference", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("preference", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("preference", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("preference", item.id, 40)));
  } else if (kind === "traditions") {
    groups.push(relationGroup("Founder", item.founderAgentId == null ? [] : [personLink(item.founderAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    groups.push(relationGroup("Adherents", (item.adherentAgentIds || []).slice(0, 160).map(personLink)));
    groups.push(relationGroup("Activities", (item.activityIds || []).slice(0, 120).map(activityLink)));
    groups.push(relationGroup("Teachings", teachingsAbout("tradition", item.id, 80)));
    groups.push(relationGroup("Ceremonies", (item.ceremonyIds || []).slice(0, 100).map(ceremonyLink)));
    groups.push(relationGroup("Written Works", (item.writtenWorkIds || []).slice(0, 80).map(writtenWorkLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("tradition", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("tradition", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("tradition", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("tradition", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("tradition", item.id, 60)));
    groups.push(relationGroup("Secrets", secretsAbout("tradition", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("tradition", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("tradition", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("tradition", item.id, 40)));
  } else if (kind === "epithets") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId), civLink(item.civilizationId)]));
    groups.push(relationGroup("House and Line", [
      item.householdId == null ? "" : householdLink(item.householdId),
      item.lineageId == null ? "" : lineageLink(item.lineageId)
    ].filter(Boolean)));
    if (item.sourceEventId != null) groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Reputation Milestones", reputationMilestonesAbout("epithet", item.id, 20)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Life Echoes", recordEchoLinks("epithet", item.id, 16)));
  } else if (kind === "reputation-milestones") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId), civLink(item.civilizationId)]));
    groups.push(relationGroup("Reputation Change", [
      factPill(item.kind),
      factPill("from " + item.previousReputation),
      factPill("to " + item.reputation),
      factPill(years(item.year))
    ]));
    groups.push(relationGroup("Cause", [
      eventLink(item.sourceEventId),
      item.epithetId == null ? "" : epithetRecordLink(item.epithetId)
    ].filter(Boolean)));
    groups.push(relationGroup("House and Line", [
      item.householdId == null ? "" : householdLink(item.householdId),
      item.lineageId == null ? "" : lineageLink(item.lineageId)
    ].filter(Boolean)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Social Echoes", recordEchoLinks("reputation-milestone", item.id, 16)));
    groups.push(relationGroup("Recent Events", recentEventLinksFor(item, 8)));
  } else if (kind === "settlements") {
    groups.push(relationGroup("Control History", (item.controlIds || []).slice(0, 120).map(settlementControlLink)));
    groups.push(relationGroup("Natural Features", naturalFeaturesAbout("settlement", item.id, 40)));
    groups.push(relationGroup("Person Allegiances", personAllegiancesAbout("settlement", item.id, 160)));
    groups.push(relationGroup("Preferences", preferencesAbout("settlement", item.id, 160)));
    groups.push(relationGroup("Traditions", (item.traditionIds || []).slice(0, 120).map(traditionLink)));
    const localOrganizations = data.organizations.filter(organization => organization.settlementId === item.id).slice(0, 40).map(organization => organizationLink(organization.id));
    groups.push(relationGroup("Organizations", localOrganizations));
    groups.push(relationGroup("Memberships", membershipsAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Organization Ranks", organizationRanksAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Epithets", epithetsAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Reputation Milestones", reputationMilestonesAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Structures", (item.structureIds || []).slice(0, 80).map(structureLink)));
    const localHouseholds = data.households.filter(household => household.settlementId === item.id).slice(0, 80).map(household => householdLink(household.id));
    groups.push(relationGroup("Households", localHouseholds));
    const localLineages = data.lineages.filter(lineage => lineage.originSettlementId === item.id).slice(0, 80).map(lineage => lineageLink(lineage.id));
    groups.push(relationGroup("Lineages", localLineages));
    const localBeliefs = data.beliefs.filter(belief => belief.originSettlementId === item.id).slice(0, 20).map(belief => beliefLink(belief.id));
    groups.push(relationGroup("Founded Beliefs", localBeliefs));
    groups.push(relationGroup("Belief Adherences", beliefAdherencesAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Gods and Divine Acts", [
      ...godsAbout("settlement", item.id, 80),
      ...commandmentsAbout("settlement", item.id, 80),
      ...destiniesAbout("settlement", item.id, 80),
      ...miraclesAbout("settlement", item.id, 80)
    ]));
    groups.push(relationGroup("Myths", mythsAbout("settlement", item.id, 80)));
    groups.push(relationGroup("Doctrines", doctrinesAbout("settlement", item.id, 80)));
    groups.push(relationGroup("Magic Roles", magicRolesAbout("settlement", item.id, 80)));
    groups.push(relationGroup("Prophecies", propheciesAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Civilization Goals", civilizationGoalsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("settlement", item.id, 100)));
    const localOffices = data.offices.filter(office => office.settlementId === item.id).slice(0, 40).map(office => officeLink(office.id));
    groups.push(relationGroup("Offices", localOffices));
    groups.push(relationGroup("Office Terms", officeTermsAbout("settlement", item.id, 120)));
    const localLaws = data.laws.filter(law => law.settlementId === item.id).slice(0, 40).map(law => lawLink(law.id));
    groups.push(relationGroup("Laws", localLaws));
    const localCases = data.cases.filter(legalCase => legalCase.settlementId === item.id).slice(0, 60).map(legalCase => caseLink(legalCase.id));
    groups.push(relationGroup("Cases", localCases));
    groups.push(relationGroup("Testimonies", testimoniesAbout("settlement", item.id, 100)));
    const localBattles = data.battles.filter(battle => battle.settlementId === item.id).slice(0, 60).map(battle => battleLink(battle.id));
    groups.push(relationGroup("Battles", localBattles));
    groups.push(relationGroup("Battle Roles", battleParticipationsAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Conflicts", conflictsAbout("settlement", item.id, 80)));
    groups.push(relationGroup("Military Units", data.militaryUnits.filter(unit => unit.settlementId === item.id).slice(0, 80).map(unit => militaryUnitLink(unit.id))));
    groups.push(relationGroup("Equipment", data.equipmentCaches.filter(cache => cache.settlementId === item.id).slice(0, 80).map(cache => equipmentCacheLink(cache.id))));
    groups.push(relationGroup("Spy Networks", data.spyNetworks.filter(network => network.settlementId === item.id || network.targetSettlementId === item.id).slice(0, 80).map(network => spyNetworkLink(network.id))));
    groups.push(relationGroup("Spy Operations", data.spyOperations.filter(operation => operation.targetSettlementId === item.id).slice(0, 80).map(operation => spyOperationLink(operation.id))));
    const localInjuries = data.injuries.filter(injury => injury.settlementId === item.id).slice(0, 80).map(injury => injuryLink(injury.id));
    groups.push(relationGroup("Injuries", localInjuries));
    groups.push(relationGroup("Illnesses", illnessesAbout("settlement", item.id, 80)));
    groups.push(relationGroup("Care Records", careRecordsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("settlement", item.id, 100)));
    const localMemorials = data.memorials.filter(memorial => memorial.settlementId === item.id).slice(0, 80).map(memorial => memorialLink(memorial.id));
    groups.push(relationGroup("Memorials", localMemorials));
    groups.push(relationGroup("Burials", burialsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Births", birthsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Age Milestones", ageMilestonesAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("settlement", item.id, 120)));
    const localAmbitions = data.ambitions.filter(ambition => ambition.settlementId === item.id).slice(0, 80).map(ambition => ambitionLink(ambition.id));
    groups.push(relationGroup("Ambitions", localAmbitions));
    const localApprenticeships = data.apprenticeships.filter(apprenticeship => apprenticeship.settlementId === item.id).slice(0, 80).map(apprenticeship => apprenticeshipLink(apprenticeship.id));
    groups.push(relationGroup("Apprenticeships", localApprenticeships));
    groups.push(relationGroup("Skills", skillsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Teachings", teachingsAbout("settlement", item.id, 140)));
    groups.push(relationGroup("Residences", residencesAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Careers", careersAbout("settlement", item.id, 120)));
    const departingJourneys = data.journeys.filter(journey => journey.fromSettlementId === item.id).slice(0, 60).map(journey => journeyLink(journey.id));
    const arrivingJourneys = data.journeys.filter(journey => journey.toSettlementId === item.id).slice(0, 60).map(journey => journeyLink(journey.id));
    groups.push(relationGroup("Departing Journeys", departingJourneys));
    groups.push(relationGroup("Arriving Journeys", arrivingJourneys));
    groups.push(relationGroup("Roads", settlementRoadLinks(item.id, 80)));
    const localRelationships = data.relationships.filter(relationship => relationship.settlementId === item.id).slice(0, 60).map(relationship => relationshipLink(relationship.id));
    groups.push(relationGroup("Relationships", localRelationships));
    groups.push(relationGroup("Relationship Milestones", relationshipMilestonesAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Unions", unionsAbout("settlement", item.id, 80)));
    const localChronicles = data.chronicles.filter(chronicle => chronicle.settlementId === item.id || (chronicle.subjectRefs || []).some(ref => ref.kind === "settlement" && ref.id === item.id)).slice(0, 80).map(chronicle => chronicleLink(chronicle.id));
    groups.push(relationGroup("Chronicles", localChronicles));
    groups.push(relationGroup("Written Works", writtenWorksAbout("settlement", item.id, 100)));
    const localMemories = data.memories.filter(memory => memory.settlementId === item.id || (memory.subjectRefs || []).some(ref => ref.kind === "settlement" && ref.id === item.id)).slice(0, 80).map(memory => memoryLink(memory.id));
    groups.push(relationGroup("Memories", localMemories));
    groups.push(relationGroup("Thoughts", thoughtsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Opinions", opinionsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Conversations", conversationsAbout("settlement", item.id, 120)));
    const localRumors = data.rumors.filter(rumor => rumor.originSettlementId === item.id || (rumor.spreadSettlementIds || []).includes(item.id) || (rumor.subjectRefs || []).some(ref => ref.kind === "settlement" && ref.id === item.id)).slice(0, 80).map(rumor => rumorLink(rumor.id));
    groups.push(relationGroup("Rumors", localRumors));
    const localSecrets = data.secrets.filter(secret => secret.settlementId === item.id || (secret.subjectRefs || []).some(ref => ref.kind === "settlement" && ref.id === item.id)).slice(0, 80).map(secret => secretLink(secret.id));
    groups.push(relationGroup("Secrets", localSecrets));
    groups.push(relationGroup("Schemes", schemesAbout("settlement", item.id, 80)));
    const localFeuds = data.feuds.filter(feud => feud.settlementId === item.id || (feud.subjectRefs || []).some(ref => ref.kind === "settlement" && ref.id === item.id)).slice(0, 80).map(feud => feudLink(feud.id));
    groups.push(relationGroup("Feuds", localFeuds));
    const localOaths = data.oaths.filter(oath => oath.settlementId === item.id || oath.targetSettlementId === item.id || (oath.subjectRefs || []).some(ref => ref.kind === "settlement" && ref.id === item.id)).slice(0, 80).map(oath => oathLink(oath.id));
    groups.push(relationGroup("Oaths", localOaths));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("settlement", item.id, 80)));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("settlement", item.id, 140)));
    groups.push(relationGroup("Activities", activitiesAbout("settlement", item.id, 160)));
    groups.push(relationGroup("Projects", projectsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("settlement", item.id, 140)));
    groups.push(relationGroup("Obligations", obligationsAbout("settlement", item.id, 100)));
    groups.push(relationGroup("Holdings", holdingsAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Belongings", belongingsAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("settlement", item.id, 120)));
    groups.push(relationGroup("Artifact Condition Records", artifactConditionsAbout("settlement", item.id, 120)));
  } else if (kind === "settlement-controls") {
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.previousCivilizationId != null) groups.push(relationGroup("Previous Civilization", [civLink(item.previousCivilizationId)]));
    if (item.conflictId != null) groups.push(relationGroup("Conflict", [conflictLink(item.conflictId)]));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    if (item.startEventId != null) groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("settlement-control", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("settlement-control", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("settlement-control", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("settlement-control", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("settlement-control", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("settlement-control", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("settlement-control", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("settlement-control", item.id, 40)));
  } else if (kind === "natural-features") {
    groups.push(relationGroup("Nearby Settlements", (item.settlementIds || []).slice(0, 80).map(settlementLink)));
    groups.push(relationGroup("Sacred Sites", (item.sacredSiteIds || []).slice(0, 80).map(sacredSiteLink)));
    groups.push(relationGroup("Journeys", (item.journeyIds || []).slice(0, 80).map(journeyLink)));
    groups.push(relationGroup("Roads", roadsAbout("natural-feature", item.id, 80)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("natural-feature", item.id, 40)));
    groups.push(relationGroup("Events", recentEventLinksFor(item, 80)));
  } else if (kind === "structures") {
    groups.push(relationGroup("Settlement", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.founderAgentId != null) groups.push(relationGroup("Builder", [personLink(item.founderAgentId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.civilizationGoalId != null) groups.push(relationGroup("Civilization Goal", [civilizationGoalLink(item.civilizationGoalId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    groups.push(relationGroup("Office Terms", officeTermsAbout("structure", item.id, 80)));
    groups.push(relationGroup("Residents", (item.residentAgentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Workers", (item.workerAgentIds || []).slice(0, 100).map(personLink)));
    groups.push(relationGroup("Memberships", membershipsAbout("structure", item.id, 80)));
    groups.push(relationGroup("Organization Ranks", organizationRanksAbout("structure", item.id, 80)));
    groups.push(relationGroup("Unions", unionsAbout("structure", item.id, 60)));
    groups.push(relationGroup("Artifacts", (item.artifactIds || []).slice(0, 60).map(artifactLink)));
    const structureApprenticeships = data.apprenticeships.filter(apprenticeship => apprenticeship.structureId === item.id).slice(0, 60).map(apprenticeship => apprenticeshipLink(apprenticeship.id));
    groups.push(relationGroup("Apprenticeships", structureApprenticeships));
    groups.push(relationGroup("Skills", skillsAbout("structure", item.id, 80)));
    groups.push(relationGroup("Teachings", teachingsAbout("structure", item.id, 100)));
    groups.push(relationGroup("Residences", residencesAbout("structure", item.id, 80)));
    groups.push(relationGroup("Careers", careersAbout("structure", item.id, 80)));
    const residentHouseholds = data.households.filter(household => household.residenceStructureId === item.id).slice(0, 20).map(household => householdLink(household.id));
    groups.push(relationGroup("Households", residentHouseholds));
    groups.push(relationGroup("Artifact Condition Records", artifactConditionsAbout("structure", item.id, 80)));
    const heardCases = data.cases.filter(legalCase => legalCase.structureId === item.id).slice(0, 60).map(legalCase => caseLink(legalCase.id));
    groups.push(relationGroup("Cases", heardCases));
    const structureInjuries = data.injuries.filter(injury => injury.structureId === item.id).slice(0, 80).map(injury => injuryLink(injury.id));
    groups.push(relationGroup("Injuries", structureInjuries));
    groups.push(relationGroup("Illnesses", illnessesAbout("structure", item.id, 80)));
    groups.push(relationGroup("Care Records", careRecordsAbout("structure", item.id, 100)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("structure", item.id, 100)));
    const structureMemorials = data.memorials.filter(memorial => memorial.structureId === item.id).slice(0, 80).map(memorial => memorialLink(memorial.id));
    groups.push(relationGroup("Memorials", structureMemorials));
    groups.push(relationGroup("Burials", burialsAbout("structure", item.id, 80)));
    groups.push(relationGroup("Births", birthsAbout("structure", item.id, 80)));
    groups.push(relationGroup("Age Milestones", ageMilestonesAbout("structure", item.id, 80)));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("structure", item.id, 80)));
    const structureJourneys = data.journeys.filter(journey => journey.originStructureId === item.id || journey.destinationStructureId === item.id).slice(0, 60).map(journey => journeyLink(journey.id));
    groups.push(relationGroup("Journeys", structureJourneys));
    groups.push(relationGroup("Chronicles", data.chronicles.filter(chronicle => chronicle.structureId === item.id || (chronicle.subjectRefs || []).some(ref => ref.kind === "structure" && ref.id === item.id)).slice(0, 60).map(chronicle => chronicleLink(chronicle.id))));
    groups.push(relationGroup("Written Works", writtenWorksAbout("structure", item.id, 80)));
    groups.push(relationGroup("Memories", memoriesAbout("structure", item.id, 60)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("structure", item.id, 100)));
    groups.push(relationGroup("Opinions", opinionsAbout("structure", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("structure", item.id, 60)));
    groups.push(relationGroup("Secrets", secretsAbout("structure", item.id, 60)));
    groups.push(relationGroup("Feuds", feudsAbout("structure", item.id, 60)));
    groups.push(relationGroup("Oaths", oathsAbout("structure", item.id, 60)));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("structure", item.id, 60)));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("structure", item.id, 100)));
    groups.push(relationGroup("Activities", activitiesAbout("structure", item.id, 120)));
    groups.push(relationGroup("Projects", projectsAbout("structure", item.id, 80)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("structure", item.id, 100)));
    groups.push(relationGroup("Obligations", obligationsAbout("structure", item.id, 60)));
    groups.push(relationGroup("Holdings", holdingsAbout("structure", item.id, 80)));
    groups.push(relationGroup("Belongings", belongingsAbout("structure", item.id, 80)));
  } else if (kind === "households") {
    groups.push(relationGroup("Settlement", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.residenceStructureId != null) groups.push(relationGroup("Residence", [structureLink(item.residenceStructureId)]));
    groups.push(relationGroup("Lineages", (item.lineageIds || []).map(lineageLink)));
    groups.push(relationGroup("Founders", (item.founderAgentIds || []).map(personLink)));
    groups.push(relationGroup("Members", (item.memberAgentIds || []).slice(0, 100).map(personLink)));
    groups.push(relationGroup("Unions", unionsAbout("household", item.id, 80)));
    const householdArtifacts = data.artifacts.filter(artifact => item.residenceStructureId != null && artifact.structureId === item.residenceStructureId).slice(0, 60).map(artifact => artifactLink(artifact.id));
    groups.push(relationGroup("Artifacts at Home", householdArtifacts));
    const householdInjuries = data.injuries.filter(injury => injury.householdId === item.id).slice(0, 80).map(injury => injuryLink(injury.id));
    groups.push(relationGroup("Injuries", householdInjuries));
    groups.push(relationGroup("Illnesses", illnessesAbout("household", item.id, 80)));
    groups.push(relationGroup("Care Records", careRecordsAbout("household", item.id, 100)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("household", item.id, 100)));
    const householdMemorials = data.memorials.filter(memorial => memorial.householdId === item.id).slice(0, 80).map(memorial => memorialLink(memorial.id));
    groups.push(relationGroup("Memorials", householdMemorials));
    groups.push(relationGroup("Burials", burialsAbout("household", item.id, 100)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("household", item.id, 100)));
    groups.push(relationGroup("Births", birthsAbout("household", item.id, 100)));
    groups.push(relationGroup("Age Milestones", ageMilestonesAbout("household", item.id, 100)));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("household", item.id, 100)));
    groups.push(relationGroup("Estates", data.estates.filter(estate => estate.householdId === item.id).slice(0, 80).map(estate => estateLink(estate.id))));
    const householdAmbitions = data.ambitions.filter(ambition => ambition.householdId === item.id).slice(0, 80).map(ambition => ambitionLink(ambition.id));
    groups.push(relationGroup("Ambitions", householdAmbitions));
    const householdMemberIds = new Set(item.memberAgentIds || []);
    groups.push(relationGroup("Belief Adherences", data.beliefAdherences.filter(adherence => householdMemberIds.has(adherence.agentId)).slice(0, 120).map(adherence => beliefAdherenceLink(adherence.id))));
    groups.push(relationGroup("Memberships", data.memberships.filter(membership => householdMemberIds.has(membership.agentId)).slice(0, 100).map(membership => membershipLink(membership.id))));
    const householdApprenticeships = data.apprenticeships.filter(apprenticeship => householdMemberIds.has(apprenticeship.mentorAgentId) || householdMemberIds.has(apprenticeship.apprenticeAgentId)).slice(0, 80).map(apprenticeship => apprenticeshipLink(apprenticeship.id));
    groups.push(relationGroup("Apprenticeships", householdApprenticeships));
    groups.push(relationGroup("Residence History", residencesAbout("household", item.id, 100)));
    groups.push(relationGroup("Career History", careersAbout("household", item.id, 100)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("household", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("household", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("household", item.id, 60)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("household", item.id, 100)));
    groups.push(relationGroup("Opinions", opinionsAbout("household", item.id, 60)));
    groups.push(relationGroup("Feuds", data.feuds.filter(feud => (feud.householdIds || []).includes(item.id)).slice(0, 60).map(feud => feudLink(feud.id))));
    groups.push(relationGroup("Ceremonies", data.ceremonies.filter(ceremony => (ceremony.participantAgentIds || []).some(id => (item.memberAgentIds || []).includes(id))).slice(0, 60).map(ceremony => ceremonyLink(ceremony.id))));
    groups.push(relationGroup("Ceremony Roles", data.ceremonyParticipations.filter(participation => householdMemberIds.has(participation.agentId)).slice(0, 100).map(participation => ceremonyParticipationLink(participation.id))));
    groups.push(relationGroup("Activities", activitiesAbout("household", item.id, 120)));
    groups.push(relationGroup("Projects", data.projects.filter(project => project.leadAgentId != null && (item.memberAgentIds || []).includes(project.leadAgentId) || (project.workerAgentIds || []).some(id => (item.memberAgentIds || []).includes(id))).slice(0, 80).map(project => projectLink(project.id))));
    groups.push(relationGroup("Obligations", data.obligations.filter(obligation => (item.memberAgentIds || []).includes(obligation.creditorAgentId) || (item.memberAgentIds || []).includes(obligation.debtorAgentId) || (obligation.witnessAgentIds || []).some(id => (item.memberAgentIds || []).includes(id))).slice(0, 80).map(obligation => obligationLink(obligation.id))));
    groups.push(relationGroup("Holdings", holdingsAbout("household", item.id, 80)));
    groups.push(relationGroup("Belongings", belongingsAbout("household", item.id, 100)));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("household", item.id, 100)));
    groups.push(relationGroup("Epithets", epithetsAbout("household", item.id, 80)));
    groups.push(relationGroup("Reputation Milestones", reputationMilestonesAbout("household", item.id, 80)));
  } else if (kind === "lineages") {
    groups.push(relationGroup("Founder", [personLink(item.founderAgentId)]));
    groups.push(relationGroup("Origin", [settlementLink(item.originSettlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Households", (item.householdIds || []).slice(0, 100).map(householdLink)));
    groups.push(relationGroup("Members", (item.memberAgentIds || []).slice(0, 160).map(personLink)));
    groups.push(relationGroup("Unions", unionsAbout("lineage", item.id, 80)));
    const memberIds = new Set(item.memberAgentIds || []);
    groups.push(relationGroup("Belief Adherences", data.beliefAdherences.filter(adherence => memberIds.has(adherence.agentId)).slice(0, 140).map(adherence => beliefAdherenceLink(adherence.id))));
    groups.push(relationGroup("Memberships", data.memberships.filter(membership => memberIds.has(membership.agentId)).slice(0, 120).map(membership => membershipLink(membership.id))));
    const lineageArtifacts = data.artifacts.filter(artifact => memberIds.has(artifact.creatorAgentId) || memberIds.has(artifact.ownerAgentId)).slice(0, 80).map(artifact => artifactLink(artifact.id));
    groups.push(relationGroup("Artifacts", lineageArtifacts));
    const lineageOffices = data.offices.filter(office => memberIds.has(office.holderAgentId)).slice(0, 60).map(office => officeLink(office.id));
    groups.push(relationGroup("Held Offices", lineageOffices));
    groups.push(relationGroup("Office Terms", data.officeTerms.filter(term => memberIds.has(term.holderAgentId)).slice(0, 120).map(term => officeTermLink(term.id))));
    const lineageMemorials = data.memorials.filter(memorial => memberIds.has(memorial.personId)).slice(0, 80).map(memorial => memorialLink(memorial.id));
    groups.push(relationGroup("Memorials", lineageMemorials));
    groups.push(relationGroup("Burials", burialsAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Births", birthsAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Age Milestones", ageMilestonesAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Estates", data.estates.filter(estate => estate.lineageId === item.id || memberIds.has(estate.decedentAgentId) || (estate.heirAgentIds || []).some(id => memberIds.has(id))).slice(0, 100).map(estate => estateLink(estate.id))));
    const lineageAmbitions = data.ambitions.filter(ambition => memberIds.has(ambition.personId)).slice(0, 80).map(ambition => ambitionLink(ambition.id));
    groups.push(relationGroup("Ambitions", lineageAmbitions));
    const lineageApprenticeships = data.apprenticeships.filter(apprenticeship => apprenticeship.lineageId === item.id || memberIds.has(apprenticeship.mentorAgentId) || memberIds.has(apprenticeship.apprenticeAgentId)).slice(0, 80).map(apprenticeship => apprenticeshipLink(apprenticeship.id));
    groups.push(relationGroup("Apprenticeships", lineageApprenticeships));
    groups.push(relationGroup("Skills", data.skills.filter(skill => memberIds.has(skill.agentId) || (skill.subjectRefs || []).some(ref => ref.kind === "lineage" && ref.id === item.id)).slice(0, 100).map(skill => skillLink(skill.id))));
    groups.push(relationGroup("Residences", residencesAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Careers", careersAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("lineage", item.id, 80)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("lineage", item.id, 80)));
    groups.push(relationGroup("Memories", memoriesAbout("lineage", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("lineage", item.id, 80)));
    groups.push(relationGroup("Feuds", data.feuds.filter(feud => (feud.lineageIds || []).includes(item.id)).slice(0, 60).map(feud => feudLink(feud.id))));
    groups.push(relationGroup("Ceremonies", data.ceremonies.filter(ceremony => (ceremony.participantAgentIds || []).some(id => memberIds.has(id))).slice(0, 80).map(ceremony => ceremonyLink(ceremony.id))));
    groups.push(relationGroup("Ceremony Roles", data.ceremonyParticipations.filter(participation => memberIds.has(participation.agentId)).slice(0, 120).map(participation => ceremonyParticipationLink(participation.id))));
    groups.push(relationGroup("Activities", data.activities.filter(activity => (activity.participantAgentIds || []).some(id => memberIds.has(id))).slice(0, 140).map(activity => activityLink(activity.id))));
    groups.push(relationGroup("Projects", data.projects.filter(project => memberIds.has(project.leadAgentId) || (project.workerAgentIds || []).some(id => memberIds.has(id))).slice(0, 80).map(project => projectLink(project.id))));
    groups.push(relationGroup("Obligations", data.obligations.filter(obligation => memberIds.has(obligation.creditorAgentId) || memberIds.has(obligation.debtorAgentId) || (obligation.witnessAgentIds || []).some(id => memberIds.has(id))).slice(0, 80).map(obligation => obligationLink(obligation.id))));
    groups.push(relationGroup("Holdings", data.holdings.filter(holding => memberIds.has(holding.ownerAgentId) || (holding.subjectRefs || []).some(ref => ref.kind === "lineage" && ref.id === item.id)).slice(0, 80).map(holding => holdingLink(holding.id))));
    groups.push(relationGroup("Belongings", data.belongings.filter(belonging => memberIds.has(belonging.ownerAgentId) || memberIds.has(belonging.previousOwnerAgentId) || (belonging.subjectRefs || []).some(ref => ref.kind === "lineage" && ref.id === item.id)).slice(0, 100).map(belonging => belongingLink(belonging.id))));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Epithets", epithetsAbout("lineage", item.id, 100)));
    groups.push(relationGroup("Reputation Milestones", reputationMilestonesAbout("lineage", item.id, 100)));
  } else if (kind === "civilizations") {
    groups.push(relationGroup("Lifecycle", [
      item.status == null ? "" : '<span class="ref">' + esc(item.status) + '</span>',
      item.originKind == null ? "" : '<span class="ref">' + esc(item.originKind) + '</span>',
      item.parentCivilizationId == null ? "" : "parent " + civLink(item.parentCivilizationId),
      item.restoredCivilizationId == null ? "" : "restored " + civLink(item.restoredCivilizationId),
      item.foundedYear == null ? "" : '<span class="ref">' + esc("founded " + years(item.foundedYear)) + '</span>',
      item.fallenYear == null ? "" : '<span class="ref">' + esc("fallen " + years(item.fallenYear)) + '</span>',
      item.collapsePressure == null ? "" : '<span class="ref">' + esc("collapse pressure " + item.collapsePressure) + '</span>',
      ...((item.collapseFailureKinds || []).slice(0, 10).map(kind => '<span class="ref">' + esc(kind) + '</span>'))
    ].filter(Boolean)));
    groups.push(relationGroup("Settlement Control", settlementControlsAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Person Allegiances", personAllegiancesAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Preferences", preferencesAbout("civilization", item.id, 180)));
    groups.push(relationGroup("Traditions", (item.traditionIds || []).slice(0, 180).map(traditionLink)));
    const civOrganizations = data.organizations.filter(organization => organization.civilizationId === item.id).slice(0, 60).map(organization => organizationLink(organization.id));
    groups.push(relationGroup("Organizations", civOrganizations));
    groups.push(relationGroup("Memberships", membershipsAbout("civilization", item.id, 140)));
    groups.push(relationGroup("Organization Ranks", organizationRanksAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Epithets", epithetsAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Reputation Milestones", reputationMilestonesAbout("civilization", item.id, 160)));
    const civBeliefIds = item.beliefIds || data.beliefs.filter(belief => belief.civilizationId === item.id).map(belief => belief.id);
    const civBeliefs = civBeliefIds.slice(0, 40).map(beliefLink);
    const mythsMagicLinks = item.mythsMagicId == null
      ? data.mythsAndMagic.filter(record => record.civilizationId === item.id).map(record => mythsMagicLink(record.id))
      : [mythsMagicLink(item.mythsMagicId)];
    groups.push(relationGroup("Myths & Magic", mythsMagicLinks));
    groups.push(relationGroup("Creation Seat", [
      item.creationDomain == null ? "" : '<span class="ref">' + esc(item.creationDomain) + '</span>',
      item.creationSeatPreference == null ? "" : '<span class="ref">' + esc(item.creationSeatPreference) + '</span>',
      item.creationSeatScore == null ? "" : '<span class="ref">' + esc("score " + item.creationSeatScore) + '</span>',
      item.creationGodId == null ? "" : godLink(item.creationGodId),
      item.capitalSettlementId == null ? "" : settlementLink(item.capitalSettlementId)
    ].filter(Boolean)));
    groups.push(relationGroup("Beliefs", civBeliefs));
    groups.push(relationGroup("Belief Adherences", beliefAdherencesAbout("civilization", item.id, 140)));
    groups.push(relationGroup("Gods and Divine Acts", [
      ...godsAbout("civilization", item.id, 100),
      ...commandmentsAbout("civilization", item.id, 100),
      ...destiniesAbout("civilization", item.id, 100),
      ...miraclesAbout("civilization", item.id, 100)
    ]));
    groups.push(relationGroup("Myths", mythsAbout("civilization", item.id, 100)));
    groups.push(relationGroup("Doctrines", doctrinesAbout("civilization", item.id, 100)));
    groups.push(relationGroup("Magic Roles", magicRolesAbout("civilization", item.id, 100)));
    groups.push(relationGroup("Prophecies", propheciesAbout("civilization", item.id, 140)));
    groups.push(relationGroup("Civilization Goals", civilizationGoalsAbout("civilization", item.id, 140)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("civilization", item.id, 140)));
    const civOffices = data.offices.filter(office => office.civilizationId === item.id).slice(0, 80).map(office => officeLink(office.id));
    groups.push(relationGroup("Offices", civOffices));
    groups.push(relationGroup("Office Terms", officeTermsAbout("civilization", item.id, 140)));
    const civLaws = data.laws.filter(law => law.civilizationId === item.id).slice(0, 80).map(law => lawLink(law.id));
    groups.push(relationGroup("Laws", civLaws));
    const civCases = data.cases.filter(legalCase => legalCase.civilizationId === item.id).slice(0, 80).map(legalCase => caseLink(legalCase.id));
    groups.push(relationGroup("Cases", civCases));
    const civBattles = data.battles.filter(battle => battle.attackerCivilizationId === item.id || battle.defenderCivilizationId === item.id).slice(0, 80).map(battle => battleLink(battle.id));
    groups.push(relationGroup("Battles", civBattles));
    groups.push(relationGroup("Battle Roles", battleParticipationsAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Conflicts", conflictsAbout("civilization", item.id, 80)));
    groups.push(relationGroup("Military Units", data.militaryUnits.filter(unit => unit.civilizationId === item.id).slice(0, 120).map(unit => militaryUnitLink(unit.id))));
    groups.push(relationGroup("Equipment", data.equipmentCaches.filter(cache => cache.civilizationId === item.id).slice(0, 120).map(cache => equipmentCacheLink(cache.id))));
    groups.push(relationGroup("Spy Networks", data.spyNetworks.filter(network => network.civilizationId === item.id || network.targetCivilizationId === item.id).slice(0, 120).map(network => spyNetworkLink(network.id))));
    groups.push(relationGroup("Spy Operations", data.spyOperations.filter(operation => operation.civilizationId === item.id || operation.targetCivilizationId === item.id).slice(0, 120).map(operation => spyOperationLink(operation.id))));
    const civInjuries = data.injuries.filter(injury => injury.civilizationId === item.id).slice(0, 80).map(injury => injuryLink(injury.id));
    groups.push(relationGroup("Injuries", civInjuries));
    groups.push(relationGroup("Illnesses", illnessesAbout("civilization", item.id, 100)));
    groups.push(relationGroup("Care Records", careRecordsAbout("civilization", item.id, 120)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("civilization", item.id, 120)));
    const civMemorials = data.memorials.filter(memorial => memorial.civilizationId === item.id).slice(0, 80).map(memorial => memorialLink(memorial.id));
    groups.push(relationGroup("Memorials", civMemorials));
    groups.push(relationGroup("Burials", burialsAbout("civilization", item.id, 120)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Births", birthsAbout("civilization", item.id, 120)));
    groups.push(relationGroup("Age Milestones", ageMilestonesAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("civilization", item.id, 160)));
    const civAmbitions = data.ambitions.filter(ambition => ambition.civilizationId === item.id).slice(0, 80).map(ambition => ambitionLink(ambition.id));
    groups.push(relationGroup("Ambitions", civAmbitions));
    const civApprenticeships = data.apprenticeships.filter(apprenticeship => apprenticeship.civilizationId === item.id).slice(0, 80).map(apprenticeship => apprenticeshipLink(apprenticeship.id));
    groups.push(relationGroup("Apprenticeships", civApprenticeships));
    groups.push(relationGroup("Skills", data.skills.filter(skill => skill.civilizationId === item.id).slice(0, 120).map(skill => skillLink(skill.id))));
    groups.push(relationGroup("Teachings", teachingsAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Residences", residencesAbout("civilization", item.id, 140)));
    groups.push(relationGroup("Careers", careersAbout("civilization", item.id, 140)));
    const civJourneys = data.journeys.filter(journey => journey.civilizationId === item.id).slice(0, 80).map(journey => journeyLink(journey.id));
    groups.push(relationGroup("Journeys", civJourneys));
    const civStructures = data.structures.filter(structure => structure.civilizationId === item.id).slice(0, 80).map(structure => structureLink(structure.id));
    groups.push(relationGroup("Structures", civStructures));
    const civHouseholds = data.households.filter(household => household.civilizationId === item.id).slice(0, 80).map(household => householdLink(household.id));
    groups.push(relationGroup("Households", civHouseholds));
    const civLineages = data.lineages.filter(lineage => lineage.civilizationId === item.id).slice(0, 80).map(lineage => lineageLink(lineage.id));
    groups.push(relationGroup("Lineages", civLineages));
    const civRelationships = data.relationships.filter(relationship => relationship.civilizationId === item.id).slice(0, 60).map(relationship => relationshipLink(relationship.id));
    groups.push(relationGroup("Relationships", civRelationships));
    groups.push(relationGroup("Relationship Milestones", relationshipMilestonesAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Unions", unionsAbout("civilization", item.id, 80)));
    const civChronicles = data.chronicles.filter(chronicle => chronicle.civilizationId === item.id || (chronicle.subjectRefs || []).some(ref => ref.kind === "civilization" && ref.id === item.id)).slice(0, 100).map(chronicle => chronicleLink(chronicle.id));
    groups.push(relationGroup("Chronicles", civChronicles));
    groups.push(relationGroup("Written Works", writtenWorksAbout("civilization", item.id, 140)));
    const civMemories = data.memories.filter(memory => memory.civilizationId === item.id || (memory.subjectRefs || []).some(ref => ref.kind === "civilization" && ref.id === item.id)).slice(0, 100).map(memory => memoryLink(memory.id));
    groups.push(relationGroup("Memories", civMemories));
    groups.push(relationGroup("Thoughts", thoughtsAbout("civilization", item.id, 120)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("civilization", item.id, 120)));
    groups.push(relationGroup("Opinions", opinionsAbout("civilization", item.id, 100)));
    const civCeremonies = data.ceremonies.filter(ceremony => ceremony.civilizationId === item.id).slice(0, 100).map(ceremony => ceremonyLink(ceremony.id));
    groups.push(relationGroup("Ceremonies", civCeremonies));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("civilization", item.id, 160)));
    groups.push(relationGroup("Activities", activitiesAbout("civilization", item.id, 180)));
    const civProjects = data.projects.filter(project => project.civilizationId === item.id).slice(0, 120).map(project => projectLink(project.id));
    groups.push(relationGroup("Projects", civProjects));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("civilization", item.id, 160)));
    const civObligations = data.obligations.filter(obligation => obligation.civilizationId === item.id).slice(0, 120).map(obligation => obligationLink(obligation.id));
    groups.push(relationGroup("Obligations", civObligations));
    const civHoldings = data.holdings.filter(holding => holding.civilizationId === item.id).slice(0, 120).map(holding => holdingLink(holding.id));
    groups.push(relationGroup("Holdings", civHoldings));
    const civBelongings = data.belongings.filter(belonging => belonging.civilizationId === item.id).slice(0, 120).map(belonging => belongingLink(belonging.id));
    groups.push(relationGroup("Belongings", civBelongings));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("civilization", item.id, 120)));
    groups.push(relationGroup("Schemes", schemesAbout("civilization", item.id, 120)));
  } else if (kind === "organizations") {
    if (item.leaderAgentId != null) groups.push(relationGroup("Leader", [personLink(item.leaderAgentId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.structureId != null) groups.push(relationGroup("Home", [structureLink(item.structureId)]));
    groups.push(relationGroup("Home", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Members", (item.memberIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Memberships", (item.membershipIds || []).slice(0, 120).map(membershipLink)));
    groups.push(relationGroup("Organization Ranks", organizationRanksAbout("organization", item.id, 160)));
    groups.push(relationGroup("Apprenticeships", data.apprenticeships.filter(apprenticeship => apprenticeship.organizationId === item.id).slice(0, 60).map(apprenticeship => apprenticeshipLink(apprenticeship.id))));
    groups.push(relationGroup("Skills", skillsAbout("organization", item.id, 60)));
    groups.push(relationGroup("Teachings", teachingsAbout("organization", item.id, 100)));
    groups.push(relationGroup("Careers", careersAbout("organization", item.id, 60)));
    groups.push(relationGroup("Journeys", data.journeys.filter(journey => journey.organizationId === item.id).slice(0, 60).map(journey => journeyLink(journey.id))));
    const organizationRelationships = data.relationships.filter(relationship => relationship.organizationId === item.id).slice(0, 60).map(relationship => relationshipLink(relationship.id));
    groups.push(relationGroup("Relationships", organizationRelationships));
    groups.push(relationGroup("Relationship Milestones", relationshipMilestonesAbout("organization", item.id, 100)));
    groups.push(relationGroup("Traditions", traditionsAbout("organization", item.id, 80)));
    groups.push(relationGroup("Magic Roles", magicRolesAbout("organization", item.id, 80)));
    groups.push(relationGroup("Prophecies", propheciesAbout("organization", item.id, 80)));
    groups.push(relationGroup("Chronicles", data.chronicles.filter(chronicle => chronicle.organizationId === item.id || (chronicle.subjectRefs || []).some(ref => ref.kind === "organization" && ref.id === item.id)).slice(0, 60).map(chronicle => chronicleLink(chronicle.id))));
    groups.push(relationGroup("Written Works", writtenWorksAbout("organization", item.id, 80)));
    groups.push(relationGroup("Memories", memoriesAbout("organization", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("organization", item.id, 60)));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("organization", item.id, 60)));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("organization", item.id, 80)));
    groups.push(relationGroup("Activities", activitiesAbout("organization", item.id, 100)));
    groups.push(relationGroup("Projects", projectsAbout("organization", item.id, 60)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("organization", item.id, 80)));
    groups.push(relationGroup("Obligations", obligationsAbout("organization", item.id, 60)));
    groups.push(relationGroup("Holdings", holdingsAbout("organization", item.id, 60)));
    groups.push(relationGroup("Belongings", belongingsAbout("organization", item.id, 60)));
  } else if (kind === "memberships") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    groups.push(relationGroup("Ranks", organizationRanksAbout("membership", item.id, 80)));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.startEventId != null) groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Careers", careersAbout("membership", item.id, 40)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("membership", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("membership", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("membership", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("membership", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("membership", item.id, 40)));
    groups.push(relationGroup("Schemes", schemesAbout("membership", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("membership", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("membership", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("membership", item.id, 40)));
  } else if (kind === "beliefs") {
    if (item.founderAgentId != null) groups.push(relationGroup("Founder", [personLink(item.founderAgentId)]));
    groups.push(relationGroup("Origin", [settlementLink(item.originSettlementId)]));
    groups.push(relationGroup("Structures", (item.structureIds || []).slice(0, 60).map(structureLink)));
    groups.push(relationGroup("Organizations", (item.organizationIds || []).slice(0, 60).map(organizationLink)));
    groups.push(relationGroup("Memberships", membershipsAbout("belief", item.id, 80)));
    groups.push(relationGroup("Organization Ranks", organizationRanksAbout("belief", item.id, 80)));
    groups.push(relationGroup("Journeys", data.journeys.filter(journey => journey.beliefId === item.id).slice(0, 60).map(journey => journeyLink(journey.id))));
    groups.push(relationGroup("Memorials", data.memorials.filter(memorial => memorial.beliefId === item.id).slice(0, 60).map(memorial => memorialLink(memorial.id))));
    groups.push(relationGroup("Burials", burialsAbout("belief", item.id, 80)));
    groups.push(relationGroup("Births", birthsAbout("belief", item.id, 80)));
    groups.push(relationGroup("Adherents", (item.adherentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Adherence Records", (item.adherenceIds || []).slice(0, 120).map(beliefAdherenceLink)));
    groups.push(relationGroup("Myths", (item.mythIds || []).slice(0, 80).map(mythLink)));
    groups.push(relationGroup("Doctrines", (item.doctrineIds || []).slice(0, 80).map(doctrineLink)));
    groups.push(relationGroup("Magic Roles", (item.magicRoleIds || []).slice(0, 80).map(magicRoleLink)));
    groups.push(relationGroup("Prophecies", (item.prophecyIds || []).slice(0, 120).map(prophecyLink)));
    groups.push(relationGroup("Civilization Goals", (item.civilizationGoalIds || []).slice(0, 120).map(civilizationGoalLink)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("belief", item.id, 100)));
    groups.push(relationGroup("Traditions", traditionsAbout("belief", item.id, 80)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("belief", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("belief", item.id, 80)));
    groups.push(relationGroup("Teachings", teachingsAbout("belief", item.id, 100)));
    groups.push(relationGroup("Memories", memoriesAbout("belief", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("belief", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("belief", item.id, 60)));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("belief", item.id, 60)));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("belief", item.id, 80)));
    groups.push(relationGroup("Activities", activitiesAbout("belief", item.id, 100)));
    groups.push(relationGroup("Projects", projectsAbout("belief", item.id, 60)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("belief", item.id, 80)));
    groups.push(relationGroup("Obligations", obligationsAbout("belief", item.id, 60)));
    groups.push(relationGroup("Holdings", holdingsAbout("belief", item.id, 60)));
    groups.push(relationGroup("Belongings", belongingsAbout("belief", item.id, 60)));
  } else if (kind === "myths") {
    groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Origin", [settlementLink(item.originSettlementId)]));
    if (item.centralAgentId != null) groups.push(relationGroup("Central Figure", [personLink(item.centralAgentId)]));
    groups.push(relationGroup("Doctrines", doctrinesAbout("myth", item.id, 80)));
    groups.push(relationGroup("Civilization Goals", civilizationGoalsAbout("myth", item.id, 80)));
    groups.push(relationGroup("Magic Roles", magicRolesAbout("myth", item.id, 80)));
    groups.push(relationGroup("Prophecies", propheciesAbout("myth", item.id, 120)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("myth", item.id, 80)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("myth", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("myth", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("myth", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("myth", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("myth", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("myth", item.id, 60)));
    groups.push(relationGroup("Oaths", oathsAbout("myth", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("myth", item.id, 40)));
  } else if (kind === "doctrines") {
    groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Origin", [settlementLink(item.originSettlementId)]));
    if (item.mythId != null) groups.push(relationGroup("Myth", [mythLink(item.mythId)]));
    groups.push(relationGroup("Civilization Goals", (item.civilizationGoalIds || []).slice(0, 120).map(civilizationGoalLink)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("doctrine", item.id, 80)));
    groups.push(relationGroup("Principle", ['<span class="ref">' + esc(item.principle) + '</span>']));
    groups.push(relationGroup("Virtue", ['<span class="ref">' + esc(item.virtue) + '</span>']));
    groups.push(relationGroup("Taboo", ['<span class="ref">' + esc(item.taboo) + '</span>']));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("doctrine", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("doctrine", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("doctrine", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("doctrine", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("doctrine", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("doctrine", item.id, 60)));
    groups.push(relationGroup("Oaths", oathsAbout("doctrine", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("doctrine", item.id, 40)));
  } else if (kind === "magic-roles") {
    groups.push(relationGroup("Holder", [personLink(item.agentId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.mythId != null) groups.push(relationGroup("Myth", [mythLink(item.mythId)]));
    groups.push(relationGroup("Prophecies", (item.prophecyIds || []).slice(0, 120).map(prophecyLink)));
    groups.push(relationGroup("Kingdom Goals", (item.civilizationGoalIds || []).slice(0, 120).map(civilizationGoalLink)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("magic-role", item.id, 80)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("magic-role", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("magic-role", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("magic-role", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("magic-role", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("magic-role", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("magic-role", item.id, 60)));
    groups.push(relationGroup("Oaths", oathsAbout("magic-role", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("magic-role", item.id, 40)));
  } else if (kind === "prophecies") {
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.mythId != null) groups.push(relationGroup("Myth", [mythLink(item.mythId)]));
    if (item.magicRoleId != null) groups.push(relationGroup("Magic Role", [magicRoleLink(item.magicRoleId)]));
    if (item.speakerAgentId != null) groups.push(relationGroup("Speaker", [personLink(item.speakerAgentId)]));
    if (item.targetAgentId != null) groups.push(relationGroup("Target Person", [personLink(item.targetAgentId)]));
    if (item.targetSettlementId != null) groups.push(relationGroup("Target Place", [settlementLink(item.targetSettlementId)]));
    if (item.targetArtifactId != null) groups.push(relationGroup("Target Artifact", [artifactLink(item.targetArtifactId)]));
    if (item.ambitionId != null) groups.push(relationGroup("Linked Ambition", [ambitionLink(item.ambitionId)]));
    groups.push(relationGroup("Civilization Goals", (item.civilizationGoalIds || []).slice(0, 120).map(civilizationGoalLink)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("prophecy", item.id, 80)));
    if (item.sourceEventId != null) groups.push(relationGroup("Spoken Event", [eventLink(item.sourceEventId)]));
    if (item.resolvedEventId != null) groups.push(relationGroup("Resolution Event", [eventLink(item.resolvedEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("prophecy", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("prophecy", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("prophecy", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("prophecy", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("prophecy", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("prophecy", item.id, 60)));
    groups.push(relationGroup("Oaths", oathsAbout("prophecy", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("prophecy", item.id, 40)));
  } else if (kind === "civilization-goals") {
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.settlementId != null) groups.push(relationGroup("Seat", [settlementLink(item.settlementId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.mythId != null) groups.push(relationGroup("Myth", [mythLink(item.mythId)]));
    if (item.doctrineId != null) groups.push(relationGroup("Doctrine", [doctrineLink(item.doctrineId)]));
    if (item.magicRoleId != null) groups.push(relationGroup("Magic Role", [magicRoleLink(item.magicRoleId)]));
    if (item.prophecyId != null) groups.push(relationGroup("Prophecy", [prophecyLink(item.prophecyId)]));
    if (item.targetSettlementId != null) groups.push(relationGroup("Target Place", [settlementLink(item.targetSettlementId)]));
    if (item.targetArtifactId != null) groups.push(relationGroup("Target Artifact", [artifactLink(item.targetArtifactId)]));
    if (item.targetCivilizationId != null) groups.push(relationGroup("Target Civilization", [civLink(item.targetCivilizationId)]));
    if (item.sourceEventId != null) groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.resolvedEventId != null) groups.push(relationGroup("Resolution Event", [eventLink(item.resolvedEventId)]));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("civilization-goal", item.id, 80)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("civilization-goal", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("civilization-goal", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("civilization-goal", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("civilization-goal", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("civilization-goal", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("civilization-goal", item.id, 60)));
    groups.push(relationGroup("Personal Ambitions", data.ambitions.filter(ambition => ambition.civilizationGoalId === item.id).slice(0, 80).map(ambitionLink)));
    groups.push(relationGroup("Oaths", oathsAbout("civilization-goal", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("civilization-goal", item.id, 40)));
  } else if (kind === "sacred-sites") {
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Natural Features", naturalFeaturesAbout("sacred-site", item.id, 40)));
    if (item.founderAgentId != null) groups.push(relationGroup("Founder", [personLink(item.founderAgentId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.mythId != null) groups.push(relationGroup("Myth", [mythLink(item.mythId)]));
    if (item.doctrineId != null) groups.push(relationGroup("Doctrine", [doctrineLink(item.doctrineId)]));
    if (item.magicRoleId != null) groups.push(relationGroup("Magic Role", [magicRoleLink(item.magicRoleId)]));
    if (item.prophecyId != null) groups.push(relationGroup("Prophecy", [prophecyLink(item.prophecyId)]));
    if (item.civilizationGoalId != null) groups.push(relationGroup("Civilization Goal", [civilizationGoalLink(item.civilizationGoalId)]));
    groups.push(relationGroup("Site Facts", [
      '<span class="ref">' + esc(item.kind) + '</span>',
      '<span class="ref">' + esc("renown " + item.renown) + '</span>',
      '<span class="ref">' + esc("founded " + years(item.foundedYear)) + '</span>',
      '<span class="ref">' + esc("coordinates " + Math.round(item.x) + ", " + Math.round(item.y)) + '</span>'
    ]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Pilgrimages", journeysAbout("sacred-site", item.id, 80)));
    groups.push(relationGroup("Relics and Offerings", artifactsAbout("sacred-site", item.id, 80)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("sacred-site", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Secrets", secretsAbout("sacred-site", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("sacred-site", item.id, 40)));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Activities", activitiesAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Projects", projectsAbout("sacred-site", item.id, 60)));
    groups.push(relationGroup("Recent Events", recentEventLinksFor(item, 10)));
  } else if (kind === "belief-adherences") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.startEventId != null) groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Projects", projectsAbout("belief-adherence", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("belief-adherence", item.id, 40)));
  } else if (kind === "myths-magic") {
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Capital", [settlementLink(item.capitalSettlementId)]));
    groups.push(relationGroup("Belief Roots", (item.beliefIds || []).slice(0, 120).map(beliefLink)));
    groups.push(relationGroup("Myths", (item.mythIds || []).slice(0, 120).map(mythLink)));
    groups.push(relationGroup("Doctrines", (item.doctrineIds || []).slice(0, 120).map(doctrineLink)));
    groups.push(relationGroup("Magic Roles", (item.magicRoleIds || []).slice(0, 120).map(magicRoleLink)));
    groups.push(relationGroup("Role Holders", (item.magicRoleHolderIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Open Prophecies", (item.openProphecyIds || []).slice(0, 120).map(prophecyLink)));
    groups.push(relationGroup("All Prophecies", (item.prophecyIds || []).slice(0, 120).map(prophecyLink)));
    groups.push(relationGroup("Active Kingdom Goals", (item.activeCivilizationGoalIds || []).slice(0, 120).map(civilizationGoalLink)));
    groups.push(relationGroup("All Kingdom Goals", (item.civilizationGoalIds || []).slice(0, 120).map(civilizationGoalLink)));
    groups.push(relationGroup("Sacred Sites", (item.sacredSiteIds || []).slice(0, 120).map(sacredSiteLink)));
    groups.push(relationGroup("Source Events", (item.sourceEventIds || []).slice(0, 80).map(eventLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
  } else if (kind === "offices") {
    if (item.holderAgentId != null) groups.push(relationGroup("Holder", [personLink(item.holderAgentId)]));
    if (item.settlementId != null) groups.push(relationGroup("Seat", [settlementLink(item.settlementId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    groups.push(relationGroup("Office Terms", (item.termIds || []).slice(0, 120).map(officeTermLink)));
    groups.push(relationGroup("Laws", data.laws.filter(law => law.officeId === item.id).slice(0, 60).map(law => lawLink(law.id))));
    groups.push(relationGroup("Cases", data.cases.filter(legalCase => legalCase.officeId === item.id).slice(0, 60).map(legalCase => caseLink(legalCase.id))));
    groups.push(relationGroup("Testimonies", testimoniesAbout("office", item.id, 80)));
    groups.push(relationGroup("Ambitions", data.ambitions.filter(ambition => ambition.officeId === item.id).slice(0, 60).map(ambition => ambitionLink(ambition.id))));
    groups.push(relationGroup("Careers", careersAbout("office", item.id, 60)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("office", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("office", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("office", item.id, 60)));
    groups.push(relationGroup("Schemes", schemesAbout("office", item.id, 60)));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("office", item.id, 60)));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("office", item.id, 80)));
    groups.push(relationGroup("Activities", activitiesAbout("office", item.id, 60)));
    groups.push(relationGroup("Projects", projectsAbout("office", item.id, 60)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("office", item.id, 80)));
    groups.push(relationGroup("Obligations", obligationsAbout("office", item.id, 60)));
    groups.push(relationGroup("Holdings", holdingsAbout("office", item.id, 60)));
    groups.push(relationGroup("Belongings", belongingsAbout("office", item.id, 60)));
  } else if (kind === "office-terms") {
    groups.push(relationGroup("Holder", [personLink(item.holderAgentId)]));
    groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.settlementId != null) groups.push(relationGroup("Seat", [settlementLink(item.settlementId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.startEventId != null) groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    const termLaws = data.laws.filter(law => law.officeId === item.officeId && (law.authorAgentId == null || law.authorAgentId === item.holderAgentId) && law.enactedYear >= item.startedYear && (item.endedYear == null || law.enactedYear <= item.endedYear)).slice(0, 60).map(law => lawLink(law.id));
    groups.push(relationGroup("Laws Enacted", termLaws));
    const termCases = data.cases.filter(legalCase => legalCase.officeId === item.officeId && legalCase.openedYear >= item.startedYear && (item.endedYear == null || legalCase.openedYear <= item.endedYear)).slice(0, 80).map(legalCase => caseLink(legalCase.id));
    groups.push(relationGroup("Cases Heard", termCases));
    groups.push(relationGroup("Careers", careersAbout("office-term", item.id, 40)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("office-term", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("office-term", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("office-term", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("office-term", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("office-term", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("office-term", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("office-term", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("office-term", item.id, 40)));
  } else if (kind === "laws") {
    groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    if (item.authorAgentId != null) groups.push(relationGroup("Author", [personLink(item.authorAgentId)]));
    if (item.settlementId != null) groups.push(relationGroup("Seat", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Cases", data.cases.filter(legalCase => legalCase.lawId === item.id).slice(0, 60).map(legalCase => caseLink(legalCase.id))));
    groups.push(relationGroup("Testimonies", testimoniesAbout("law", item.id, 80)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("law", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("law", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("law", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("law", item.id, 60)));
  } else if (kind === "cases") {
    groups.push(relationGroup("Accused", [personLink(item.accusedAgentId)]));
    if (item.victimAgentId != null) groups.push(relationGroup("Victim", [personLink(item.victimAgentId)]));
    groups.push(relationGroup("Witnesses", (item.witnessAgentIds || []).map(personLink)));
    groups.push(relationGroup("Testimonies", (item.testimonyIds || []).map(testimonyLink)));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    if (item.lawId != null) groups.push(relationGroup("Law", [lawLink(item.lawId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.estateId != null) groups.push(relationGroup("Estate", [estateLink(item.estateId)]));
    groups.push(relationGroup("Seat", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Injuries", data.injuries.filter(injury => injury.caseId === item.id).slice(0, 60).map(injury => injuryLink(injury.id))));
    groups.push(relationGroup("Projects", projectsAbout("case", item.id, 60)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("case", item.id, 80)));
    groups.push(relationGroup("Obligations", obligationsAbout("case", item.id, 60)));
    groups.push(relationGroup("Schemes", schemesAbout("case", item.id, 60)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("case", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("case", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("case", item.id, 60)));
  } else if (kind === "testimonies") {
    groups.push(relationGroup("Case", [caseLink(item.caseId)]));
    groups.push(relationGroup("Witness", [personLink(item.witnessAgentId)]));
    groups.push(relationGroup("Accused", [personLink(item.accusedAgentId)]));
    if (item.victimAgentId != null) groups.push(relationGroup("Victim", [personLink(item.victimAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Testimony Facts", [
      '<span class="ref">' + esc(item.kind) + '</span>',
      '<span class="ref">' + esc(item.stance) + '</span>',
      '<span class="ref">' + esc("credibility " + item.credibility) + '</span>',
      '<span class="ref">' + esc("pressure " + item.pressure) + '</span>',
      '<span class="ref">' + esc(years(item.year)) + '</span>'
    ]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    if (item.lawId != null) groups.push(relationGroup("Law", [lawLink(item.lawId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.rumorId != null) groups.push(relationGroup("Rumor", [rumorLink(item.rumorId)]));
    if (item.secretId != null) groups.push(relationGroup("Secret", [secretLink(item.secretId)]));
    if (item.conversationId != null) groups.push(relationGroup("Conversation", [conversationLink(item.conversationId)]));
    if (item.memoryId != null) groups.push(relationGroup("Memory", [memoryLink(item.memoryId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("testimony", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("testimony", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("testimony", item.id, 40)));
    groups.push(relationGroup("Recent Events", recentEventLinksFor(item, 10)));
  } else if (kind === "conflicts") {
    groups.push(relationGroup("Civilizations", [civLink(item.attackerCivilizationId), civLink(item.defenderCivilizationId)]));
    groups.push(relationGroup("Instigator", [civLink(item.instigatorCivilizationId)]));
    if (item.targetSettlementId != null) groups.push(relationGroup("Initial Target", [settlementLink(item.targetSettlementId)]));
    groups.push(relationGroup("Contested Places", (item.contestedSettlementIds || []).slice(0, 120).map(settlementLink)));
    groups.push(relationGroup("Battles", (item.battleIds || []).slice(0, 120).map(battleLink)));
    const conflictBattles = (item.battleIds || []).map(id => maps.battles.get(id)).filter(Boolean);
    const conflictUnitLinks = uniqueLinkList(conflictBattles.flatMap(battle => [...(battle.attackerUnitIds || []), ...(battle.defenderUnitIds || [])].map(militaryUnitLink)), 120);
    groups.push(relationGroup("Military Units", conflictUnitLinks));
    groups.push(relationGroup("Spy Operations", (item.spyOperationIds || []).slice(0, 120).map(spyOperationLink)));
    groups.push(relationGroup("Battle Roles", battleParticipationsAbout("conflict", item.id, 120)));
    groups.push(relationGroup("Casualties", (item.casualtyAgentIds || []).slice(0, 120).map(personLink)));
    groups.push(relationGroup("Captured Places", (item.capturedSettlementIds || []).slice(0, 80).map(settlementLink)));
    groups.push(relationGroup("Settlement Control", settlementControlsAbout("conflict", item.id, 80)));
    groups.push(relationGroup("Person Allegiances", personAllegiancesAbout("conflict", item.id, 80)));
    groups.push(relationGroup("Captured Artifacts", (item.capturedArtifactIds || []).slice(0, 80).map(artifactLink)));
    if (item.startedEventId != null) groups.push(relationGroup("Start Event", [eventLink(item.startedEventId)]));
    if (item.endedEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endedEventId)]));
    groups.push(relationGroup("Chronicles", chroniclesAbout("conflict", item.id, 80)));
    groups.push(relationGroup("Memories", memoriesAbout("conflict", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("conflict", item.id, 80)));
    groups.push(relationGroup("Rumors", rumorsAbout("conflict", item.id, 80)));
    groups.push(relationGroup("Secrets", secretsAbout("conflict", item.id, 60)));
    groups.push(relationGroup("Feuds", feudsAbout("conflict", item.id, 60)));
    groups.push(relationGroup("Oaths", oathsAbout("conflict", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("conflict", item.id, 60)));
  } else if (kind === "battles") {
    if (item.conflictId != null) groups.push(relationGroup("Conflict", [conflictLink(item.conflictId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Battlefield", [
      '<span class="ref">' + esc(item.battlefieldName || settlementName(item.settlementId)) + '</span>',
      '<span class="ref">' + esc((item.battlefieldTerrain || "unknown").replace(/-/g, " ")) + '</span>',
      item.battlefieldX == null || item.battlefieldY == null ? "" : '<span class="ref">' + esc("map " + item.battlefieldX + ", " + item.battlefieldY) + '</span>',
      item.battlefieldTriangle == null ? "" : '<span class="ref">' + esc("triangle " + item.battlefieldTriangle) + '</span>'
    ].filter(Boolean)));
    groups.push(relationGroup("Civilizations", [civLink(item.attackerCivilizationId), civLink(item.defenderCivilizationId)]));
    const commanders = [item.attackerCommanderId, item.defenderCommanderId].filter(id => id != null).map(personLink);
    groups.push(relationGroup("Commanders", commanders));
    groups.push(relationGroup("Attacker Units", (item.attackerUnitIds || []).slice(0, 80).map(militaryUnitLink)));
    groups.push(relationGroup("Defender Units", (item.defenderUnitIds || []).slice(0, 80).map(militaryUnitLink)));
    groups.push(relationGroup("Spy Operations", (item.spyOperationIds || []).slice(0, 80).map(spyOperationLink)));
    groups.push(relationGroup("Participant Records", (item.battleParticipationIds || []).slice(0, 160).map(battleParticipationLink)));
    groups.push(relationGroup("Attackers", (item.attackerParticipantIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Defenders", (item.defenderParticipantIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Casualties", (item.casualtyAgentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Settlement Control", settlementControlsAbout("battle", item.id, 40)));
    groups.push(relationGroup("Person Allegiances", personAllegiancesAbout("battle", item.id, 80)));
    groups.push(relationGroup("Battle Roles", battleParticipationsAbout("battle", item.id, 160)));
    groups.push(relationGroup("Injuries", data.injuries.filter(injury => injury.battleId === item.id).slice(0, 80).map(injury => injuryLink(injury.id))));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("battle", item.id, 80)));
    groups.push(relationGroup("Memorials", data.memorials.filter(memorial => memorial.battleId === item.id).slice(0, 80).map(memorial => memorialLink(memorial.id))));
    groups.push(relationGroup("Burials", burialsAbout("battle", item.id, 80)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("battle", item.id, 80)));
    groups.push(relationGroup("Captured Artifacts", (item.capturedArtifactIds || []).map(artifactLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("battle", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("battle", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("battle", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("battle", item.id, 60)));
  } else if (kind === "battle-participations") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    if (item.conflictId != null) groups.push(relationGroup("Conflict", [conflictLink(item.conflictId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Side Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Opposing Civilization", [civLink(item.opposingCivilizationId)]));
    groups.push(relationGroup("Injuries", (item.injuryIds || []).slice(0, 40).map(injuryLink)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("battle-participation", item.id, 40)));
    if (item.battleEventId != null) groups.push(relationGroup("Battle Event", [eventLink(item.battleEventId)]));
    if (item.casualtyEventId != null) groups.push(relationGroup("Casualty Event", [eventLink(item.casualtyEventId)]));
    groups.push(relationGroup("Death Records", deathRecordsAbout("battle-participation", item.id, 20)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("battle-participation", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("battle-participation", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("battle-participation", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("battle-participation", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("battle-participation", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("battle-participation", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("battle-participation", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("battle-participation", item.id, 40)));
  } else if (kind === "military-units") {
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Settlement", [settlementLink(item.settlementId)]));
    if (item.commanderAgentId != null) groups.push(relationGroup("Commander", [personLink(item.commanderAgentId)]));
    groups.push(relationGroup("Troops", (item.troopAgentIds || []).slice(0, 120).map(personLink)));
    groups.push(relationGroup("Equipment", (item.equipmentCacheIds || []).slice(0, 80).map(equipmentCacheLink)));
    groups.push(relationGroup("Battles", (item.battleIds || []).slice(0, 80).map(battleLink)));
    groups.push(relationGroup("Spy Operations", (item.spyOperationIds || []).slice(0, 80).map(spyOperationLink)));
    if (item.formedEventId != null) groups.push(relationGroup("Formation Event", [eventLink(item.formedEventId)]));
    if (item.disbandedEventId != null) groups.push(relationGroup("Disbanded Event", [eventLink(item.disbandedEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Records and Echoes", recordEchoLinks("military-unit", item.id, 40)));
  } else if (kind === "equipment-caches") {
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Settlement", [settlementLink(item.settlementId)]));
    if (item.unitId != null) groups.push(relationGroup("Military Unit", [militaryUnitLink(item.unitId)]));
    if (item.sourceEventId != null) groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Records and Echoes", recordEchoLinks("equipment-cache", item.id, 40)));
  } else if (kind === "spy-networks") {
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Origin", [settlementLink(item.settlementId)]));
    if (item.targetSettlementId != null) groups.push(relationGroup("Target Settlement", [settlementLink(item.targetSettlementId)]));
    if (item.targetCivilizationId != null) groups.push(relationGroup("Target Civilization", [civLink(item.targetCivilizationId)]));
    if (item.handlerAgentId != null) groups.push(relationGroup("Handler", [personLink(item.handlerAgentId)]));
    groups.push(relationGroup("Agents", (item.agentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Operations", (item.operationIds || []).slice(0, 120).map(spyOperationLink)));
    if (item.formedEventId != null) groups.push(relationGroup("Formation Event", [eventLink(item.formedEventId)]));
    if (item.exposedEventId != null) groups.push(relationGroup("Exposed Event", [eventLink(item.exposedEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Records and Echoes", recordEchoLinks("spy-network", item.id, 40)));
  } else if (kind === "spy-operations") {
    groups.push(relationGroup("Network", [spyNetworkLink(item.networkId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.targetSettlementId != null) groups.push(relationGroup("Target Settlement", [settlementLink(item.targetSettlementId)]));
    if (item.targetCivilizationId != null) groups.push(relationGroup("Target Civilization", [civLink(item.targetCivilizationId)]));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    if (item.conflictId != null) groups.push(relationGroup("Conflict", [conflictLink(item.conflictId)]));
    groups.push(relationGroup("Agents", (item.agentIds || []).slice(0, 80).map(personLink)));
    if (item.sourceEventId != null) groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Records and Echoes", recordEchoLinks("spy-operation", item.id, 40)));
  } else if (kind === "injuries") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    groups.push(relationGroup("Battle Roles", battleParticipationsAbout("injury", item.id, 20)));
    if (item.caseId != null) groups.push(relationGroup("Case", [caseLink(item.caseId)]));
    if (item.healerAgentId != null) groups.push(relationGroup("Healer", [personLink(item.healerAgentId)]));
    groups.push(relationGroup("Care Records", (item.careRecordIds || []).slice(0, 80).map(careRecordLink)));
    groups.push(relationGroup("Illness Cases", illnessesAbout("injury", item.id, 20)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("injury", item.id, 40)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("injury", item.id, 40)));
    groups.push(relationGroup("Projects", projectsAbout("injury", item.id, 60)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("injury", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("injury", item.id, 60)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("injury", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("injury", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("injury", item.id, 40)));
  } else if (kind === "illnesses") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Injury Record", [injuryLink(item.injuryId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Sickbed", [structureLink(item.structureId)]));
    if (item.healerAgentId != null) groups.push(relationGroup("Healer", [personLink(item.healerAgentId)]));
    groups.push(relationGroup("Care Records", (item.careRecordIds || []).slice(0, 80).map(careRecordLink)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("illness", item.id, 40)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("illness", item.id, 40)));
    groups.push(relationGroup("Symptoms", (item.symptoms || []).map(value => '<span class="ref">' + esc(value) + '</span>')));
    groups.push(relationGroup("Onset Event", [eventLink(item.onsetEventId)]));
    if (item.resolvedEventId != null) groups.push(relationGroup("Resolution Event", [eventLink(item.resolvedEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("illness", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("illness", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("illness", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("illness", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("illness", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("illness", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("illness", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("illness", item.id, 40)));
  } else if (kind === "care-records") {
    groups.push(relationGroup("Patient", [personLink(item.patientAgentId)]));
    if (item.healerAgentId != null) groups.push(relationGroup("Healer", [personLink(item.healerAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Care Site", [structureLink(item.structureId)]));
    groups.push(relationGroup("Medical Record", [
      injuryLink(item.injuryId),
      item.illnessId == null ? "" : illnessLink(item.illnessId),
      eventLink(item.sourceEventId)
    ].filter(Boolean)));
    groups.push(relationGroup("Care Facts", [
      '<span class="ref">' + esc(item.kind) + '</span>',
      '<span class="ref">' + esc(item.outcome) + '</span>',
      '<span class="ref">' + esc("health " + item.healthDelta) + '</span>',
      '<span class="ref">' + esc("morale " + item.moraleDelta) + '</span>',
      '<span class="ref">' + esc("healer skill " + item.healerSkillDelta) + '</span>',
      '<span class="ref">' + esc(years(item.year)) + '</span>'
    ]));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("care-record", item.id, 40)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("care-record", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("care-record", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("care-record", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("care-record", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("care-record", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("care-record", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("care-record", item.id, 40)));
  } else if (kind === "wound-legacies") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.healerAgentId != null) groups.push(relationGroup("Healer", [personLink(item.healerAgentId)]));
    groups.push(relationGroup("Source Medical Record", [
      injuryLink(item.injuryId),
      item.illnessId == null ? "" : illnessLink(item.illnessId),
      item.careRecordId == null ? "" : careRecordLink(item.careRecordId),
      eventLink(item.sourceEventId)
    ].filter(Boolean)));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    if (item.battleParticipationId != null) groups.push(relationGroup("Battle Role", [battleParticipationLink(item.battleParticipationId)]));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("wound-legacy", item.id, 40)));
    groups.push(relationGroup("Lasting Effects", [
      '<span class="ref">' + esc(item.kind) + '</span>',
      '<span class="ref">' + esc(item.severity) + '</span>',
      '<span class="ref">' + esc("health " + item.healthImpact) + '</span>',
      '<span class="ref">' + esc("stress " + item.stressImpact) + '</span>',
      '<span class="ref">' + esc("reputation " + item.reputationImpact) + '</span>',
      '<span class="ref">' + esc(years(item.year)) + '</span>'
    ]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("wound-legacy", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("wound-legacy", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("wound-legacy", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("wound-legacy", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("wound-legacy", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("wound-legacy", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("wound-legacy", item.id, 40)));
  } else if (kind === "memorials") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    groups.push(relationGroup("Death Records", deathRecordsAbout("memorial", item.id, 40)));
    groups.push(relationGroup("Burials", burialsAbout("memorial", item.id, 40)));
    groups.push(relationGroup("Ambitions", data.ambitions.filter(ambition => ambition.memorialId === item.id).slice(0, 60).map(ambition => ambitionLink(ambition.id))));
    groups.push(relationGroup("Chronicles", chroniclesAbout("memorial", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("memorial", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("memorial", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("memorial", item.id, 60)));
  } else if (kind === "burials") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.lineageId != null) groups.push(relationGroup("Lineage", [lineageLink(item.lineageId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    if (item.memorialId != null) groups.push(relationGroup("Memorial", [memorialLink(item.memorialId)]));
    groups.push(relationGroup("Source Death", [eventLink(item.deathEventId)]));
    groups.push(relationGroup("Death Records", deathRecordsAbout("burial", item.id, 20)));
    groups.push(relationGroup("Mourners", (item.mournerAgentIds || []).slice(0, 40).map(personLink)));
    groups.push(relationGroup("Grave Goods", [
      ...(item.graveGoodArtifactIds || []).slice(0, 40).map(artifactLink),
      ...(item.graveGoodBelongingIds || []).slice(0, 40).map(belongingLink)
    ]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("burial", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("burial", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("burial", item.id, 60)));
  } else if (kind === "death-records") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.lineageId != null) groups.push(relationGroup("Lineage", [lineageLink(item.lineageId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    groups.push(relationGroup("Cause Record", [
      '<span class="ref">' + esc(item.kind + " death") + '</span>',
      '<span class="ref">' + esc("age " + item.age) + '</span>',
      eventLink(item.sourceEventId),
      item.battleId == null ? "" : battleLink(item.battleId),
      item.battleParticipationId == null ? "" : battleParticipationLink(item.battleParticipationId)
    ].filter(Boolean)));
    groups.push(relationGroup("Fatal Health Records", [
      ...(item.injuryIds || []).slice(0, 40).map(injuryLink),
      ...(item.illnessIds || []).slice(0, 40).map(illnessLink)
    ]));
    groups.push(relationGroup("Aftermath", [
      item.memorialId == null ? "" : memorialLink(item.memorialId),
      item.burialId == null ? "" : burialLink(item.burialId),
      item.estateId == null ? "" : estateLink(item.estateId)
    ].filter(Boolean)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("death-record", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("death-record", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("death-record", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("death-record", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("death-record", item.id, 40)));
  } else if (kind === "ambitions") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.sourceMemoryId != null) groups.push(relationGroup("Source Memory", [memoryLink(item.sourceMemoryId)]));
    if (item.personalityShiftId != null) groups.push(relationGroup("Source Personality Shift", [personalityShiftLink(item.personalityShiftId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    if (item.artifactId != null) groups.push(relationGroup("Artifact", [artifactLink(item.artifactId)]));
    if (item.journeyId != null) groups.push(relationGroup("Journey", [journeyLink(item.journeyId)]));
    if (item.memorialId != null) groups.push(relationGroup("Memorial", [memorialLink(item.memorialId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.mythId != null) groups.push(relationGroup("Myth", [mythLink(item.mythId)]));
    if (item.doctrineId != null) groups.push(relationGroup("Doctrine", [doctrineLink(item.doctrineId)]));
    if (item.magicRoleId != null) groups.push(relationGroup("Magic Role", [magicRoleLink(item.magicRoleId)]));
    if (item.prophecyId != null) groups.push(relationGroup("Prophecy", [prophecyLink(item.prophecyId)]));
    if (item.civilizationGoalId != null) groups.push(relationGroup("Civilization Goal", [civilizationGoalLink(item.civilizationGoalId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("ambition", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("ambition", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("ambition", item.id, 40)));
    groups.push(relationGroup("Schemes", schemesAbout("ambition", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("ambition", item.id, 40)));
  } else if (kind === "apprenticeships") {
    groups.push(relationGroup("Mentor", [personLink(item.mentorAgentId)]));
    groups.push(relationGroup("Apprentice", [personLink(item.apprenticeAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.relationshipId != null) groups.push(relationGroup("Relationship", [relationshipLink(item.relationshipId)]));
    if (item.lineageId != null) groups.push(relationGroup("Lineage", [lineageLink(item.lineageId)]));
    groups.push(relationGroup("Chronicles", chroniclesAbout("apprenticeship", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("apprenticeship", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("apprenticeship", item.id, 40)));
    groups.push(relationGroup("Skills", skillsAbout("apprenticeship", item.id, 40)));
    groups.push(relationGroup("Teachings", teachingsAbout("apprenticeship", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("apprenticeship", item.id, 40)));
  } else if (kind === "skills") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Source Events", (item.sourceEventIds || []).slice(0, 80).map(eventLink)));
    groups.push(relationGroup("Projects", (item.projectIds || []).slice(0, 80).map(projectLink)));
    groups.push(relationGroup("Apprenticeships", (item.apprenticeshipIds || []).slice(0, 80).map(apprenticeshipLink)));
    groups.push(relationGroup("Teachings", teachingsAbout("skill", item.id, 80)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("skill", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("skill", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("skill", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("skill", item.id, 40)));
  } else if (kind === "residences") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("residence", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("residence", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("residence", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("residence", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("residence", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("residence", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("residence", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("residence", item.id, 40)));
  } else if (kind === "careers") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Workplace", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Age Milestones", ageMilestonesAbout("career", item.id, 40)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("career", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("career", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("career", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("career", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("career", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("career", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("career", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("career", item.id, 40)));
  } else if (kind === "journeys") {
    groups.push(relationGroup("Route", [settlementLink(item.fromSettlementId), settlementLink(item.toSettlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Natural Features", naturalFeaturesAbout("journey", item.id, 40)));
    const structures = [item.originStructureId, item.destinationStructureId].filter(id => id != null).map(structureLink);
    groups.push(relationGroup("Structures", structures));
    groups.push(relationGroup("Roads", (item.roadIds || []).map(roadLink)));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.sacredSiteId != null) groups.push(relationGroup("Sacred Site", [sacredSiteLink(item.sacredSiteId)]));
    groups.push(relationGroup("Travelers", (item.participantAgentIds || []).slice(0, 100).map(personLink)));
    groups.push(relationGroup("Artifacts Carried", (item.artifactIds || []).map(artifactLink)));
    groups.push(relationGroup("Ambitions", data.ambitions.filter(ambition => ambition.journeyId === item.id).slice(0, 60).map(ambition => ambitionLink(ambition.id))));
    groups.push(relationGroup("Chronicles", chroniclesAbout("journey", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("journey", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("journey", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("journey", item.id, 60)));
  } else if (kind === "roads") {
    groups.push(relationGroup("Route", [settlementLink(item.fromSettlementId), settlementLink(item.toSettlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Natural Features", [
      ...naturalFeaturesAbout("settlement", item.fromSettlementId, 20),
      ...naturalFeaturesAbout("settlement", item.toSettlementId, 20)
    ]));
    groups.push(relationGroup("Journeys", data.journeys
      .filter(journey =>
        (journey.roadIds || []).includes(item.id) ||
        (journey.fromSettlementId === item.fromSettlementId && journey.toSettlementId === item.toSettlementId) ||
        (journey.fromSettlementId === item.toSettlementId && journey.toSettlementId === item.fromSettlementId)
      )
      .slice(0, 80)
      .map(journey => journeyLink(journey.id))));
  } else if (kind === "relationships") {
    groups.push(relationGroup("People", (item.agentIds || []).map(personLink)));
    groups.push(relationGroup("Bond State", relationshipFacetPills(item)));
    groups.push(relationGroup("Home", [settlementLink(item.settlementId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.lastInteractionEventId != null) groups.push(relationGroup("Last Interaction", [eventLink(item.lastInteractionEventId)]));
    groups.push(relationGroup("Milestones", (item.milestoneIds || []).slice(0, 120).map(relationshipMilestoneLink)));
    groups.push(relationGroup("Apprenticeships", data.apprenticeships.filter(apprenticeship => apprenticeship.relationshipId === item.id).slice(0, 20).map(apprenticeship => apprenticeshipLink(apprenticeship.id))));
    groups.push(relationGroup("Chronicles", chroniclesAbout("relationship", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("relationship", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("relationship", item.id, 40)));
    groups.push(relationGroup("Claims", socialClaimsAbout("relationship", item.id, 40)));
    groups.push(relationGroup("Conversations", conversationsAbout("relationship", item.id, 80)));
    groups.push(relationGroup("Obligations", obligationsAbout("relationship", item.id, 60)));
  } else if (kind === "relationship-milestones") {
    groups.push(relationGroup("Relationship", [relationshipLink(item.relationshipId)]));
    groups.push(relationGroup("People", (item.agentIds || []).map(personLink)));
    groups.push(relationGroup("Bond State", [
      factPill(item.status),
      factPill("strength " + item.strength),
      factPill("affinity " + bondValue(item.affinity, 0).toFixed(3)),
      factPill("trust " + bondValue(item.trust, 0).toFixed(3)),
      factPill("tension " + bondValue(item.tension, 0).toFixed(3)),
      factPill("familiarity " + bondValue(item.familiarity, 0).toFixed(3)),
      factPill(years(item.year))
    ]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId), civLink(item.civilizationId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    groups.push(relationGroup("Cause", [
      eventLink(item.sourceEventId),
      item.socialClaimId == null ? "" : socialClaimLink(item.socialClaimId),
      item.conversationId == null ? "" : conversationLink(item.conversationId)
    ].filter(Boolean)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Social Echoes", recordEchoLinks("relationship-milestone", item.id, 16)));
    groups.push(relationGroup("Recent Events", recentEventLinksFor(item, 8)));
  } else if (kind === "unions") {
    groups.push(relationGroup("Partners", (item.partnerAgentIds || []).map(personLink)));
    groups.push(relationGroup("Children", (item.childAgentIds || []).slice(0, 120).map(personLink)));
    groups.push(relationGroup("Births", birthsAbout("union", item.id, 120)));
    groups.push(relationGroup("Home", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Residence", [structureLink(item.structureId)]));
    groups.push(relationGroup("Lineages", (item.lineageIds || []).map(lineageLink)));
    if (item.startEventId != null) groups.push(relationGroup("Start Event", [eventLink(item.startEventId)]));
    if (item.endEventId != null) groups.push(relationGroup("End Event", [eventLink(item.endEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("union", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("union", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("union", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("union", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("union", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("union", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("union", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("union", item.id, 40)));
  } else if (kind === "artifacts") {
    groups.push(relationGroup("Creator", [personLink(item.creatorAgentId)]));
    groups.push(relationGroup("Holder", [item.ownerAgentId == null ? settlementLink(item.ownerSettlementId) : personLink(item.ownerAgentId)]));
    groups.push(relationGroup("Condition Records", artifactConditionRecordLinks(item, 80)));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    const sacredSiteLinks = Array.from(new Set((item.provenance || [])
      .filter(entry => entry.sacredSiteId != null)
      .map(entry => sacredSiteLink(entry.sacredSiteId))));
    groups.push(relationGroup("Sacred Sites", sacredSiteLinks));
    const artifactBattles = data.battles.filter(battle => (battle.capturedArtifactIds || []).includes(item.id)).slice(0, 40).map(battle => battleLink(battle.id));
    groups.push(relationGroup("Battles", artifactBattles));
    groups.push(relationGroup("Conflicts", conflictsAbout("artifact", item.id, 40)));
    const artifactJourneys = data.journeys.filter(journey => (journey.artifactIds || []).includes(item.id)).slice(0, 40).map(journey => journeyLink(journey.id));
    groups.push(relationGroup("Journeys", artifactJourneys));
    groups.push(relationGroup("Ambitions", data.ambitions.filter(ambition => ambition.artifactId === item.id).slice(0, 60).map(ambition => ambitionLink(ambition.id))));
    groups.push(relationGroup("Chronicles", chroniclesAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Secrets", secretsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Feuds", feudsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Oaths", data.oaths.filter(oath => oath.targetArtifactId === item.id || (oath.subjectRefs || []).some(ref => ref.kind === "artifact" && ref.id === item.id)).slice(0, 60).map(oath => oathLink(oath.id))));
    groups.push(relationGroup("Ceremonies", ceremoniesAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Projects", projectsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("artifact", item.id, 80)));
    groups.push(relationGroup("Burials", burialsAbout("artifact", item.id, 60)));
    groups.push(relationGroup("Estates", data.estates.filter(estate => (estate.artifactIds || []).includes(item.id)).slice(0, 60).map(estate => estateLink(estate.id))));
  } else if (kind === "artifact-conditions") {
    groups.push(relationGroup("Artifact", [artifactLink(item.artifactId)]));
    groups.push(relationGroup("Condition", [
      factPill(item.kind),
      factPill(item.condition),
      factPill("severity " + item.severity),
      factPill(years(item.year))
    ]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId), civLink(item.civilizationId)]));
    if (item.actorAgentId != null) groups.push(relationGroup("Actor", [personLink(item.actorAgentId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.projectId != null) groups.push(relationGroup("Project", [projectLink(item.projectId)]));
    if (item.battleId != null) groups.push(relationGroup("Battle", [battleLink(item.battleId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Recent Events", recentEventLinksFor(item, 8)));
  } else if (kind === "chronicles") {
    groups.push(relationGroup("Author", [personLink(item.authorAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    groups.push(relationGroup("Source Events", (item.sourceEventIds || []).map(eventLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Written Works Citing This", writtenWorksAbout("chronicle", item.id, 60)));
    groups.push(relationGroup("Memories", memoriesAbout("chronicle", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("chronicle", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("chronicle", item.id, 60)));
    groups.push(relationGroup("Secrets", secretsAbout("chronicle", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("chronicle", item.id, 40)));
  } else if (kind === "written-works") {
    groups.push(relationGroup("Author", [personLink(item.authorAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.sourceChronicleId != null) groups.push(relationGroup("Source Chronicle", [chronicleLink(item.sourceChronicleId)]));
    groups.push(relationGroup("Source Events", (item.sourceEventIds || []).map(eventLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Traditions", traditionsAbout("written-work", item.id, 60)));
    groups.push(relationGroup("Teachings Using This", teachingsAbout("written-work", item.id, 80)));
    groups.push(relationGroup("Physical Copies", belongingsAbout("written-work", item.id, 60)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("written-work", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("written-work", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("written-work", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("written-work", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("written-work", item.id, 60)));
    groups.push(relationGroup("Secrets", secretsAbout("written-work", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("written-work", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("written-work", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("written-work", item.id, 40)));
  } else if (kind === "memories") {
    groups.push(relationGroup("Remembered By", [personLink(item.agentId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Place", item.settlementId == null ? [] : [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("memory", item.id, 60)));
    groups.push(relationGroup("Personality Shifts", personalityShiftsAbout("memory", item.id, 40)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("memory", item.id, 40)));
    groups.push(relationGroup("Opinions Formed", opinionsAbout("memory", item.id, 60)));
    groups.push(relationGroup("Claims Formed", socialClaimsAbout("memory", item.id, 60)));
    groups.push(relationGroup("Conversations", conversationsAbout("memory", item.id, 60)));
    groups.push(relationGroup("Testimonies", testimoniesAbout("memory", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("memory", item.id, 60)));
    groups.push(relationGroup("Secrets", secretsAbout("memory", item.id, 60)));
    groups.push(relationGroup("Obligations", obligationsAbout("memory", item.id, 40)));
  } else if (kind === "thoughts") {
    groups.push(relationGroup("Held By", [personLink(item.agentId)]));
    if (item.sourceMemoryId != null) groups.push(relationGroup("Source Memory", [memoryLink(item.sourceMemoryId)]));
    if (item.sourceEventId != null) groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.activityId != null) groups.push(relationGroup("Activity", [activityLink(item.activityId)]));
    if (item.ceremonyId != null) groups.push(relationGroup("Ceremony", [ceremonyLink(item.ceremonyId)]));
    if (item.preferenceId != null) groups.push(relationGroup("Preference", [preferenceLink(item.preferenceId)]));
    if (item.traditionId != null) groups.push(relationGroup("Tradition", [traditionLink(item.traditionId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("thought", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("thought", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("thought", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("thought", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("thought", item.id, 40)));
  } else if (kind === "personality-shifts") {
    groups.push(relationGroup("Changed Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Source Memory", [memoryLink(item.sourceMemoryId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Ambitions Started", ambitionsAbout("personality-shift", item.id, 40)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("personality-shift", item.id, 40)));
    groups.push(relationGroup("Written Works", writtenWorksAbout("personality-shift", item.id, 40)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("personality-shift", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("personality-shift", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("personality-shift", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("personality-shift", item.id, 40)));
  } else if (kind === "need-episodes") {
    groups.push(relationGroup("Person", [personLink(item.personId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.sourceEventId != null) groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.resolvedEventId != null) groups.push(relationGroup("Resolution Event", [eventLink(item.resolvedEventId)]));
    if (item.sourceMemoryId != null) groups.push(relationGroup("Source Memory", [memoryLink(item.sourceMemoryId)]));
    if (item.sourcePersonalityShiftId != null) groups.push(relationGroup("Source Personality Shift", [personalityShiftLink(item.sourcePersonalityShiftId)]));
    if (item.lastActivityId != null) groups.push(relationGroup("Last Activity", [activityLink(item.lastActivityId)]));
    if (item.lastCeremonyId != null) groups.push(relationGroup("Last Ceremony", [ceremonyLink(item.lastCeremonyId)]));
    if (item.lastThoughtId != null) groups.push(relationGroup("Last Thought", [thoughtLink(item.lastThoughtId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Memories", memoriesAbout("need-episode", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("need-episode", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("need-episode", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("need-episode", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("need-episode", item.id, 40)));
  } else if (kind === "opinions") {
    groups.push(relationGroup("Held By", [personLink(item.agentId)]));
    groups.push(relationGroup("Target", item.targetRef == null ? [] : [refLink(item.targetRef)]));
    groups.push(relationGroup("Source Memory", [memoryLink(item.sourceMemoryId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Claims", socialClaimsAbout("opinion", item.id, 40)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("opinion", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("opinion", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("opinion", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("opinion", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("opinion", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("opinion", item.id, 40)));
  } else if (kind === "social-claims") {
    groups.push(relationGroup("Holder", [personLink(item.agentId)]));
    groups.push(relationGroup("Target", [personLink(item.targetAgentId)]));
    groups.push(relationGroup("Source Opinion", [opinionLink(item.sourceOpinionId)]));
    groups.push(relationGroup("Source Memory", [memoryLink(item.sourceMemoryId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.relationshipId != null) groups.push(relationGroup("Relationship", [relationshipLink(item.relationshipId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("social-claim", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("social-claim", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("social-claim", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("social-claim", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("social-claim", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("social-claim", item.id, 40)));
    groups.push(relationGroup("Relationship Milestones", relationshipMilestonesAbout("social-claim", item.id, 40)));
  } else if (kind === "conversations") {
    groups.push(relationGroup("Speaker", [personLink(item.speakerAgentId)]));
    groups.push(relationGroup("Listener", [personLink(item.listenerAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Conversation Facts", [
      '<span class="ref">' + esc(item.kind) + '</span>',
      '<span class="ref">' + esc("tone " + item.tone) + '</span>',
      '<span class="ref">' + esc(years(item.year)) + '</span>'
    ]));
    if (item.relationshipId != null) groups.push(relationGroup("Relationship", [relationshipLink(item.relationshipId)]));
    if (item.activityId != null) groups.push(relationGroup("Activity", [activityLink(item.activityId)]));
    if (item.teachingId != null) groups.push(relationGroup("Teaching", [teachingLink(item.teachingId)]));
    if (item.rumorId != null) groups.push(relationGroup("Rumor", [rumorLink(item.rumorId)]));
    if (item.secretId != null) groups.push(relationGroup("Secret", [secretLink(item.secretId)]));
    if (item.memoryId != null) groups.push(relationGroup("Memory", [memoryLink(item.memoryId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.traditionId != null) groups.push(relationGroup("Tradition", [traditionLink(item.traditionId)]));
    if (item.artifactId != null) groups.push(relationGroup("Artifact", [artifactLink(item.artifactId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("conversation", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("conversation", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("conversation", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("conversation", item.id, 40)));
    groups.push(relationGroup("Testimonies", testimoniesAbout("conversation", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("conversation", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("conversation", item.id, 40)));
    groups.push(relationGroup("Relationship Milestones", relationshipMilestonesAbout("conversation", item.id, 40)));
    groups.push(relationGroup("Recent Events", recentEventLinksFor(item, 10)));
  } else if (kind === "rumors") {
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Origin", [settlementLink(item.originSettlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.tellerAgentId != null) groups.push(relationGroup("First Teller", [personLink(item.tellerAgentId)]));
    groups.push(relationGroup("Spread Places", (item.spreadSettlementIds || []).slice(0, 80).map(settlementLink)));
    groups.push(relationGroup("Spread By", (item.spreadAgentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Conversations", conversationsAbout("rumor", item.id, 80)));
    groups.push(relationGroup("Testimonies", testimoniesAbout("rumor", item.id, 40)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("rumor", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("rumor", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("rumor", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("rumor", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("rumor", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("rumor", item.id, 40)));
  } else if (kind === "secrets") {
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.revealedEventId != null) groups.push(relationGroup("Reveal Event", [eventLink(item.revealedEventId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Keepers", (item.keeperAgentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("secret", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("secret", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("secret", item.id, 40)));
    groups.push(relationGroup("Conversations", conversationsAbout("secret", item.id, 80)));
    groups.push(relationGroup("Testimonies", testimoniesAbout("secret", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("secret", item.id, 40)));
    groups.push(relationGroup("Schemes", schemesAbout("secret", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("secret", item.id, 40)));
    groups.push(relationGroup("Oaths", data.oaths.filter(oath => oath.targetSecretId === item.id || (oath.subjectRefs || []).some(ref => ref.kind === "secret" && ref.id === item.id)).slice(0, 60).map(oath => oathLink(oath.id))));
    groups.push(relationGroup("Obligations", obligationsAbout("secret", item.id, 40)));
  } else if (kind === "schemes") {
    groups.push(relationGroup("Leader", [personLink(item.leaderAgentId)]));
    groups.push(relationGroup("Conspirators", (item.conspiratorAgentIds || []).slice(0, 80).map(personLink)));
    if (item.targetAgentId != null) groups.push(relationGroup("Target Person", [personLink(item.targetAgentId)]));
    if (item.targetOfficeId != null) groups.push(relationGroup("Target Office", [officeLink(item.targetOfficeId)]));
    if (item.targetCaseId != null) groups.push(relationGroup("Target Case", [caseLink(item.targetCaseId)]));
    if (item.targetSecretId != null) groups.push(relationGroup("Target Secret", [secretLink(item.targetSecretId)]));
    if (item.targetAmbitionId != null) groups.push(relationGroup("Target Ambition", [ambitionLink(item.targetAmbitionId)]));
    if (item.targetFeudId != null) groups.push(relationGroup("Target Feud", [feudLink(item.targetFeudId)]));
    if (item.targetProphecyId != null) groups.push(relationGroup("Target Prophecy", [prophecyLink(item.targetProphecyId)]));
    if (item.targetCivilizationGoalId != null) groups.push(relationGroup("Target Civilization Goal", [civilizationGoalLink(item.targetCivilizationGoalId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.sourceEventId != null) groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.resolvedEventId != null) groups.push(relationGroup("Resolution Event", [eventLink(item.resolvedEventId)]));
    groups.push(relationGroup("Measures", [
      '<span class="ref">' + esc("secrecy " + item.secrecy) + '</span>',
      '<span class="ref">' + esc("progress " + item.progress) + '</span>',
      '<span class="ref">' + esc("heat " + item.heat) + '</span>'
    ]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("scheme", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("scheme", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("scheme", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("scheme", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("scheme", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("scheme", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("scheme", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("scheme", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("scheme", item.id, 40)));
  } else if (kind === "feuds") {
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.settledEventId != null) groups.push(relationGroup("Settlement Event", [eventLink(item.settledEventId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Side A", (item.sideAAgentIds || []).map(personLink)));
    groups.push(relationGroup("Side B", (item.sideBAgentIds || []).map(personLink)));
    groups.push(relationGroup("Households", (item.householdIds || []).map(householdLink)));
    groups.push(relationGroup("Lineages", (item.lineageIds || []).map(lineageLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("feud", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("feud", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("feud", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("feud", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("feud", item.id, 40)));
    groups.push(relationGroup("Schemes", schemesAbout("feud", item.id, 40)));
    groups.push(relationGroup("Oaths", data.oaths.filter(oath => oath.targetFeudId === item.id || (oath.subjectRefs || []).some(ref => ref.kind === "feud" && ref.id === item.id)).slice(0, 60).map(oath => oathLink(oath.id))));
    groups.push(relationGroup("Obligations", obligationsAbout("feud", item.id, 40)));
  } else if (kind === "oaths") {
    groups.push(relationGroup("Swearer", [personLink(item.swearerAgentId)]));
    groups.push(relationGroup("Witnesses", (item.witnessAgentIds || []).map(personLink)));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.resolvedEventId != null) groups.push(relationGroup("Resolution Event", [eventLink(item.resolvedEventId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.targetAgentId != null) groups.push(relationGroup("Target Person", [personLink(item.targetAgentId)]));
    if (item.targetSettlementId != null) groups.push(relationGroup("Target Place", [settlementLink(item.targetSettlementId)]));
    if (item.targetArtifactId != null) groups.push(relationGroup("Target Artifact", [artifactLink(item.targetArtifactId)]));
    if (item.targetFeudId != null) groups.push(relationGroup("Target Feud", [feudLink(item.targetFeudId)]));
    if (item.targetSecretId != null) groups.push(relationGroup("Target Secret", [secretLink(item.targetSecretId)]));
    if (item.targetBeliefId != null) groups.push(relationGroup("Target Belief", [beliefLink(item.targetBeliefId)]));
    if (item.targetProphecyId != null) groups.push(relationGroup("Target Prophecy", [prophecyLink(item.targetProphecyId)]));
    if (item.targetCivilizationGoalId != null) groups.push(relationGroup("Target Civilization Goal", [civilizationGoalLink(item.targetCivilizationGoalId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("oath", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("oath", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("oath", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("oath", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("oath", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("oath", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("oath", item.id, 60)));
  } else if (kind === "ceremonies") {
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.civilizationGoalId != null) groups.push(relationGroup("Civilization Goal", [civilizationGoalLink(item.civilizationGoalId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    if (item.hostAgentId != null) groups.push(relationGroup("Host", [personLink(item.hostAgentId)]));
    groups.push(relationGroup("Participants", (item.participantAgentIds || []).slice(0, 120).map(personLink)));
    groups.push(relationGroup("Participation Records", (item.ceremonyParticipationIds || []).slice(0, 160).map(ceremonyParticipationLink)));
    groups.push(relationGroup("Artifacts Displayed", (item.artifactIds || []).map(artifactLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Traditions", traditionsAbout("ceremony", item.id, 60)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("ceremony", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("ceremony", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("ceremony", item.id, 60)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("ceremony", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("ceremony", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("ceremony", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("ceremony", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("ceremony", item.id, 40)));
    groups.push(relationGroup("Projects", projectsAbout("ceremony", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("ceremony", item.id, 40)));
  } else if (kind === "ceremony-participations") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Ceremony", [ceremonyLink(item.ceremonyId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.civilizationGoalId != null) groups.push(relationGroup("Civilization Goal", [civilizationGoalLink(item.civilizationGoalId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    groups.push(relationGroup("Artifacts Displayed", (item.artifactIds || []).map(artifactLink)));
    groups.push(relationGroup("Ceremony Event", [eventLink(item.ceremonyEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("ceremony-participation", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("ceremony-participation", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("ceremony-participation", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("ceremony-participation", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("ceremony-participation", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("ceremony-participation", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("ceremony-participation", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("ceremony-participation", item.id, 40)));
  } else if (kind === "activities") {
    groups.push(relationGroup("Primary Person", [personLink(item.primaryAgentId)]));
    groups.push(relationGroup("Participants", (item.participantAgentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Matched Preferences", (item.subjectRefs || []).filter(ref => ref.kind === "preference").map(ref => preferenceLink(ref.id))));
    groups.push(relationGroup("Practiced Traditions", (item.subjectRefs || []).filter(ref => ref.kind === "tradition").map(ref => traditionLink(ref.id))));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Teachings", teachingsAbout("activity", item.id, 80)));
    groups.push(relationGroup("Conversations", conversationsAbout("activity", item.id, 80)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("activity", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("activity", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("activity", item.id, 60)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("activity", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("activity", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("activity", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("activity", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("activity", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("activity", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("activity", item.id, 40)));
  } else if (kind === "teachings") {
    groups.push(relationGroup("Mentor", [personLink(item.mentorAgentId)]));
    groups.push(relationGroup("Student", [personLink(item.studentAgentId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Lesson Facts", [
      '<span class="ref">' + esc(item.kind) + '</span>',
      '<span class="ref">' + esc("specialty " + item.specialty) + '</span>',
      '<span class="ref">' + esc("quality " + item.quality) + '</span>',
      '<span class="ref">' + esc(years(item.year)) + '</span>'
    ]));
    if (item.skillId != null) groups.push(relationGroup("Skill Record", [skillLink(item.skillId)]));
    if (item.activityId != null) groups.push(relationGroup("Activity", [activityLink(item.activityId)]));
    if (item.apprenticeshipId != null) groups.push(relationGroup("Apprenticeship", [apprenticeshipLink(item.apprenticeshipId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.traditionId != null) groups.push(relationGroup("Tradition", [traditionLink(item.traditionId)]));
    if (item.writtenWorkId != null) groups.push(relationGroup("Written Work", [writtenWorkLink(item.writtenWorkId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("teaching", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("teaching", item.id, 60)));
    groups.push(relationGroup("Thoughts", thoughtsAbout("teaching", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("teaching", item.id, 40)));
    groups.push(relationGroup("Conversations", conversationsAbout("teaching", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("teaching", item.id, 40)));
    groups.push(relationGroup("Recent Events", recentEventLinksFor(item, 10)));
  } else if (kind === "projects") {
    groups.push(relationGroup("Lead Worker", [personLink(item.leadAgentId)]));
    groups.push(relationGroup("Workers", (item.workerAgentIds || []).slice(0, 120).map(personLink)));
    groups.push(relationGroup("Participation Records", (item.projectParticipationIds || []).slice(0, 160).map(projectParticipationLink)));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.civilizationGoalId != null) groups.push(relationGroup("Civilization Goal", [civilizationGoalLink(item.civilizationGoalId)]));
    if (item.artifactId != null) groups.push(relationGroup("Artifact", [artifactLink(item.artifactId)]));
    if (item.injuryId != null) groups.push(relationGroup("Injury", [injuryLink(item.injuryId)]));
    if (item.caseId != null) groups.push(relationGroup("Case", [caseLink(item.caseId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("project", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("project", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("project", item.id, 40)));
    groups.push(relationGroup("Skills", skillsAbout("project", item.id, 60)));
    groups.push(relationGroup("Rumors", rumorsAbout("project", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("project", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("project", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("project", item.id, 80)));
    groups.push(relationGroup("Belongings", belongingsAbout("project", item.id, 80)));
  } else if (kind === "project-participations") {
    groups.push(relationGroup("Person", [personLink(item.agentId)]));
    groups.push(relationGroup("Project", [projectLink(item.projectId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    if (item.beliefId != null) groups.push(relationGroup("Belief", [beliefLink(item.beliefId)]));
    if (item.civilizationGoalId != null) groups.push(relationGroup("Civilization Goal", [civilizationGoalLink(item.civilizationGoalId)]));
    if (item.artifactId != null) groups.push(relationGroup("Artifact", [artifactLink(item.artifactId)]));
    if (item.injuryId != null) groups.push(relationGroup("Injury", [injuryLink(item.injuryId)]));
    if (item.caseId != null) groups.push(relationGroup("Case", [caseLink(item.caseId)]));
    groups.push(relationGroup("Project Event", [eventLink(item.projectEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Opinions", opinionsAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Skills", skillsAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("project-participation", item.id, 40)));
    groups.push(relationGroup("Belongings", belongingsAbout("project-participation", item.id, 40)));
  } else if (kind === "obligations") {
    groups.push(relationGroup("Creditor", [personLink(item.creditorAgentId)]));
    groups.push(relationGroup("Debtor", [personLink(item.debtorAgentId)]));
    groups.push(relationGroup("Witnesses", (item.witnessAgentIds || []).map(personLink)));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.resolvedEventId != null) groups.push(relationGroup("Resolution Event", [eventLink(item.resolvedEventId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.artifactId != null) groups.push(relationGroup("Artifact", [artifactLink(item.artifactId)]));
    if (item.caseId != null) groups.push(relationGroup("Case", [caseLink(item.caseId)]));
    if (item.relationshipId != null) groups.push(relationGroup("Relationship", [relationshipLink(item.relationshipId)]));
    if (item.projectId != null) groups.push(relationGroup("Project", [projectLink(item.projectId)]));
    if (item.oathId != null) groups.push(relationGroup("Oath", [oathLink(item.oathId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("obligation", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("obligation", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("obligation", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("obligation", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("obligation", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("obligation", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("obligation", item.id, 40)));
    groups.push(relationGroup("Holdings", holdingsAbout("obligation", item.id, 40)));
  } else if (kind === "holdings") {
    if (item.ownerAgentId != null) groups.push(relationGroup("Owner", [personLink(item.ownerAgentId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    if (item.organizationId != null) groups.push(relationGroup("Organization", [organizationLink(item.organizationId)]));
    if (item.officeId != null) groups.push(relationGroup("Office", [officeLink(item.officeId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.transferredEventId != null) groups.push(relationGroup("Transfer Event", [eventLink(item.transferredEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("holding", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("holding", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("holding", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("holding", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("holding", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("holding", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("holding", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("holding", item.id, 40)));
    groups.push(relationGroup("Belongings", belongingsAbout("holding", item.id, 80)));
    groups.push(relationGroup("Estates", data.estates.filter(estate => (estate.holdingIds || []).includes(item.id)).slice(0, 60).map(estate => estateLink(estate.id))));
  } else if (kind === "belongings") {
    if (item.ownerAgentId != null) groups.push(relationGroup("Owner", [personLink(item.ownerAgentId)]));
    if (item.previousOwnerAgentId != null) groups.push(relationGroup("Previous Owner", [personLink(item.previousOwnerAgentId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.holdingId != null) groups.push(relationGroup("Holding", [holdingLink(item.holdingId)]));
    if (item.structureId != null) groups.push(relationGroup("Structure", [structureLink(item.structureId)]));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    groups.push(relationGroup("Source Event", [eventLink(item.sourceEventId)]));
    if (item.transferredEventId != null) groups.push(relationGroup("Transfer/Loss Event", [eventLink(item.transferredEventId)]));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("belonging", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("belonging", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("belonging", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("belonging", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("belonging", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("belonging", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("belonging", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("belonging", item.id, 40)));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("belonging", item.id, 80)));
    groups.push(relationGroup("Burials", burialsAbout("belonging", item.id, 60)));
    groups.push(relationGroup("Estates", data.estates.filter(estate => (estate.belongingIds || []).includes(item.id)).slice(0, 60).map(estate => estateLink(estate.id))));
  } else if (kind === "estates") {
    groups.push(relationGroup("Decedent", [personLink(item.decedentAgentId)]));
    groups.push(relationGroup("Heirs", (item.heirAgentIds || []).slice(0, 80).map(personLink)));
    groups.push(relationGroup("Place", [settlementLink(item.settlementId)]));
    groups.push(relationGroup("Civilization", [civLink(item.civilizationId)]));
    if (item.householdId != null) groups.push(relationGroup("Household", [householdLink(item.householdId)]));
    if (item.lineageId != null) groups.push(relationGroup("Lineage", [lineageLink(item.lineageId)]));
    if (item.memorialId != null) groups.push(relationGroup("Memorial", [memorialLink(item.memorialId)]));
    groups.push(relationGroup("Death Event", [eventLink(item.deathEventId)]));
    groups.push(relationGroup("Burials", burialsAbout("event", item.deathEventId, 20)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("estate", item.id, 20)));
    groups.push(relationGroup("Transfer Events", (item.transferredEventIds || []).slice(0, 80).map(eventLink)));
    groups.push(relationGroup("Artifacts", (item.artifactIds || []).slice(0, 80).map(artifactLink)));
    groups.push(relationGroup("Holdings", (item.holdingIds || []).slice(0, 80).map(holdingLink)));
    groups.push(relationGroup("Belongings", (item.belongingIds || []).slice(0, 100).map(belongingLink)));
    groups.push(relationGroup("Dispute Cases", (item.disputeCaseIds || []).slice(0, 80).map(caseLink)));
    groups.push(relationGroup("Dispute Feuds", (item.disputeFeudIds || []).slice(0, 80).map(feudLink)));
    groups.push(relationGroup("Dispute Rumors", (item.disputeRumorIds || []).slice(0, 80).map(rumorLink)));
    groups.push(relationGroup("Dispute Oaths", (item.disputeOathIds || []).slice(0, 80).map(oathLink)));
    groups.push(relationGroup("Subjects", (item.subjectRefs || []).map(refLink)));
    groups.push(relationGroup("Chronicles", chroniclesAbout("estate", item.id, 40)));
    groups.push(relationGroup("Memories", memoriesAbout("estate", item.id, 60)));
    groups.push(relationGroup("Opinions", opinionsAbout("estate", item.id, 40)));
    groups.push(relationGroup("Rumors", rumorsAbout("estate", item.id, 40)));
    groups.push(relationGroup("Secrets", secretsAbout("estate", item.id, 40)));
    groups.push(relationGroup("Feuds", feudsAbout("estate", item.id, 40)));
    groups.push(relationGroup("Oaths", oathsAbout("estate", item.id, 40)));
    groups.push(relationGroup("Obligations", obligationsAbout("estate", item.id, 40)));
  } else if (kind === "events") {
    groups.push(relationGroup("Chronicles", data.chronicles.filter(chronicle => (chronicle.sourceEventIds || []).includes(item.id)).slice(0, 60).map(chronicle => chronicleLink(chronicle.id))));
    groups.push(relationGroup("Written Works", writtenWorksAbout("event", item.id, 80)));
    groups.push(relationGroup("Traditions", traditionsAbout("event", item.id, 80)));
    groups.push(relationGroup("Doctrines", doctrinesAbout("event", item.id, 80)));
    groups.push(relationGroup("Civilization Goals", civilizationGoalsAbout("event", item.id, 80)));
    groups.push(relationGroup("Sacred Sites", sacredSitesAbout("event", item.id, 80)));
    groups.push(relationGroup("Memories", data.memories.filter(memory => memory.sourceEventId === item.id).slice(0, 80).map(memory => memoryLink(memory.id))));
    groups.push(relationGroup("Thoughts", thoughtsAbout("event", item.id, 80)));
    groups.push(relationGroup("Need Episodes", needEpisodesAbout("event", item.id, 80)));
    groups.push(relationGroup("Possession Attachments", possessionAttachmentsAbout("event", item.id, 80)));
    groups.push(relationGroup("Opinions", opinionsAbout("event", item.id, 80)));
    groups.push(relationGroup("Conversations", conversationsAbout("event", item.id, 100)));
    groups.push(relationGroup("Testimonies", testimoniesAbout("event", item.id, 100)));
    groups.push(relationGroup("Settlement Control", settlementControlsAbout("event", item.id, 80)));
    groups.push(relationGroup("Person Allegiances", personAllegiancesAbout("event", item.id, 80)));
    groups.push(relationGroup("Preferences", preferencesAbout("event", item.id, 80)));
    groups.push(relationGroup("Battle Roles", battleParticipationsAbout("event", item.id, 80)));
    groups.push(relationGroup("Conflicts", conflictsAbout("event", item.id, 80)));
    groups.push(relationGroup("Military Units", data.militaryUnits.filter(unit => unit.formedEventId === item.id || unit.disbandedEventId === item.id || (unit.eventIds || []).includes(item.id) || (unit.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(unit => militaryUnitLink(unit.id))));
    groups.push(relationGroup("Equipment", data.equipmentCaches.filter(cache => cache.sourceEventId === item.id || (cache.eventIds || []).includes(item.id) || (cache.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(cache => equipmentCacheLink(cache.id))));
    groups.push(relationGroup("Spy Networks", data.spyNetworks.filter(network => network.formedEventId === item.id || network.exposedEventId === item.id || (network.eventIds || []).includes(item.id) || (network.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(network => spyNetworkLink(network.id))));
    groups.push(relationGroup("Spy Operations", data.spyOperations.filter(operation => operation.sourceEventId === item.id || (operation.eventIds || []).includes(item.id) || (operation.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(operation => spyOperationLink(operation.id))));
    groups.push(relationGroup("Illnesses", illnessesAbout("event", item.id, 80)));
    groups.push(relationGroup("Wound Legacies", woundLegaciesAbout("event", item.id, 80)));
    groups.push(relationGroup("Burials", burialsAbout("event", item.id, 80)));
    groups.push(relationGroup("Death Records", deathRecordsAbout("event", item.id, 80)));
    groups.push(relationGroup("Births", birthsAbout("event", item.id, 80)));
    groups.push(relationGroup("Age Milestones", ageMilestonesAbout("event", item.id, 80)));
    groups.push(relationGroup("Appearance", appearanceFeaturesAbout("event", item.id, 80)));
    groups.push(relationGroup("Skills", skillsAbout("event", item.id, 80)));
    groups.push(relationGroup("Residences", residencesAbout("event", item.id, 80)));
    groups.push(relationGroup("Careers", careersAbout("event", item.id, 80)));
    groups.push(relationGroup("Memberships", membershipsAbout("event", item.id, 80)));
    groups.push(relationGroup("Organization Ranks", organizationRanksAbout("event", item.id, 80)));
    groups.push(relationGroup("Epithets", epithetsAbout("event", item.id, 80)));
    groups.push(relationGroup("Reputation Milestones", reputationMilestonesAbout("event", item.id, 80)));
    groups.push(relationGroup("Belief Adherences", beliefAdherencesAbout("event", item.id, 80)));
    groups.push(relationGroup("Office Terms", officeTermsAbout("event", item.id, 80)));
    groups.push(relationGroup("Unions", unionsAbout("event", item.id, 80)));
    groups.push(relationGroup("Relationship Milestones", relationshipMilestonesAbout("event", item.id, 80)));
    groups.push(relationGroup("Rumors", data.rumors.filter(rumor => rumor.sourceEventId === item.id || (rumor.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 60).map(rumor => rumorLink(rumor.id))));
    groups.push(relationGroup("Secrets", data.secrets.filter(secret => secret.sourceEventId === item.id || secret.revealedEventId === item.id || (secret.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 60).map(secret => secretLink(secret.id))));
    groups.push(relationGroup("Schemes", schemesAbout("event", item.id, 60)));
    groups.push(relationGroup("Feuds", data.feuds.filter(feud => feud.sourceEventId === item.id || feud.settledEventId === item.id || (feud.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 60).map(feud => feudLink(feud.id))));
    groups.push(relationGroup("Oaths", data.oaths.filter(oath => oath.sourceEventId === item.id || oath.resolvedEventId === item.id || (oath.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 60).map(oath => oathLink(oath.id))));
    groups.push(relationGroup("Ceremonies", data.ceremonies.filter(ceremony => (ceremony.eventIds || []).includes(item.id) || (ceremony.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 60).map(ceremony => ceremonyLink(ceremony.id))));
    groups.push(relationGroup("Ceremony Roles", ceremonyParticipationsAbout("event", item.id, 80)));
    groups.push(relationGroup("Activities", activitiesAbout("event", item.id, 100)));
    groups.push(relationGroup("Projects", data.projects.filter(project => (project.eventIds || []).includes(item.id) || (project.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(project => projectLink(project.id))));
    groups.push(relationGroup("Project Roles", projectParticipationsAbout("event", item.id, 80)));
    groups.push(relationGroup("Obligations", data.obligations.filter(obligation => obligation.sourceEventId === item.id || obligation.resolvedEventId === item.id || (obligation.eventIds || []).includes(item.id) || (obligation.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(obligation => obligationLink(obligation.id))));
    groups.push(relationGroup("Holdings", data.holdings.filter(holding => holding.sourceEventId === item.id || holding.transferredEventId === item.id || (holding.eventIds || []).includes(item.id) || (holding.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(holding => holdingLink(holding.id))));
    groups.push(relationGroup("Belongings", data.belongings.filter(belonging => belonging.sourceEventId === item.id || belonging.transferredEventId === item.id || (belonging.eventIds || []).includes(item.id) || (belonging.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(belonging => belongingLink(belonging.id))));
    groups.push(relationGroup("Estates", data.estates.filter(estate => estate.deathEventId === item.id || (estate.transferredEventIds || []).includes(item.id) || (estate.eventIds || []).includes(item.id) || (estate.subjectRefs || []).some(ref => ref.kind === "event" && ref.id === item.id)).slice(0, 80).map(estate => estateLink(estate.id))));
  } else {
    return "";
  }
  const html = groups.join("");
  return html ? '<h3>Relations</h3><div class="relations">' + html + '</div>' : "";
}
function chunkUrl(kind, id) {
  const basePath = chunkConfig.basePath || "records";
  const chunkSize = Number(chunkConfig.chunkSize || 500);
  const chunkId = Math.floor(Number(id) / chunkSize);
  return basePath.replace(/\\/$/, "") + "/" + encodeURIComponent(kind) + "/" + chunkId + ".json";
}
function textUrl(kind, id) {
  const basePath = textConfig.basePath || "texts";
  const chunkSize = Number(textConfig.chunkSize || chunkConfig.chunkSize || 500);
  const chunkId = Math.floor(Number(id) / chunkSize);
  return basePath.replace(/\\/$/, "") + "/" + encodeURIComponent(kind) + "/" + chunkId + ".json";
}
function indexUrl(kind) {
  const basePath = indexConfig.basePath || "indexes";
  return basePath.replace(/\\/$/, "") + "/" + encodeURIComponent(kind) + ".json";
}
function mentionUrl(kind, id) {
  const basePath = mentionConfig.basePath || "mentions";
  const chunkSize = Number(mentionConfig.chunkSize || 500);
  const chunkId = Math.floor(Number(id) / chunkSize);
  return basePath.replace(/\\/$/, "") + "/" + encodeURIComponent(kind) + "/" + chunkId + ".json";
}
async function loadIndex(kind) {
  if (loadedIndexes.has(kind) || !indexConfig.kinds?.[kind]) return;
  const response = await fetch(indexUrl(kind));
  if (!response.ok) throw new Error("Failed to load " + kind + " index (" + response.status + " " + response.statusText + ")");
  const entries = await response.json();
  viewerIndex[kind] = entries;
  indexMaps[kind] = new Map(entries.map(entry => [entry.id, entry]));
  loadedIndexes.add(kind);
}
function mergeLoadedRecord(kind, record) {
  if (!record || record.id == null || !maps[kind]) return;
  const dataKey = dataKeys[kind] || kind;
  const list = data[dataKey] || data[kind] || [];
  data[dataKey] = list;
  data[kind] = list;
  const existing = maps[kind].get(record.id);
  if (existing) {
    Object.assign(existing, record);
    maps[kind].set(record.id, existing);
  } else {
    list.push(record);
    maps[kind].set(record.id, record);
  }
}
async function loadRecord(kind, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || !maps[kind]) return null;
  if (maps[kind].has(numericId)) return maps[kind].get(numericId);
  if (!chunkConfig.kinds?.[kind]) return null;

  const chunkSize = Number(chunkConfig.chunkSize || 500);
  const chunkId = Math.floor(numericId / chunkSize);
  const cacheKey = kind + ":" + chunkId;
  let records = readCache(loadedChunks, cacheKey);
  if (!records) {
    const response = await fetch(chunkUrl(kind, numericId));
    if (!response.ok) throw new Error("Failed to load " + kind + " chunk " + chunkId + " (" + response.status + " " + response.statusText + ")");
    const payload = await response.json();
    records = Array.isArray(payload) ? payload : [];
    writeCache(loadedChunks, cacheKey, records, recordChunkCacheLimit);
  }
  const record = records.find(candidate => Number(candidate?.id) === numericId) || null;
  if (!record) return null;
  mergeLoadedRecord(kind, record);
  return await hydrateRecordText(kind, maps[kind].get(numericId) || record);
}
async function loadTextChunk(kind, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || !textConfig.kinds?.[kind]) return {};
  const chunkSize = Number(textConfig.chunkSize || chunkConfig.chunkSize || 500);
  const chunkId = Math.floor(numericId / chunkSize);
  const cacheKey = kind + ":" + chunkId;
  const cached = readCache(loadedTextChunks, cacheKey);
  if (cached) return cached;
  const response = await fetch(textUrl(kind, numericId));
  if (response.status === 404) {
    return writeCache(loadedTextChunks, cacheKey, {}, textChunkCacheLimit);
  }
  if (!response.ok) throw new Error("Failed to load " + kind + " text chunk " + chunkId + " (" + response.status + " " + response.statusText + ")");
  return writeCache(loadedTextChunks, cacheKey, await response.json(), textChunkCacheLimit);
}
async function hydrateRecordText(kind, record) {
  if (!record || !record.viewerText) return record;
  const chunk = await loadTextChunk(kind, record.id);
  const text = chunk[String(record.id)] || {};
  if (typeof text.headline === "string") record.headline = text.headline;
  if (typeof text.description === "string") record.description = text.description;
  delete record.viewerText;
  return record;
}
async function loadMentionChunk(kind, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || !mentionConfig.kinds?.[kind]) return {};
  const chunkSize = Number(mentionConfig.chunkSize || 500);
  const chunkId = Math.floor(numericId / chunkSize);
  const cacheKey = kind + ":" + chunkId;
  const cached = readCache(loadedMentionChunks, cacheKey);
  if (cached) return cached;
  const response = await fetch(mentionUrl(kind, numericId));
  if (response.status === 404) {
    return writeCache(loadedMentionChunks, cacheKey, {}, mentionChunkCacheLimit);
  }
  if (!response.ok) throw new Error("Failed to load " + kind + " mentions " + chunkId + " (" + response.status + " " + response.statusText + ")");
  return writeCache(loadedMentionChunks, cacheKey, await response.json(), mentionChunkCacheLimit);
}
async function loadWorldMentions(kind, id) {
  const chunk = await loadMentionChunk(kind, id);
  return chunk[String(id)] || {};
}
const relationFieldKinds = {
  storyHookId: "story-hooks",
  storyHookIds: "story-hooks",
  activityId: "activities",
  activityIds: "activities",
  teachingId: "teachings",
  teachingIds: "teachings",
  actorAgentId: "people",
  accusedAgentId: "people",
  adherenceIds: "belief-adherences",
  adherentAgentIds: "people",
  adherentIds: "people",
  agentId: "people",
  agentIds: "people",
  ambitionId: "ambitions",
  ambitionIds: "ambitions",
  apprenticeAgentId: "people",
  apprenticeshipId: "apprenticeships",
  apprenticeshipIds: "apprenticeships",
  artifactId: "artifacts",
  artifactIds: "artifacts",
  artifactConditionId: "artifact-conditions",
  artifactConditionIds: "artifact-conditions",
  conditionRecordIds: "artifact-conditions",
  attackerCivilizationId: "civilizations",
  attackerCommanderId: "people",
  attackerParticipantIds: "people",
  attackerUnitIds: "military-units",
  authorAgentId: "people",
  battleEventId: "events",
  battleId: "battles",
  battleIds: "battles",
  battleParticipationId: "battle-participations",
  battleParticipationIds: "battle-participations",
  commanderAgentId: "people",
  militaryUnitId: "military-units",
  militaryUnitIds: "military-units",
  troopAgentIds: "people",
  unitId: "military-units",
  unitIds: "military-units",
  equipmentCacheId: "equipment-caches",
  equipmentCacheIds: "equipment-caches",
  handlerAgentId: "people",
  spyNetworkId: "spy-networks",
  spyNetworkIds: "spy-networks",
  networkId: "spy-networks",
  networkIds: "spy-networks",
  spyOperationId: "spy-operations",
  spyOperationIds: "spy-operations",
  operationId: "spy-operations",
  operationIds: "spy-operations",
  birthId: "births",
  birthIds: "births",
  birthEventId: "events",
  ageMilestoneId: "age-milestones",
  ageMilestoneIds: "age-milestones",
  appearanceFeatureId: "appearance-features",
  appearanceFeatureIds: "appearance-features",
  burialId: "burials",
  burialIds: "burials",
  careRecordId: "care-records",
  careRecordIds: "care-records",
  beliefAdherenceId: "belief-adherences",
  beliefAdherenceIds: "belief-adherences",
  beliefId: "beliefs",
  beliefIds: "beliefs",
  mythsMagicId: "myths-magic",
  mythsMagicIds: "myths-magic",
  godId: "gods",
  godIds: "gods",
  creationGodId: "gods",
  patronGodId: "gods",
  commandmentId: "commandments",
  commandmentIds: "commandments",
  destinyId: "destinies",
  destinyIds: "destinies",
  activeDestinyIds: "destinies",
  miracleId: "miracles",
  miracleIds: "miracles",
  mythId: "myths",
  mythIds: "myths",
  doctrineId: "doctrines",
  doctrineIds: "doctrines",
  magicRoleId: "magic-roles",
  magicRoleIds: "magic-roles",
  prophecyId: "prophecies",
  prophecyIds: "prophecies",
  civilizationGoalId: "civilization-goals",
  civilizationGoalIds: "civilization-goals",
  sacredSiteId: "sacred-sites",
  sacredSiteIds: "sacred-sites",
  belongingId: "belongings",
  belongingIds: "belongings",
  careerId: "careers",
  careerIds: "careers",
  caseId: "cases",
  caseIds: "cases",
  chapterId: "chapters",
  chapterIds: "chapters",
  testimonyId: "testimonies",
  testimonyIds: "testimonies",
  casualtyAgentIds: "people",
  casualtyEventId: "events",
  centralAgentId: "people",
  ceremonyId: "ceremonies",
  ceremonyIds: "ceremonies",
  ceremonyParticipationId: "ceremony-participations",
  ceremonyParticipationIds: "ceremony-participations",
  childAgentIds: "people",
  childIds: "people",
  chronicleId: "chronicles",
  chronicleIds: "chronicles",
  civilizationId: "civilizations",
  civilizationIds: "civilizations",
  conflictId: "conflicts",
  conflictIds: "conflicts",
  contestedSettlementIds: "settlements",
  conspiratorAgentIds: "people",
  controlId: "settlement-controls",
  controlIds: "settlement-controls",
  creditorAgentId: "people",
  creatorAgentId: "people",
  decedentAgentId: "people",
  debtorAgentId: "people",
  defenderCivilizationId: "civilizations",
  defenderCommanderId: "people",
  defenderParticipantIds: "people",
  defenderUnitIds: "military-units",
  descendantIds: "people",
  destinationStructureId: "structures",
  deathEventId: "events",
  deathRecordId: "death-records",
  deathRecordIds: "death-records",
  disbandedEventId: "events",
  disputeCaseIds: "cases",
  disputeFeudIds: "feuds",
  disputeOathIds: "oaths",
  disputeRumorIds: "rumors",
  endEventId: "events",
  endedEventId: "events",
  eventId: "events",
  eventIds: "events",
  exposedEventId: "events",
  estateId: "estates",
  estateIds: "estates",
  feudId: "feuds",
  feudIds: "feuds",
  graveGoodArtifactIds: "artifacts",
  graveGoodBelongingIds: "belongings",
  founderAgentId: "people",
  founderAgentIds: "people",
  formedEventId: "events",
  fromSettlementId: "settlements",
  healerAgentId: "people",
  heirAgentIds: "people",
  holderAgentId: "people",
  hostAgentId: "people",
  holdingId: "holdings",
  holdingIds: "holdings",
  householdId: "households",
  householdIds: "households",
  householdKinIds: "people",
  illnessId: "illnesses",
  illnessIds: "illnesses",
  injuryId: "injuries",
  injuryIds: "injuries",
  woundLegacyId: "wound-legacies",
  woundLegacyIds: "wound-legacies",
  instigatorCivilizationId: "civilizations",
  journeyId: "journeys",
  journeyIds: "journeys",
  keeperAgentIds: "people",
  lawId: "laws",
  lawIds: "laws",
  leadAgentId: "people",
  leaderAgentId: "people",
  lineageId: "lineages",
  lineageIds: "lineages",
  lineageKinIds: "people",
  memberAgentIds: "people",
  memoryId: "memories",
  memoryIds: "memories",
  mournerAgentIds: "people",
  personalityShiftId: "personality-shifts",
  personalityShiftIds: "personality-shifts",
  needEpisodeId: "need-episodes",
  needEpisodeIds: "need-episodes",
  memorialId: "memorials",
  memorialIds: "memorials",
  mentorAgentId: "people",
  officeId: "offices",
  officeIds: "offices",
  officeTermId: "office-terms",
  officeTermIds: "office-terms",
  opinionId: "opinions",
  opinionIds: "opinions",
  organizationId: "organizations",
  organizationIds: "organizations",
  originSettlementId: "settlements",
  originStructureId: "structures",
  oathId: "oaths",
  oathIds: "oaths",
  ownerAgentId: "people",
  parentCivilizationId: "civilizations",
  patientAgentId: "people",
  parentAgentIds: "people",
  parentIds: "people",
  participantAgentIds: "people",
  partnerAgentIds: "people",
  personAllegianceId: "person-allegiances",
  personAllegianceIds: "person-allegiances",
  personId: "people",
  preferenceId: "preferences",
  preferenceIds: "preferences",
  previousCivilizationId: "civilizations",
  previousOwnerAgentId: "people",
  previousSettlementId: "settlements",
  previousStructureId: "structures",
  primaryAgentId: "people",
  projectId: "projects",
  projectIds: "projects",
  projectParticipationId: "project-participations",
  projectParticipationIds: "project-participations",
  recipientAgentId: "people",
  recordedEventId: "events",
  reputationMilestoneId: "reputation-milestones",
  reputationMilestoneIds: "reputation-milestones",
  relationshipId: "relationships",
  relationshipMilestoneId: "relationship-milestones",
  relationshipMilestoneIds: "relationship-milestones",
  milestoneIds: "relationship-milestones",
  roadIds: "roads",
  residenceId: "residences",
  residenceIds: "residences",
  residenceStructureId: "structures",
  restoredCivilizationId: "civilizations",
  revealedEventId: "events",
  resolvedEventId: "events",
  rumorId: "rumors",
  rumorIds: "rumors",
  schemeId: "schemes",
  schemeIds: "schemes",
  secretId: "secrets",
  secretIds: "secrets",
  settlementId: "settlements",
  settlementIds: "settlements",
  naturalFeatureId: "natural-features",
  naturalFeatureIds: "natural-features",
  settledEventId: "events",
  siblingIds: "people",
  studentAgentId: "people",
  socialBondIds: "relationships",
  socialClaimId: "social-claims",
  socialClaimIds: "social-claims",
  sourceEventId: "events",
  sourceEventIds: "events",
  listenerAgentId: "people",
  speakerAgentId: "people",
  sourceMemoryId: "memories",
  sourceOpinionId: "opinions",
  sourcePersonalityShiftId: "personality-shifts",
  sourcePreferenceId: "preferences",
  sourceTraditionId: "traditions",
  spouseId: "people",
  spreadSettlementIds: "settlements",
  startEventId: "events",
  startedEventId: "events",
  structureId: "structures",
  structureIds: "structures",
  targetAgentId: "people",
  targetArtifactId: "artifacts",
  targetBeliefId: "beliefs",
  targetCivilizationGoalId: "civilization-goals",
  targetCivilizationId: "civilizations",
  targetEventId: "events",
  targetFeudId: "feuds",
  targetOfficeId: "offices",
  targetCaseId: "cases",
  targetAmbitionId: "ambitions",
  targetProphecyId: "prophecies",
  targetSecretId: "secrets",
  targetSettlementId: "settlements",
  swearerAgentId: "people",
  tellerAgentId: "people",
  termIds: "office-terms",
  thoughtId: "thoughts",
  thoughtIds: "thoughts",
  conversationId: "conversations",
  conversationIds: "conversations",
  toSettlementId: "settlements",
  traditionId: "traditions",
  traditionIds: "traditions",
  transferredEventId: "events",
  transferredEventIds: "events",
  unionId: "unions",
  unionIds: "unions",
  victimAgentId: "people",
  witnessAgentId: "people",
  witnessAgentIds: "people",
  workerAgentIds: "people",
  writtenWorkId: "written-works",
  writtenWorkIds: "written-works"
};
const relatedRecordHydrationCaps = {
  events: 120,
  people: 60,
  memories: 40,
  thoughts: 40,
  "personality-shifts": 30,
  "need-episodes": 30,
  opinions: 40,
  "social-claims": 40,
  schemes: 30,
  careers: 30,
  residences: 30,
  structures: 30,
  activities: 30,
  memberships: 30,
  traditions: 30,
  preferences: 30,
  "person-allegiances": 30,
  "belief-adherences": 30,
  "office-terms": 30,
  holdings: 30,
  belongings: 30,
  relationships: 30,
  "reputation-milestones": 30,
  "relationship-milestones": 30,
  "battle-participations": 30,
  "military-units": 30,
  "equipment-caches": 30,
  "spy-networks": 30,
  "spy-operations": 30,
  "wound-legacies": 30,
  burials: 30,
  "death-records": 30,
  births: 30,
  "age-milestones": 30,
  "appearance-features": 30,
  "ceremony-participations": 30,
  "project-participations": 30,
  civilizations: 10,
  settlements: 20,
  households: 20,
  lineages: 20,
  beliefs: 20,
  "myths-magic": 10,
  gods: 20,
  commandments: 20,
  destinies: 20,
  miracles: 20,
  myths: 20,
  doctrines: 20,
  "magic-roles": 20,
  prophecies: 20,
  "civilization-goals": 20,
  "sacred-sites": 20,
  organizations: 20,
  artifacts: 20,
  "artifact-conditions": 30,
  "story-hooks": 30,
  default: 20
};
const routeContextIndexKinds = {
  "story-hooks": [
    "people",
    "settlements",
    "civilizations",
    "artifacts",
    "conflicts",
    "battles",
    "relationships",
    "secrets",
    "schemes",
    "feuds",
    "oaths",
    "beliefs",
    "gods",
    "prophecies",
    "civilization-goals",
    "events"
  ],
  settlements: [
    "people",
    "structures",
    "organizations",
    "offices",
    "beliefs",
    "battles",
    "military-units",
    "equipment-caches",
    "spy-networks",
    "spy-operations",
    "births",
    "age-milestones",
    "appearance-features",
    "injuries",
    "illnesses",
    "care-records",
    "wound-legacies",
    "laws",
    "cases",
    "schemes",
    "households",
    "lineages",
    "roads",
    "journeys",
    "ceremonies",
    "activities",
    "projects",
    "artifacts",
    "artifact-conditions",
    "chronicles",
    "written-works",
    "memories",
    "personality-shifts",
    "need-episodes",
    "opinions",
    "social-claims",
    "relationship-milestones",
    "reputation-milestones"
  ],
  artifacts: [
    "people",
    "settlements",
    "structures",
    "civilizations",
    "events",
    "artifact-conditions",
    "battles",
    "journeys",
    "ambitions",
    "oaths",
    "ceremonies",
    "projects",
    "obligations",
    "chronicles",
    "written-works",
    "memories",
    "personality-shifts",
    "opinions",
    "social-claims",
    "rumors"
  ],
  roads: ["settlements", "civilizations", "journeys"],
  civilizations: ["settlements", "people", "births", "age-milestones", "appearance-features", "death-records", "structures", "organizations", "roads", "offices", "laws", "cases", "schemes", "conflicts", "battles", "military-units", "equipment-caches", "spy-networks", "spy-operations", "injuries", "illnesses", "care-records", "wound-legacies", "need-episodes", "traditions", "myths-magic", "beliefs", "gods", "commandments", "destinies", "miracles", "myths", "doctrines", "magic-roles", "prophecies", "civilization-goals", "sacred-sites", "relationship-milestones", "reputation-milestones", "artifacts", "artifact-conditions"],
  "myths-magic": ["civilizations", "settlements", "beliefs", "gods", "commandments", "destinies", "miracles", "myths", "doctrines", "magic-roles", "prophecies", "civilization-goals", "sacred-sites", "people", "events"],
  gods: ["civilizations", "settlements", "beliefs", "commandments", "destinies", "miracles", "myths", "doctrines", "magic-roles", "prophecies", "civilization-goals", "sacred-sites", "events"],
  commandments: ["civilizations", "settlements", "beliefs", "gods", "doctrines", "civilization-goals", "events"],
  destinies: ["civilizations", "settlements", "people", "beliefs", "gods", "prophecies", "civilization-goals", "artifacts", "events"],
  miracles: ["civilizations", "settlements", "people", "beliefs", "gods", "prophecies", "civilization-goals", "sacred-sites", "events"]
};
function addHydrationTarget(targets, kind, id) {
  const numericId = Number(id);
  if (!kind || !Number.isFinite(numericId) || numericId < 0) return;
  targets[kind] ??= new Set();
  targets[kind].add(numericId);
}
function addHydrationValue(targets, kind, value) {
  if (Array.isArray(value)) {
    for (const id of value) addHydrationTarget(targets, kind, id);
  } else {
    addHydrationTarget(targets, kind, value);
  }
}
function collectHydrationTargets(item) {
  const targets = {};
  if (!item || typeof item !== "object") return targets;
  for (const [field, value] of Object.entries(item)) {
    const directKind = relationFieldKinds[field];
    if (directKind) addHydrationValue(targets, directKind, value);
    if (field === "entityRefs" || field === "subjectRefs" || field === "seedRefs" || field === "targetRefs" || field === "depictionRefs" || field === "dedicationRefs") {
      for (const ref of value || []) addHydrationTarget(targets, refKinds[ref.kind] || ref.kind, ref.id);
    }
    if (field === "targetRef" && value) addHydrationTarget(targets, refKinds[value.kind] || value.kind, value.id);
  }
  if (item.ownerKind != null && item.ownerId != null) addHydrationTarget(targets, item.ownerKind, item.ownerId);
  return targets;
}
async function hydrateRelatedRecords(kind, item) {
  if (!item) return;
  await hydrateRecordText(kind, item).catch(() => item);
  const targets = collectHydrationTargets(item);
  for (const indexKind of routeContextIndexKinds[kind] || []) {
    await loadIndex(indexKind).catch(() => null);
  }
  for (const targetKind of Object.keys(targets)) {
    await loadIndex(targetKind).catch(() => null);
  }
  const loaders = [];
  for (const [targetKind, ids] of Object.entries(targets)) {
    const cap = relatedRecordHydrationCaps[targetKind] ?? relatedRecordHydrationCaps.default;
    for (const id of [...ids].slice(0, cap)) {
      if (!maps[targetKind]?.has(id)) loaders.push(loadRecord(targetKind, id).catch(() => null));
    }
  }
  await Promise.all(loaders);
}
let renderRequestId = 0;
function renderDetail(kind, item) {
  if (!item) {
    document.getElementById("detail").innerHTML = '<h2>' + esc(kinds.find(([k]) => k === kind)?.[1] || "Legends") + '</h2><p class="empty">Choose an entry from the index, or search for one.</p>';
    return;
  }
  let title = labelFor(kind, item);
  let meta = linkedMeta(kind, item);
  const events = kind === "events" ? [item] : itemEvents(item);
  const sections = [
    {id: "narrative", label: "Narrative", html: narrativeSection(kind, item)},
    {id: "map", label: "Map", html: mapContextSection(kind, item)},
    {id: "profile", label: "Profile", html: profileSection(kind, item)},
    {id: "natural-feature", label: "Natural Feature", html: naturalFeatureWikiSection(kind, item)},
    {id: "myths-magic", label: "Myths and Magic", html: mythicWikiSection(kind, item)},
    {id: "story-hook", label: "Story Hook", html: storyHookWikiSection(kind, item)},
    {id: "chapter", label: "Chapter", html: chapterWikiSection(kind, item)},
    {id: "record", label: "Record", html: recordWikiSection(kind, item)},
    {id: "life-milestones", label: "Life Milestones", html: lifeMilestoneWikiSection(kind, item)},
    {id: "institutions", label: "Institutions", html: institutionalWikiSection(kind, item)},
    {id: "continuity", label: "Continuity", html: continuityWikiSection(kind, item)},
    {id: "event-summary", label: "Event Summary", html: eventWikiSection(kind, item)},
    {id: "structure-chapters", label: "Structure Chapters", html: structureChaptersSection(kind, item)},
    {id: "conflict-chapters", label: "Conflict Chapters", html: conflictChaptersSection(kind, item)},
    {id: "battle-chapters", label: "Battle Chapters", html: battleChaptersSection(kind, item)},
    {id: "biography", label: "Biography", html: personBiographySection(kind, item)},
    {id: "social-web", label: "Social Web", html: socialWebSection(kind, item)},
    {id: "life-chapters", label: "Life Chapters", html: personLifeChaptersSection(kind, item)},
    {id: "legacy", label: "Legacy", html: personLegacySection(kind, item)},
    {id: "relationship-chapters", label: "Relationship Chapters", html: relationshipChaptersSection(kind, item)},
    {id: "world-mentions", label: "World Mentions", html: worldMentionsSection(kind, item)},
    {id: "settlement", label: "Settlement", html: settlementWikiSection(kind, item)},
    {id: "place-chapters", label: "Place Chapters", html: settlementPlaceChaptersSection(kind, item)},
    {id: "road", label: "Road", html: roadWikiSection(kind, item)},
    {id: "road-chapters", label: "Road Chapters", html: roadChaptersSection(kind, item)},
    {id: "artifact", label: "Artifact", html: artifactWikiSection(kind, item)},
    {id: "artifact-chapters", label: "Artifact Chapters", html: artifactChaptersSection(kind, item)},
    {id: "civilization", label: "Civilization", html: civilizationWikiSection(kind, item)},
    {id: "civilization-chapters", label: "Civilization Chapters", html: civilizationChaptersSection(kind, item)},
    {id: "organization", label: "Organization", html: organizationWikiSection(kind, item)},
    {id: "organization-chapters", label: "Organization Chapters", html: organizationChaptersSection(kind, item)},
    {id: "household", label: "Household", html: householdWikiSection(kind, item)},
    {id: "household-chapters", label: "Household Chapters", html: householdChaptersSection(kind, item)},
    {id: "lineage", label: "Lineage", html: lineageWikiSection(kind, item)},
    {id: "lineage-chapters", label: "Lineage Chapters", html: lineageChaptersSection(kind, item)},
    {id: "provenance", label: "Provenance", html: artifactProvenanceSection(kind, item)},
    {id: "relations", label: "Relations", html: relationsSection(kind, item)},
    {id: "timeline", label: "Timeline", html: '<h3>Timeline</h3>' + renderTimeline(events)}
  ].filter(section => stripHtml(section.html) !== "");
  document.getElementById("detail").innerHTML =
    renderPageHeader(kind, item, title, meta, events) +
    renderSectionNav(sections) +
    '<div class="section-stack">' + sections.map(detailSection).join("") + '</div>';
}
function renderIndexOnlyDetail(kind, entry, message) {
  const title = entry?.label || (kinds.find(([k]) => k === kind)?.[1] || "Legends");
  const sublabel = entry?.sublabel || "";
  const extra = message ? '<div class="load-error"><p>' + esc(message) + '</p></div>' : '';
  document.getElementById("detail").innerHTML =
    '<h2>' + esc(title) + '</h2><div class="meta"><span class="pill">' + esc(kind) + '</span><span class="pill">id ' + esc(entry?.id) + '</span></div>' +
    (sublabel ? '<p>' + esc(sublabel) + '</p>' : '') +
    extra +
    '<h3>Full Archive Entry</h3><p class="empty">This record is present in the complete lookup index. Serve this folder locally to load rich record chunks on demand; the full raw entry is also available in legends.json.</p>';
}
function route() {
  const parsed = router.current();
  state.kind = parsed.kind;
  return parsed;
}
function filteredItems() {
  const source = (viewerIndex[state.kind] && viewerIndex[state.kind].length ? viewerIndex[state.kind] : data[state.kind]) || [];
  const query = state.query.trim().toLowerCase();
  const items = query ? source.filter(item => (displayLabelFor(state.kind, item) + " " + displaySublabelFor(state.kind, item)).toLowerCase().includes(query)) : source;
  return items.slice(0, 400);
}
function kindLabel(kind) {
  return (kinds.find(([candidate]) => candidate === kind) || [kind, kind])[1];
}
async function loadGlobalSearchIndexes() {
  await Promise.all(globalSearchKinds.map(kind => loadIndex(kind).catch(() => null)));
}
function filteredGlobalItems() {
  const query = state.query.trim().toLowerCase();
  if (query.length < globalSearchMinimumLength) return [];
  const matches = [];
  for (const kind of globalSearchKinds) {
    const source = (viewerIndex[kind] && viewerIndex[kind].length ? viewerIndex[kind] : data[kind]) || [];
    for (const item of source) {
      const label = displayLabelFor(kind, item);
      const sublabel = displaySublabelFor(kind, item);
      const haystack = (label + " " + sublabel + " " + kindLabel(kind)).toLowerCase();
      if (!haystack.includes(query)) continue;
      const starts = label.toLowerCase().startsWith(query) ? 2 : 0;
      const exact = label.toLowerCase() === query ? 4 : 0;
      matches.push({kind, item, label, sublabel, score: exact + starts});
    }
  }
  return matches
    .sort((a, b) => b.score - a.score || kindLabel(a.kind).localeCompare(kindLabel(b.kind)) || a.label.localeCompare(b.label) || Number(a.item.id) - Number(b.item.id))
    .slice(0, 400);
}
async function renderList() {
  const requestId = ++renderRequestId;
  const currentRoute = route();
  const {kind, id} = currentRoute;
  let indexLoadError = null;
  try {
    await loadIndex(kind);
    if (state.globalSearch && state.query.trim().length >= globalSearchMinimumLength) await loadGlobalSearchIndexes();
  } catch (error) {
    indexLoadError = error;
  }
  if (requestId !== renderRequestId) return;
  const list = document.getElementById("list");
  if (state.globalSearch) {
    const globalItems = filteredGlobalItems();
    const query = state.query.trim();
    const note = query.length < globalSearchMinimumLength
      ? '<p class="list-note">Type at least ' + esc(globalSearchMinimumLength) + ' characters to search all generated legend indexes.</p>'
      : '<p class="list-note">' + esc(globalItems.length + " matches across all legend indexes") + '</p>';
    list.innerHTML = note + globalItems.map(result => '<a class="item' + (result.kind === kind && result.item.id === id ? ' active' : '') + '" href="' + esc(hashFor(result.kind, result.item.id)) + '"><span>' + esc(result.label) + '</span><small>' + esc(kindLabel(result.kind) + (result.sublabel ? " - " + result.sublabel : "")) + '</small></a>').join("");
  } else {
    const items = filteredItems();
    list.innerHTML = items.map(item => '<a class="item' + (item.id === id ? ' active' : '') + '" href="' + esc(hashFor(kind, item.id)) + '"><span>' + esc(displayLabelFor(kind, item)) + '</span><small>' + esc(displaySublabelFor(kind, item)) + '</small></a>').join("");
  }
  let richItem = id == null ? null : maps[kind].get(id);
  const indexEntry = id == null ? null : indexMaps[kind]?.get(id);
  if (id != null && !richItem && !indexEntry && indexLoadError) {
    renderIndexOnlyDetail(kind, {id, label: (kinds.find(([k]) => k === kind)?.[1] || kind) + " " + id, sublabel: ""}, indexLoadError instanceof Error ? indexLoadError.message : String(indexLoadError));
    return;
  }
  if (id != null && !richItem && indexEntry) {
    renderIndexOnlyDetail(kind, indexEntry, "Loading rich record chunk...");
    try {
      richItem = await loadRecord(kind, id);
      if (richItem) await hydrateRelatedRecords(kind, richItem);
    } catch (error) {
      if (requestId === renderRequestId) {
        renderIndexOnlyDetail(kind, indexEntry, error instanceof Error ? error.message : String(error));
      }
      return;
    }
  } else if (richItem) {
    await hydrateRelatedRecords(kind, richItem);
  }
  if (requestId !== renderRequestId) return;
  if (richItem || !indexEntry) {
    renderDetail(kind, richItem);
    scrollToRouteSection(currentRoute.section);
    if (richItem) renderAsyncDetailSections(kind, richItem, requestId);
  }
  else {
    renderIndexOnlyDetail(kind, indexEntry);
    scrollToRouteSection(currentRoute.section);
  }
}
function renderTabs() {
  const {kind} = route();
  const tabs = document.getElementById("tabs");
  tabs.innerHTML = kinds.map(([tabKind, label]) => '<a href="' + esc(hashFor(tabKind)) + '"' + (tabKind === kind ? ' class="active"' : '') + '>' + esc(label) + '</a>').join("");
}
function scrollToRouteSection(section) {
  const detail = document.getElementById("detail");
  const main = document.querySelector("main");
  const targetSection = normalizeRouteSection(section);
  requestAnimationFrame(() => {
    if (!targetSection) {
      if (main) main.scrollTop = 0;
      return;
    }
    const target = document.getElementById(sectionId(targetSection));
    if (target) target.scrollIntoView({block: "start"});
    else if (detail) detail.scrollIntoView({block: "start"});
  });
}
document.getElementById("search").addEventListener("input", event => {
  state.query = event.target.value;
  void renderList();
});
document.getElementById("global-search").addEventListener("change", event => {
  state.globalSearch = event.target.checked;
  document.getElementById("search").placeholder = state.globalSearch ? "Search all legend indexes" : "Search legends";
  void renderList();
});
function renderApp() {
  renderSummary();
  renderTabs();
  void renderList();
}
window.addEventListener("hashchange", renderApp);
if (!location.hash) router.navigate({kind: data.storyHooks?.length ? "story-hooks" : "people"}, {replace: true});
renderApp();
})();
</script>
</body>
</html>`;
}

const defaultLegendsViewerTopLevelArrayLimit = 40;
const legendsViewerChunkSize = 500;
const legendsViewerMentionChunkSize = 500;
const legendsViewerPersonMentionGroupLimit = 30;
const legendsViewerTopLevelArrayLimits: Record<string, number> = {
    civilizations: 100,
    settlements: 500,
    roads: 500,
    people: 100,
    births: 100,
    ageMilestones: 100,
    appearanceFeatures: 100,
    artifacts: 100,
    artifactConditions: 100,
    militaryUnits: 100,
    equipmentCaches: 100,
    spyNetworks: 100,
    spyOperations: 100,
    mythsAndMagic: 100,
    burials: 100,
    deathRecords: 100,
    woundLegacies: 100,
    needEpisodes: 100,
    reputationMilestones: 100,
    relationshipMilestones: 100,
    chapters: 100,
    storyHooks: 120,
    events: 300,
};
const defaultLegendsViewerPrimitiveListLimit = 80;
const defaultLegendsViewerObjectListLimit = 60;
const legendsViewerNestedArrayLimits: Record<string, number> = {
    adherentAgentIds: 120,
    activeCivilizationGoalIds: 80,
    agentIds: 40,
    artifactIds: 80,
    artifactConditionIds: 80,
    conditionRecordIds: 80,
    battleIds: 60,
    battleParticipationIds: 80,
    militaryUnitIds: 80,
    attackerUnitIds: 40,
    defenderUnitIds: 40,
    equipmentCacheIds: 80,
    spyOperationIds: 80,
    operationIds: 80,
    birthIds: 80,
    ageMilestoneIds: 80,
    appearanceFeatureIds: 80,
    deathRecordIds: 40,
    beliefAdherenceIds: 80,
    beliefIds: 80,
    belongingIds: 80,
    careerIds: 80,
    ceremonyIds: 80,
    ceremonyParticipationIds: 80,
    childAgentIds: 80,
    childIds: 80,
    chronicleIds: 80,
    civilizationGoalIds: 80,
    conspiratorAgentIds: 80,
    controlIds: 60,
    entityRefs: 24,
    doctrineIds: 80,
    epithetIds: 80,
    reputationMilestoneIds: 80,
    eventIds: 120,
    feudIds: 60,
    holdingIds: 80,
    injuryIds: 80,
    illnessIds: 80,
    woundLegacyIds: 80,
    burialIds: 80,
    needEpisodeIds: 80,
    keeperAgentIds: 80,
    lawIds: 80,
    memberAgentIds: 120,
    memberIds: 120,
    magicRoleHolderIds: 80,
    magicRoleIds: 80,
    membershipIds: 80,
    mournerAgentIds: 80,
    mythIds: 80,
    openProphecyIds: 80,
    rankIds: 80,
    memoryIds: 80,
    milestoneIds: 80,
    personalityShiftIds: 40,
    memorialIds: 80,
    officeTermIds: 80,
    opinionIds: 80,
    socialClaimIds: 80,
    participantAgentIds: 120,
    parentAgentIds: 80,
    preferenceIds: 80,
    prophecyIds: 80,
    projectIds: 80,
    projectParticipationIds: 80,
    provenance: 80,
    graveGoodArtifactIds: 80,
    graveGoodBelongingIds: 80,
    residenceIds: 80,
    rumorIds: 60,
    schemeIds: 60,
    secretIds: 60,
    socialBondIds: 80,
    relationshipMilestoneIds: 80,
    spreadSettlementIds: 80,
    structureIds: 80,
    subjectRefs: 24,
    seedRefs: 24,
    sacredSiteIds: 80,
    testimonyIds: 80,
    thoughtIds: 80,
    traditionIds: 80,
    unionIds: 80,
    writtenWorkIds: 80,
};

type LegendsViewerTrimStats = Map<string, {arrays: number; included: number; total: number; maxTotal: number}>;
type LegendRecord = Record<string, any>;
type LegendIndexLookups = {
    civilizations: Map<number, LegendRecord>;
    settlements: Map<number, LegendRecord>;
    people: Map<number, LegendRecord>;
    gods: Map<number, LegendRecord>;
};
const legendsViewerRecordSourceCache = new WeakMap<object, Record<string, LegendRecord[]>>();

const legendsViewerKindSpecs = [
    {kind: "story-hooks", key: "storyHooks"},
    {kind: "people", key: "people"},
    {kind: "births", key: "births"},
    {kind: "age-milestones", key: "ageMilestones"},
    {kind: "appearance-features", key: "appearanceFeatures"},
    {kind: "settlements", key: "settlements"},
    {kind: "settlement-controls", key: "settlementControls"},
    {kind: "natural-features", key: "naturalFeatures"},
    {kind: "person-allegiances", key: "personAllegiances"},
    {kind: "preferences", key: "preferences"},
    {kind: "traditions", key: "traditions"},
    {kind: "epithets", key: "epithets"},
    {kind: "reputation-milestones", key: "reputationMilestones"},
    {kind: "structures", key: "structures"},
    {kind: "households", key: "households"},
    {kind: "lineages", key: "lineages"},
    {kind: "chapters", key: "chapters"},
    {kind: "organizations", key: "organizations"},
    {kind: "memberships", key: "memberships"},
    {kind: "organization-ranks", key: "organizationRanks"},
    {kind: "beliefs", key: "beliefs"},
    {kind: "belief-adherences", key: "beliefAdherences"},
    {kind: "myths-magic", key: "mythsAndMagic"},
    {kind: "gods", key: "gods"},
    {kind: "commandments", key: "commandments"},
    {kind: "destinies", key: "destinies"},
    {kind: "miracles", key: "miracles"},
    {kind: "myths", key: "myths"},
    {kind: "doctrines", key: "doctrines"},
    {kind: "magic-roles", key: "magicRoles"},
    {kind: "prophecies", key: "prophecies"},
    {kind: "civilization-goals", key: "civilizationGoals"},
    {kind: "sacred-sites", key: "sacredSites"},
    {kind: "offices", key: "offices"},
    {kind: "office-terms", key: "officeTerms"},
    {kind: "laws", key: "laws"},
    {kind: "cases", key: "cases"},
    {kind: "testimonies", key: "testimonies"},
    {kind: "conflicts", key: "conflicts"},
    {kind: "battles", key: "battles"},
    {kind: "battle-participations", key: "battleParticipations"},
    {kind: "military-units", key: "militaryUnits"},
    {kind: "equipment-caches", key: "equipmentCaches"},
    {kind: "spy-networks", key: "spyNetworks"},
    {kind: "spy-operations", key: "spyOperations"},
    {kind: "injuries", key: "injuries"},
    {kind: "illnesses", key: "illnesses"},
    {kind: "care-records", key: "careRecords"},
    {kind: "wound-legacies", key: "woundLegacies"},
    {kind: "memorials", key: "memorials"},
    {kind: "burials", key: "burials"},
    {kind: "death-records", key: "deathRecords"},
    {kind: "ambitions", key: "ambitions"},
    {kind: "apprenticeships", key: "apprenticeships"},
    {kind: "skills", key: "skills"},
    {kind: "residences", key: "residences"},
    {kind: "careers", key: "careers"},
    {kind: "journeys", key: "journeys"},
    {kind: "roads", key: "roads"},
    {kind: "relationships", key: "relationships"},
    {kind: "relationship-milestones", key: "relationshipMilestones"},
    {kind: "unions", key: "unions"},
    {kind: "artifacts", key: "artifacts"},
    {kind: "artifact-conditions", key: "artifactConditions"},
    {kind: "chronicles", key: "chronicles"},
    {kind: "written-works", key: "writtenWorks"},
    {kind: "memories", key: "memories"},
    {kind: "thoughts", key: "thoughts"},
    {kind: "personality-shifts", key: "personalityShifts"},
    {kind: "need-episodes", key: "needEpisodes"},
    {kind: "opinions", key: "opinions"},
    {kind: "social-claims", key: "socialClaims"},
    {kind: "conversations", key: "conversations"},
    {kind: "rumors", key: "rumors"},
    {kind: "secrets", key: "secrets"},
    {kind: "schemes", key: "schemes"},
    {kind: "feuds", key: "feuds"},
    {kind: "oaths", key: "oaths"},
    {kind: "ceremonies", key: "ceremonies"},
    {kind: "ceremony-participations", key: "ceremonyParticipations"},
    {kind: "activities", key: "activities"},
    {kind: "teachings", key: "teachings"},
    {kind: "projects", key: "projects"},
    {kind: "project-participations", key: "projectParticipations"},
    {kind: "obligations", key: "obligations"},
    {kind: "holdings", key: "holdings"},
    {kind: "belongings", key: "belongings"},
    {kind: "possession-attachments", key: "possessionAttachments"},
    {kind: "estates", key: "estates"},
    {kind: "civilizations", key: "civilizations"},
    {kind: "events", key: "events"},
] as const;
const legendsViewerKindByKey = new Map<string, string>(legendsViewerKindSpecs.map(spec => [spec.key, spec.kind]));

function isJsonPrimitive(value: unknown) {
    return value == null || typeof value !== "object";
}

function recordViewerTrim(stats: LegendsViewerTrimStats, key: string, included: number, total: number) {
    const current = stats.get(key) ?? {arrays: 0, included: 0, total: 0, maxTotal: 0};
    current.arrays += 1;
    current.included += included;
    current.total += total;
    current.maxTotal = Math.max(current.maxTotal, total);
    stats.set(key, current);
}

function sanitizeLegendsViewerValue(value: unknown, key: string, stats: LegendsViewerTrimStats): unknown {
    if (Array.isArray(value)) {
        const allPrimitive = value.every(isJsonPrimitive);
        const limit = legendsViewerNestedArrayLimits[key] ?? (allPrimitive ? defaultLegendsViewerPrimitiveListLimit : defaultLegendsViewerObjectListLimit);
        const selected = value.length > limit ? value.slice(0, limit) : value;
        if (selected.length < value.length) recordViewerTrim(stats, key, selected.length, value.length);
        return selected.map(item => sanitizeLegendsViewerValue(item, key, stats));
    }
    if (value && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (let [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            if (childValue === undefined) continue;
            result[childKey] = sanitizeLegendsViewerValue(childValue, childKey, stats);
        }
        return result;
    }
    return value;
}

const legendsViewerExternalTextFields = ["headline", "description"] as const;

type LegendsViewerExternalText = Partial<Record<(typeof legendsViewerExternalTextFields)[number], string>>;

function recordHasLegendsViewerExternalText(record: LegendRecord): boolean {
    return legendsViewerExternalTextFields.some(field => typeof record[field] === "string" && record[field] !== "");
}

function extractLegendsViewerExternalText(record: LegendRecord): {record: LegendRecord; text?: LegendsViewerExternalText} {
    let compactRecord: LegendRecord | undefined;
    const text: LegendsViewerExternalText = {};

    for (let field of legendsViewerExternalTextFields) {
        const value = record[field];
        if (typeof value !== "string" || value === "") continue;
        text[field] = value;
        compactRecord ??= {...record};
        delete compactRecord[field];
    }

    if (!compactRecord) return {record};
    compactRecord.viewerText = true;
    return {record: compactRecord, text};
}

function makeLegendRecordMap(items: readonly LegendRecord[] | undefined) {
    return new Map<number, LegendRecord>((items ?? []).map(item => [Number(item.id), item]));
}

function legendIndexYears(value: unknown) {
    const year = Number(value);
    if (!Number.isFinite(year)) return "";
    return year < 0 ? `${Math.abs(year)} before year 0` : `year ${year}`;
}

function compactLegendIndexText(value: unknown, maxLength = 150) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function legendIndexPersonName(person: LegendRecord | undefined, id?: number) {
    if (!person) return `Person ${id ?? ""}`.trim();
    const epithet = Array.isArray(person.epithets) ? person.epithets[0]?.name : undefined;
    return epithet ? `${person.name} ${epithet}` : String(person.name ?? `Person ${person.id}`);
}

function legendIndexNamed(lookups: LegendIndexLookups, kind: keyof LegendIndexLookups, id: unknown, fallback: string) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return fallback;
    const item = lookups[kind].get(numericId);
    if (!item) return `${fallback} ${numericId}`;
    if (kind === "people") return legendIndexPersonName(item, numericId);
    return String(item.name ?? `${fallback} ${numericId}`);
}

function createLegendIndexLookups(legends: LegendsExport): LegendIndexLookups {
    return {
        civilizations: makeLegendRecordMap(legends.civilizations as LegendRecord[]),
        settlements: makeLegendRecordMap(legends.settlements as LegendRecord[]),
        people: makeLegendRecordMap(legends.people as LegendRecord[]),
        gods: makeLegendRecordMap(legends.gods as LegendRecord[]),
    };
}

function firstLegendRefId(item: LegendRecord, refKind: string): number | undefined {
    const refs = Array.isArray(item.subjectRefs) ? item.subjectRefs : [];
    const ref = refs.find(value => value && typeof value === "object" && value.kind === refKind);
    const id = Number(ref?.id);
    return Number.isFinite(id) ? id : undefined;
}

function addSyntheticChapterRefFields(chapter: LegendRecord) {
    const refFieldPairs: Array<[string, string]> = [
        ["person", "personId"],
        ["settlement", "settlementId"],
        ["civilization", "civilizationId"],
        ["artifact", "artifactId"],
        ["road", "roadId"],
        ["structure", "structureId"],
        ["conflict", "conflictId"],
        ["battle", "battleId"],
        ["organization", "organizationId"],
        ["household", "householdId"],
        ["lineage", "lineageId"],
        ["belief", "beliefId"],
        ["myth", "mythId"],
        ["doctrine", "doctrineId"],
        ["magic-role", "magicRoleId"],
        ["prophecy", "prophecyId"],
        ["civilization-goal", "civilizationGoalId"],
        ["sacred-site", "sacredSiteId"],
    ];
    for (let [refKind, field] of refFieldPairs) {
        if (chapter[field] != null) continue;
        const refId = firstLegendRefId(chapter, refKind);
        if (refId !== undefined) chapter[field] = refId;
    }
}

function chapterSourceEventIds(chapter: LegendRecord): number[] {
    return (Array.isArray(chapter.sourceEventIds) ? chapter.sourceEventIds : [])
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value >= 0);
}

function syntheticChapterKey(ownerKind: string, ownerId: unknown, chapter: LegendRecord) {
    const numericOwnerId = Number(ownerId);
    const startYear = Number(chapter.startYear);
    const endYear = chapter.endYear == null ? "" : String(Number(chapter.endYear));
    return [ownerKind, Number.isFinite(numericOwnerId) ? numericOwnerId : "", String(chapter.kind ?? chapter.chapterKind ?? ""), Number.isFinite(startYear) ? startYear : "", endYear, String(chapter.title ?? "")].join("|");
}

function createSyntheticChapterRecord(
    id: number,
    chapterType: string,
    ownerKind: string,
    owner: LegendRecord,
    ownerLabel: string,
    chapter: LegendRecord,
    extra: Record<string, unknown>,
): LegendRecord {
    const sourceEventIds = chapterSourceEventIds(chapter);
    const record: LegendRecord = {
        ...chapter,
        ...extra,
        id,
        name: `${ownerLabel}: ${compactLegendIndexText(chapter.title ?? chapter.kind ?? "chapter", 120)}`,
        chapterType,
        chapterKind: String(chapter.kind ?? chapterType),
        ownerKind,
        ownerId: Number(owner.id),
        ownerLabel,
        sourceEventIds,
        eventIds: sourceEventIds,
    };
    addSyntheticChapterRefFields(record);
    return record;
}

const legendsViewerChapterSources = [
    {ownerKind: "people", ownerKey: "people", chapterKey: "lifeChapters", chapterType: "life", extra: (owner: LegendRecord) => ({personId: owner.id, civilizationId: owner.civilizationId, settlementId: owner.settlementId})},
    {ownerKind: "relationships", ownerKey: "relationships", chapterKey: "relationshipChapters", chapterType: "relationship", extra: (owner: LegendRecord) => ({relationshipId: owner.id, civilizationId: owner.civilizationId, settlementId: owner.settlementId, agentIds: owner.agentIds})},
    {ownerKind: "settlements", ownerKey: "settlements", chapterKey: "placeChapters", chapterType: "place", extra: (owner: LegendRecord) => ({settlementId: owner.id, civilizationId: owner.civilizationId})},
    {ownerKind: "artifacts", ownerKey: "artifacts", chapterKey: "artifactChapters", chapterType: "artifact", extra: (owner: LegendRecord) => ({artifactId: owner.id, civilizationId: owner.civilizationId, settlementId: owner.settlementId, ownerSettlementId: owner.ownerSettlementId})},
    {ownerKind: "roads", ownerKey: "roads", chapterKey: "roadChapters", chapterType: "road", extra: (owner: LegendRecord) => ({roadId: owner.id, civilizationId: owner.civilizationId, fromSettlementId: owner.fromSettlementId, toSettlementId: owner.toSettlementId})},
    {ownerKind: "structures", ownerKey: "structures", chapterKey: "structureChapters", chapterType: "structure", extra: (owner: LegendRecord) => ({structureId: owner.id, civilizationId: owner.civilizationId, settlementId: owner.settlementId})},
    {ownerKind: "conflicts", ownerKey: "conflicts", chapterKey: "conflictChapters", chapterType: "conflict", extra: (owner: LegendRecord) => ({conflictId: owner.id, attackerCivilizationId: owner.attackerCivilizationId, defenderCivilizationId: owner.defenderCivilizationId, targetSettlementId: owner.targetSettlementId})},
    {ownerKind: "battles", ownerKey: "battles", chapterKey: "battleChapters", chapterType: "battle", extra: (owner: LegendRecord) => ({battleId: owner.id, conflictId: owner.conflictId, settlementId: owner.settlementId, attackerCivilizationId: owner.attackerCivilizationId, defenderCivilizationId: owner.defenderCivilizationId})},
    {ownerKind: "civilizations", ownerKey: "civilizations", chapterKey: "civilizationChapters", chapterType: "civilization", extra: (owner: LegendRecord) => ({civilizationId: owner.id})},
    {ownerKind: "organizations", ownerKey: "organizations", chapterKey: "organizationChapters", chapterType: "organization", extra: (owner: LegendRecord) => ({organizationId: owner.id, civilizationId: owner.civilizationId, settlementId: owner.settlementId})},
    {ownerKind: "households", ownerKey: "households", chapterKey: "householdChapters", chapterType: "household", extra: (owner: LegendRecord) => ({householdId: owner.id, civilizationId: owner.civilizationId, settlementId: owner.settlementId})},
    {ownerKind: "lineages", ownerKey: "lineages", chapterKey: "lineageChapters", chapterType: "lineage", extra: (owner: LegendRecord) => ({lineageId: owner.id, civilizationId: owner.civilizationId, settlementId: owner.originSettlementId})},
];

const legendsViewerChapterSourceByKind = new Map(legendsViewerChapterSources.map(source => [source.ownerKind, source]));

function createLegendsViewerChapters(legends: LegendsExport): LegendRecord[] {
    const legendRecord = legends as unknown as Record<string, LegendRecord[]>;
    const lookups = createLegendIndexLookups(legends);
    const chapters: LegendRecord[] = [];

    for (let source of legendsViewerChapterSources) {
        const owners = legendRecord[source.ownerKey] ?? [];
        for (let owner of owners) {
            const ownerChapters = Array.isArray(owner[source.chapterKey]) ? owner[source.chapterKey] as LegendRecord[] : [];
            if (!ownerChapters.length) continue;
            const ownerLabel = legendIndexLabelFor(source.ownerKind, owner, lookups);
            for (let chapter of ownerChapters) {
                chapters.push(createSyntheticChapterRecord(chapters.length, source.chapterType, source.ownerKind, owner, ownerLabel, chapter, source.extra(owner)));
            }
        }
    }

    return chapters;
}

function createLegendsViewerChapterIdMap(legends: LegendsExport): Map<string, number> {
    const source = createLegendsViewerRecordSource(legends);
    return new Map((source.chapters ?? []).map(chapter => [syntheticChapterKey(String(chapter.ownerKind), chapter.ownerId, chapter), Number(chapter.id)]));
}

function decorateLegendsViewerOwnerChapters(record: LegendRecord, ownerKind: string, chapterIds: Map<string, number>): LegendRecord {
    const source = legendsViewerChapterSourceByKind.get(ownerKind);
    if (!source || !Array.isArray(record[source.chapterKey])) return record;
    return {
        ...record,
        [source.chapterKey]: (record[source.chapterKey] as LegendRecord[]).map(chapter => {
            const chapterId = chapterIds.get(syntheticChapterKey(ownerKind, record.id, chapter));
            return chapterId === undefined ? chapter : {...chapter, chapterId};
        }),
    };
}

function createLegendsViewerRecordSource(legends: LegendsExport): Record<string, LegendRecord[]> {
    const cached = legendsViewerRecordSourceCache.get(legends as object);
    if (cached) return cached;
    const legendRecord = legends as unknown as Record<string, LegendRecord[]>;
    const source = {
        ...legendRecord,
        chapters: createLegendsViewerChapters(legends),
    };
    legendsViewerRecordSourceCache.set(legends as object, source);
    return source;
}

function legendIndexLabelFor(kind: string, item: LegendRecord, lookups: LegendIndexLookups) {
    if (kind === "people") return legendIndexPersonName(item);
    if (kind === "story-hooks") return compactLegendIndexText(item.name ?? `Story Hook ${item.id}`, 140);
    if (kind === "chapters") return compactLegendIndexText(item.name ?? item.title ?? `Chapter ${item.id}`, 140);
    if (kind === "roads") {
        return `${legendIndexNamed(lookups, "settlements", item.fromSettlementId, "Settlement")} to ${legendIndexNamed(lookups, "settlements", item.toSettlementId, "Settlement")} road`;
    }
    if (kind === "relationships") {
        const [first, second] = Array.isArray(item.agentIds) ? item.agentIds : [];
        return `${compactLegendIndexText(item.kind, 40) || "relationship"} of ${legendIndexNamed(lookups, "people", first, "Person")} and ${legendIndexNamed(lookups, "people", second, "Person")}`;
    }
    if (kind === "events") return `${legendIndexYears(item.year)}: ${compactLegendIndexText(item.headline, 110)}`;
    return compactLegendIndexText(item.name ?? item.headline ?? `${kind} ${item.id}`, 120);
}

function legendIndexSublabelFor(kind: string, item: LegendRecord, lookups: LegendIndexLookups) {
    if (kind === "people") {
        const status = item.alive ? `age ${item.age}` : `died ${legendIndexYears(item.diedYear)}`;
        return compactLegendIndexText(`${item.profession ?? "person"} of ${legendIndexNamed(lookups, "civilizations", item.civilizationId, "Civilization")}, ${item.mentalState ?? "mind unknown"}, ${status}`, 170);
    }
    if (kind === "story-hooks") {
        const parts = [
            `${item.kind ?? "story"} hook`,
            item.tone == null ? "" : `tone ${item.tone}`,
            item.score == null ? "" : `score ${item.score}`,
            item.urgency == null ? "" : `urgency ${item.urgency}`,
            item.civilizationId == null ? "" : legendIndexNamed(lookups, "civilizations", item.civilizationId, "Civilization"),
            item.settlementId == null ? "" : legendIndexNamed(lookups, "settlements", item.settlementId, "Settlement"),
            legendIndexYears(item.year),
        ].filter(Boolean);
        return compactLegendIndexText(parts.join(", "), 190);
    }
    if (kind === "chapters") {
        const start = legendIndexYears(item.startYear);
        const end = item.endYear == null || item.endYear === item.startYear ? "" : ` to ${legendIndexYears(item.endYear)}`;
        return compactLegendIndexText(`${item.chapterType ?? "record"} ${item.chapterKind ?? item.kind ?? "chapter"}, ${item.status ?? "unknown"}, ${start}${end}`, 170);
    }
    if (kind === "events") {
        return compactLegendIndexText(`${item.type ?? "event"}, ${legendIndexYears(item.year)}`, 90);
    }
    if (kind === "civilizations") {
        const parts = [
            item.status == null ? "" : String(item.status),
            item.originKind == null ? "" : String(item.originKind),
            `population ${item.population ?? "unknown"}`,
            item.creationDomain == null ? "" : `creation ${item.creationDomain}`,
            item.creationSeatScore == null ? "" : `seat score ${item.creationSeatScore}`,
            item.creationGodId == null ? "" : `creator ${legendIndexNamed(lookups, "gods", item.creationGodId, "God")}`,
            item.fallenYear == null ? "" : `fallen ${legendIndexYears(item.fallenYear)}`,
        ].filter(Boolean);
        return compactLegendIndexText(parts.join(", "), 170);
    }
    if (kind === "artifact-conditions") {
        return compactLegendIndexText(`${item.kind ?? "condition"}, ${item.condition ?? "unknown"}, ${legendIndexNamed(lookups, "settlements", item.settlementId, "Settlement")}, severity ${item.severity ?? "unknown"}, ${legendIndexYears(item.year)}`, 170);
    }

    const parts: string[] = [];
    for (let key of ["type", "kind", "status", "role", "outcome", "severity", "quality", "material", "domain", "profession"]) {
        if (typeof item[key] === "string" && item[key]) parts.push(item[key]);
    }
    if (item.civilizationId != null) parts.push(legendIndexNamed(lookups, "civilizations", item.civilizationId, "Civilization"));
    if (item.settlementId != null) parts.push(legendIndexNamed(lookups, "settlements", item.settlementId, "Settlement"));
    if (item.fromSettlementId != null || item.toSettlementId != null) {
        parts.push(`${legendIndexNamed(lookups, "settlements", item.fromSettlementId, "Settlement")} to ${legendIndexNamed(lookups, "settlements", item.toSettlementId, "Settlement")}`);
    }
    for (let [field, label] of [["year", ""], ["foundedYear", "founded "], ["createdYear", "created "], ["startedYear", "started "], ["openedYear", "opened "], ["bornYear", "born "]]) {
        if (item[field] != null) parts.push(`${label}${legendIndexYears(item[field])}`.trim());
    }
    if (typeof item.population === "number") parts.push(`population ${item.population}`);
    if (typeof item.description === "string") parts.push(compactLegendIndexText(item.description, 120));
    return compactLegendIndexText(parts.filter(Boolean).slice(0, 8).join(", "), 220);
}
const legendIndexFacetFields = [
    "id",
    "age",
    "alive",
    "artifactId",
    "attackerCivilizationId",
    "battleId",
    "ageMilestoneId",
    "appearanceFeatureId",
    "birthEventId",
    "birthId",
    "careRecordId",
    "commandmentId",
    "commandmentStyle",
    "destinyId",
    "woundLegacyId",
    "deathRecordId",
    "domain",
    "chapterKind",
    "chapterType",
    "civilizationId",
    "conflictId",
    "createdYear",
    "creationDomain",
    "creationGodId",
    "creationSeatScore",
    "collapsePressure",
    "collapseStage",
    "defenderCivilizationId",
    "endYear",
    "fallenYear",
    "favor",
    "foundedYear",
    "fromSettlementId",
    "givenYear",
    "godId",
    "householdId",
    "influence",
    "kind",
    "lineageId",
    "miracleBias",
    "miracleId",
    "openedYear",
    "organizationId",
    "originSettlementId",
    "ownerAgentId",
    "ownerId",
    "ownerKind",
    "ownerSettlementId",
    "originKind",
    "parentCivilizationId",
    "parentAgentIds",
    "patientAgentId",
    "personId",
    "population",
    "profession",
    "quality",
    "renown",
    "resolvedYear",
    "roadId",
    "reputation",
    "restoredCivilizationId",
    "settlementId",
    "severity",
    "score",
    "startYear",
    "startedYear",
    "status",
    "strength",
    "structureId",
    "title",
    "tone",
    "toSettlementId",
    "type",
    "year",
] as const;

function addLegendIndexFacets(entry: Record<string, unknown>, item: LegendRecord) {
    for (let field of legendIndexFacetFields) {
        const value = item[field];
        if (value == null) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            entry[field] = value;
        }
    }
    if (Array.isArray(item.epithets)) entry.epithetCount = item.epithets.length;
}

function createLegendsViewerIndex(legends: LegendsExport) {
    const legendRecord = createLegendsViewerRecordSource(legends);
    const lookups = createLegendIndexLookups(legends);
    const index: Record<string, Array<{id: number; label: string; sublabel: string}>> = {};

    for (let spec of legendsViewerKindSpecs) {
        const records = legendRecord[spec.key] ?? [];
        index[spec.kind] = records.map(item => {
            const entry: {id: number; label: string; sublabel: string; year?: number; headline?: string} = {
                id: Number(item.id),
                label: legendIndexLabelFor(spec.kind, item, lookups),
                sublabel: legendIndexSublabelFor(spec.kind, item, lookups),
            };
            if (spec.kind === "events") {
                entry.year = Number(item.year || 0);
                entry.headline = compactLegendIndexText(item.headline ?? entry.label, 160);
            }
            addLegendIndexFacets(entry, item);
            return entry;
        });
    }

    return index;
}

type LegendMentionEntry = {
    kind: string;
    id: number;
    label: string;
    year?: number;
};

const legendMentionSourceSkipKinds = new Set(["people", "settlements", "civilizations", "events"]);
const legendsViewerMentionSpecs = legendsViewerKindSpecs.filter(spec => !legendMentionSourceSkipKinds.has(spec.kind));

const legendPersonMentionScalarFields = [
    "agentId",
    "authorAgentId",
    "creatorAgentId",
    "creditorAgentId",
    "centralAgentId",
    "decedentAgentId",
    "debtorAgentId",
    "founderAgentId",
    "healerAgentId",
    "holderAgentId",
    "hostAgentId",
    "leadAgentId",
    "leaderAgentId",
    "listenerAgentId",
    "mentorAgentId",
    "apprenticeAgentId",
    "ownerAgentId",
    "patientAgentId",
    "personId",
    "previousOwnerAgentId",
    "primaryAgentId",
    "recipientAgentId",
    "speakerAgentId",
    "sponsorAgentId",
    "swearerAgentId",
    "targetAgentId",
    "tellerAgentId",
    "witnessAgentId",
] as const;

const legendPersonMentionArrayFields = [
    "agentIds",
    "casualtyAgentIds",
    "childAgentIds",
    "conspiratorAgentIds",
    "keeperAgentIds",
    "heirAgentIds",
    "mournerAgentIds",
    "parentAgentIds",
    "participantAgentIds",
    "partnerAgentIds",
    "sideAAgentIds",
    "sideBAgentIds",
    "spreadAgentIds",
    "witnessAgentIds",
    "workerAgentIds",
] as const;

const legendSettlementMentionScalarFields = [
    "originSettlementId",
    "ownerSettlementId",
    "previousSettlementId",
    "settlementId",
    "targetSettlementId",
    "fromSettlementId",
    "toSettlementId",
] as const;

const legendSettlementMentionArrayFields = [
    "capturedSettlementIds",
    "contestedSettlementIds",
    "settlementIds",
    "spreadSettlementIds",
] as const;

const legendArtifactMentionScalarFields = [
    "artifactId",
    "targetArtifactId",
] as const;

const legendArtifactMentionArrayFields = [
    "artifactIds",
    "capturedArtifactIds",
    "graveGoodArtifactIds",
] as const;

const legendArtifactConditionMentionScalarFields = [
    "artifactConditionId",
] as const;

const legendArtifactConditionMentionArrayFields = [
    "artifactConditionIds",
    "conditionRecordIds",
] as const;

const legendMentionRefKindByKind: Record<string, string> = {
    people: "person",
    settlements: "settlement",
    "settlement-controls": "settlement-control",
    "natural-features": "natural-feature",
    "person-allegiances": "person-allegiance",
    preferences: "preference",
    traditions: "tradition",
    epithets: "epithet",
    "reputation-milestones": "reputation-milestone",
    structures: "structure",
    households: "household",
    lineages: "lineage",
    organizations: "organization",
    memberships: "membership",
    "organization-ranks": "organization-rank",
    beliefs: "belief",
    "belief-adherences": "belief-adherence",
    "myths-magic": "myths-magic",
    gods: "god",
    commandments: "commandment",
    destinies: "destiny",
    miracles: "miracle",
    myths: "myth",
    doctrines: "doctrine",
    "magic-roles": "magic-role",
    prophecies: "prophecy",
    "civilization-goals": "civilization-goal",
    "sacred-sites": "sacred-site",
    offices: "office",
    "office-terms": "office-term",
    laws: "law",
    cases: "case",
    testimonies: "testimony",
    conflicts: "conflict",
    battles: "battle",
    "battle-participations": "battle-participation",
    "military-units": "military-unit",
    "equipment-caches": "equipment-cache",
    "spy-networks": "spy-network",
    "spy-operations": "spy-operation",
    injuries: "injury",
    illnesses: "illness",
    "care-records": "care-record",
    "wound-legacies": "wound-legacy",
    memorials: "memorial",
    burials: "burial",
    "death-records": "death-record",
    births: "birth",
    "age-milestones": "age-milestone",
    "appearance-features": "appearance-feature",
    ambitions: "ambition",
    apprenticeships: "apprenticeship",
    skills: "skill",
    residences: "residence",
    careers: "career",
    journeys: "journey",
    roads: "road",
    relationships: "relationship",
    "relationship-milestones": "relationship-milestone",
    unions: "union",
    artifacts: "artifact",
    "artifact-conditions": "artifact-condition",
    chapters: "chapter",
    chronicles: "chronicle",
    "written-works": "written-work",
    memories: "memory",
    thoughts: "thought",
    "personality-shifts": "personality-shift",
    "need-episodes": "need-episode",
    opinions: "opinion",
    "social-claims": "social-claim",
    conversations: "conversation",
    rumors: "rumor",
    secrets: "secret",
    schemes: "scheme",
    feuds: "feud",
    oaths: "oath",
    ceremonies: "ceremony",
    "ceremony-participations": "ceremony-participation",
    activities: "activity",
    teachings: "teaching",
    projects: "project",
    "project-participations": "project-participation",
    obligations: "obligation",
    holdings: "holding",
    belongings: "belonging",
    "possession-attachments": "possession-attachment",
    estates: "estate",
    "story-hooks": "story-hook",
    civilizations: "civilization",
    events: "event",
};

const legendMentionFieldKinds: Record<string, string> = {
    storyHookId: "story-hooks",
    storyHookIds: "story-hooks",
    ...Object.fromEntries(legendPersonMentionScalarFields.map(field => [field, "people"])),
    ...Object.fromEntries(legendPersonMentionArrayFields.map(field => [field, "people"])),
    ...Object.fromEntries(legendSettlementMentionScalarFields.map(field => [field, "settlements"])),
    ...Object.fromEntries(legendSettlementMentionArrayFields.map(field => [field, "settlements"])),
    ...Object.fromEntries(legendArtifactMentionScalarFields.map(field => [field, "artifacts"])),
    ...Object.fromEntries(legendArtifactMentionArrayFields.map(field => [field, "artifacts"])),
    ...Object.fromEntries(legendArtifactConditionMentionScalarFields.map(field => [field, "artifact-conditions"])),
    ...Object.fromEntries(legendArtifactConditionMentionArrayFields.map(field => [field, "artifact-conditions"])),
    activityId: "activities",
    activityIds: "activities",
    teachingId: "teachings",
    teachingIds: "teachings",
    adherenceIds: "belief-adherences",
    ambitionId: "ambitions",
    ambitionIds: "ambitions",
    apprenticeshipId: "apprenticeships",
    apprenticeshipIds: "apprenticeships",
    battleId: "battles",
    battleIds: "battles",
    battleEventId: "events",
    battleParticipationId: "battle-participations",
    battleParticipationIds: "battle-participations",
    attackerUnitIds: "military-units",
    defenderUnitIds: "military-units",
    militaryUnitId: "military-units",
    militaryUnitIds: "military-units",
    commanderAgentId: "people",
    troopAgentIds: "people",
    unitId: "military-units",
    unitIds: "military-units",
    equipmentCacheId: "equipment-caches",
    equipmentCacheIds: "equipment-caches",
    handlerAgentId: "people",
    spyNetworkId: "spy-networks",
    spyNetworkIds: "spy-networks",
    networkId: "spy-networks",
    networkIds: "spy-networks",
    spyOperationId: "spy-operations",
    spyOperationIds: "spy-operations",
    operationId: "spy-operations",
    operationIds: "spy-operations",
    birthId: "births",
    birthIds: "births",
    birthEventId: "events",
    ageMilestoneId: "age-milestones",
    ageMilestoneIds: "age-milestones",
    appearanceFeatureId: "appearance-features",
    appearanceFeatureIds: "appearance-features",
    burialId: "burials",
    burialIds: "burials",
    careRecordId: "care-records",
    careRecordIds: "care-records",
    woundLegacyId: "wound-legacies",
    woundLegacyIds: "wound-legacies",
    beliefAdherenceId: "belief-adherences",
    beliefAdherenceIds: "belief-adherences",
    beliefId: "beliefs",
    beliefIds: "beliefs",
    mythsMagicId: "myths-magic",
    mythsMagicIds: "myths-magic",
    godId: "gods",
    godIds: "gods",
    creationGodId: "gods",
    patronGodId: "gods",
    commandmentId: "commandments",
    commandmentIds: "commandments",
    destinyId: "destinies",
    destinyIds: "destinies",
    activeDestinyIds: "destinies",
    miracleId: "miracles",
    miracleIds: "miracles",
    mythId: "myths",
    mythIds: "myths",
    doctrineId: "doctrines",
    doctrineIds: "doctrines",
    magicRoleId: "magic-roles",
    magicRoleIds: "magic-roles",
    prophecyId: "prophecies",
    prophecyIds: "prophecies",
    civilizationGoalId: "civilization-goals",
    civilizationGoalIds: "civilization-goals",
    sacredSiteId: "sacred-sites",
    sacredSiteIds: "sacred-sites",
    epithetId: "epithets",
    epithetIds: "epithets",
    reputationMilestoneId: "reputation-milestones",
    reputationMilestoneIds: "reputation-milestones",
    belongingId: "belongings",
    belongingIds: "belongings",
    possessionAttachmentId: "possession-attachments",
    possessionAttachmentIds: "possession-attachments",
    organizationRankId: "organization-ranks",
    organizationRankIds: "organization-ranks",
    currentRankId: "organization-ranks",
    previousRankId: "organization-ranks",
    rankIds: "organization-ranks",
    careerId: "careers",
    careerIds: "careers",
    caseId: "cases",
    caseIds: "cases",
    chapterId: "chapters",
    chapterIds: "chapters",
    testimonyId: "testimonies",
    testimonyIds: "testimonies",
    casualtyEventId: "events",
    ceremonyId: "ceremonies",
    ceremonyIds: "ceremonies",
    ceremonyEventId: "events",
    ceremonyParticipationId: "ceremony-participations",
    ceremonyParticipationIds: "ceremony-participations",
    chronicleId: "chronicles",
    chronicleIds: "chronicles",
    civilizationId: "civilizations",
    civilizationIds: "civilizations",
    conflictId: "conflicts",
    conflictIds: "conflicts",
    controlIds: "settlement-controls",
    defenderCivilizationId: "civilizations",
    destinationStructureId: "structures",
    deathEventId: "events",
    deathRecordId: "death-records",
    deathRecordIds: "death-records",
    disbandedEventId: "events",
    disputeCaseIds: "cases",
    disputeFeudIds: "feuds",
    disputeOathIds: "oaths",
    disputeRumorIds: "rumors",
    endEventId: "events",
    endedEventId: "events",
    eventId: "events",
    exposedEventId: "events",
    estateId: "estates",
    estateIds: "estates",
    feudId: "feuds",
    feudIds: "feuds",
    formedEventId: "events",
    graveGoodBelongingIds: "belongings",
    holdingId: "holdings",
    holdingIds: "holdings",
    householdId: "households",
    householdIds: "households",
    illnessId: "illnesses",
    illnessIds: "illnesses",
    injuryId: "injuries",
    injuryIds: "injuries",
    journeyId: "journeys",
    journeyIds: "journeys",
    lawId: "laws",
    lawIds: "laws",
    lineageId: "lineages",
    lineageIds: "lineages",
    membershipId: "memberships",
    membershipIds: "memberships",
    memorialId: "memorials",
    memorialIds: "memorials",
    memoryId: "memories",
    memoryIds: "memories",
    personalityShiftId: "personality-shifts",
    personalityShiftIds: "personality-shifts",
    needEpisodeId: "need-episodes",
    needEpisodeIds: "need-episodes",
    officeId: "offices",
    officeIds: "offices",
    officeTermId: "office-terms",
    officeTermIds: "office-terms",
    opinionId: "opinions",
    opinionIds: "opinions",
    socialClaimId: "social-claims",
    socialClaimIds: "social-claims",
  opposingCivilizationId: "civilizations",
  organizationId: "organizations",
  organizationIds: "organizations",
  originStructureId: "structures",
  obligationId: "obligations",
    obligationIds: "obligations",
    oathId: "oaths",
    oathIds: "oaths",
  personAllegianceId: "person-allegiances",
  personAllegianceIds: "person-allegiances",
  parentCivilizationId: "civilizations",
  preferenceId: "preferences",
    preferenceIds: "preferences",
  previousCivilizationId: "civilizations",
  previousStructureId: "structures",
  restoredCivilizationId: "civilizations",
    projectId: "projects",
    projectIds: "projects",
    projectEventId: "events",
    projectParticipationId: "project-participations",
    projectParticipationIds: "project-participations",
    recordedEventId: "events",
    relationshipId: "relationships",
    relationshipMilestoneId: "relationship-milestones",
    relationshipMilestoneIds: "relationship-milestones",
    milestoneIds: "relationship-milestones",
    residenceId: "residences",
    residenceIds: "residences",
    residenceStructureId: "structures",
    revealedEventId: "events",
    resolvedEventId: "events",
    roadIds: "roads",
    rumorId: "rumors",
    rumorIds: "rumors",
    schemeId: "schemes",
    schemeIds: "schemes",
    secretId: "secrets",
    secretIds: "secrets",
    settlementControlId: "settlement-controls",
    naturalFeatureId: "natural-features",
    naturalFeatureIds: "natural-features",
    settledEventId: "events",
    skillId: "skills",
    skillRecordIds: "skills",
    studentAgentId: "people",
    socialBondIds: "relationships",
    sourceChronicleId: "chronicles",
    sourceEventId: "events",
    sourceEventIds: "events",
    sourceMemoryId: "memories",
    sourceOpinionId: "opinions",
    sourcePersonalityShiftId: "personality-shifts",
    sourcePreferenceId: "preferences",
    sourceTraditionId: "traditions",
    startEventId: "events",
    startedEventId: "events",
    structureId: "structures",
    structureIds: "structures",
    targetBeliefId: "beliefs",
    targetCivilizationGoalId: "civilization-goals",
    targetAmbitionId: "ambitions",
    targetCaseId: "cases",
    targetCivilizationId: "civilizations",
    targetEventId: "events",
    targetFeudId: "feuds",
    targetOfficeId: "offices",
    targetProphecyId: "prophecies",
    targetSecretId: "secrets",
    termIds: "office-terms",
    thoughtId: "thoughts",
    thoughtIds: "thoughts",
    conversationId: "conversations",
    conversationIds: "conversations",
    traditionId: "traditions",
    traditionIds: "traditions",
    transferredEventId: "events",
    transferredEventIds: "events",
    unionId: "unions",
    unionIds: "unions",
    writtenWorkId: "written-works",
    writtenWorkIds: "written-works",
};

type LegendMentionTarget = {
    kind: string;
    key: string;
    refKind: string;
    scalarFields: string[];
    arrayFields: string[];
};

function legendMentionFieldsForKind(kind: string, array: boolean): string[] {
    return Object.entries(legendMentionFieldKinds)
        .filter(([field, targetKind]) => targetKind === kind && field.endsWith("Ids") === array)
        .map(([field]) => field);
}

const legendMentionTargets: LegendMentionTarget[] = legendsViewerKindSpecs
    .flatMap(spec => {
        const refKind = legendMentionRefKindByKind[spec.kind];
        if (!refKind) return [];
        return [{
            kind: spec.kind,
            key: spec.key,
            refKind,
            scalarFields: legendMentionFieldsForKind(spec.kind, false),
            arrayFields: legendMentionFieldsForKind(spec.kind, true),
        }];
    });

function addLegendMentionId(ids: Set<number>, value: unknown) {
    const id = Number(value);
    if (Number.isFinite(id) && id >= 0) ids.add(id);
}

function addLegendMentionRefs(ids: Set<number>, value: unknown, refKind: string) {
    if (!Array.isArray(value)) return;
    for (let ref of value) {
        if (!ref || typeof ref !== "object") continue;
        const record = ref as Record<string, unknown>;
        if (record.kind === refKind) addLegendMentionId(ids, record.id);
    }
}

function legendMentionYear(item: LegendRecord) {
    for (let field of ["updatedYear", "year", "swornYear", "createdYear", "acquiredYear", "foundedYear", "startedYear", "openedYear", "builtYear", "onsetYear", "startYear"]) {
        const year = Number(item[field]);
        if (Number.isFinite(year)) return year;
    }
    return undefined;
}

function createLegendMentionEntry(kind: string, item: LegendRecord, lookups: LegendIndexLookups): LegendMentionEntry {
    const year = legendMentionYear(item);
    const entry: LegendMentionEntry = {
        kind,
        id: Number(item.id),
        label: legendIndexLabelFor(kind, item, lookups),
    };
    if (year !== undefined) entry.year = year;
    return entry;
}

function collectLegendMentionIds(item: LegendRecord, target: (typeof legendMentionTargets)[number]) {
    const ids = new Set<number>();
    for (let field of target.scalarFields) {
        addLegendMentionId(ids, item[field]);
    }
    for (let field of target.arrayFields) {
        const values = item[field];
        if (!Array.isArray(values)) continue;
        for (let value of values) addLegendMentionId(ids, value);
    }
    addLegendMentionRefs(ids, item.subjectRefs, target.refKind);
    addLegendMentionRefs(ids, item.seedRefs, target.refKind);
    addLegendMentionRefs(ids, item.entityRefs, target.refKind);
    addLegendMentionRefs(ids, item.targetRefs, target.refKind);
    addLegendMentionRefs(ids, item.depictionRefs, target.refKind);
    addLegendMentionRefs(ids, item.dedicationRefs, target.refKind);
    const targetRef = item.targetRef;
    if (targetRef && typeof targetRef === "object") {
        const record = targetRef as Record<string, unknown>;
        if (record.kind === target.refKind) addLegendMentionId(ids, record.id);
    }
    return ids;
}

function compactLegendMentionGroups(byId: Map<number, Record<string, LegendMentionEntry[]>>) {
    const result: Record<string, Record<string, LegendMentionEntry[]>> = {};
    for (let [entityId, groups] of byId) {
        const compactGroups: Record<string, LegendMentionEntry[]> = {};
        for (let [group, entries] of Object.entries(groups)) {
            compactGroups[group] = entries
                .slice()
                .sort((a, b) => Number(b.year ?? -999999) - Number(a.year ?? -999999) || b.id - a.id)
                .slice(0, legendsViewerPersonMentionGroupLimit);
        }
        result[String(entityId)] = compactGroups;
    }
    return result;
}

function addLegendMentionEntryToTarget(
    byTarget: Record<string, Map<number, Record<string, LegendMentionEntry[]>>>,
    targetKind: string,
    targetId: unknown,
    sourceKind: string,
    entry: LegendMentionEntry,
) {
    const id = Number(targetId);
    if (!Number.isFinite(id) || id < 0) return;
    const targetMap = byTarget[targetKind];
    if (!targetMap) return;
    let groups = targetMap.get(id);
    if (!groups) {
        groups = {};
        targetMap.set(id, groups);
    }
    (groups[sourceKind] ??= []).push(entry);
}

function addChapterTargetMentions(
    legendRecord: Record<string, LegendRecord[]>,
    lookups: LegendIndexLookups,
    byTarget: Record<string, Map<number, Record<string, LegendMentionEntry[]>>>,
) {
    const specByKind = new Map<string, (typeof legendsViewerKindSpecs)[number]>(legendsViewerKindSpecs.map(spec => [spec.kind, spec]));
    const recordsByKind = new Map<string, Map<number, LegendRecord>>();
    const recordMapForKind = (kind: string) => {
        let map = recordsByKind.get(kind);
        if (map) return map;
        const spec = specByKind.get(kind);
        map = makeLegendRecordMap(spec ? legendRecord[spec.key] : []);
        recordsByKind.set(kind, map);
        return map;
    };

    for (let chapter of legendRecord.chapters ?? []) {
        const chapterId = Number(chapter.id);
        if (!Number.isFinite(chapterId)) continue;

        const ownerKind = String(chapter.ownerKind ?? "");
        const owner = recordMapForKind(ownerKind).get(Number(chapter.ownerId));
        if (owner) {
            addLegendMentionEntryToTarget(byTarget, "chapters", chapterId, ownerKind, createLegendMentionEntry(ownerKind, owner, lookups));
        }

        for (let eventId of chapterSourceEventIds(chapter)) {
            const event = recordMapForKind("events").get(eventId);
            if (event) addLegendMentionEntryToTarget(byTarget, "chapters", chapterId, "events", createLegendMentionEntry("events", event, lookups));
        }
    }
}

function createLegendsMentionIndexes(legends: LegendsExport) {
    const legendRecord = createLegendsViewerRecordSource(legends);
    const lookups = createLegendIndexLookups(legends);
    const byTarget = Object.fromEntries(
        legendMentionTargets.map(target => [target.kind, new Map<number, Record<string, LegendMentionEntry[]>>()]),
    ) as Record<string, Map<number, Record<string, LegendMentionEntry[]>>>;

    for (let spec of legendsViewerMentionSpecs) {
        const records = legendRecord[spec.key] ?? [];
        for (let item of records) {
            const entry = createLegendMentionEntry(spec.kind, item, lookups);
            for (let target of legendMentionTargets) {
                const ids = collectLegendMentionIds(item, target);
                if (!ids.size) continue;
                const targetMap = byTarget[target.kind];
                for (let entityId of ids) {
                    let groups = targetMap.get(entityId);
                    if (!groups) {
                        groups = {};
                        targetMap.set(entityId, groups);
                    }
                    (groups[spec.kind] ??= []).push(entry);
                }
            }
        }
    }

    addChapterTargetMentions(legendRecord, lookups, byTarget);

    return Object.fromEntries(
        Object.entries(byTarget).map(([kind, index]) => [kind, compactLegendMentionGroups(index)]),
    ) as Record<string, Record<string, Record<string, LegendMentionEntry[]>>>;
}

function createLegendsViewerIndexMetadata(legends: LegendsExport) {
    const legendRecord = createLegendsViewerRecordSource(legends);
    return {
        basePath: "indexes",
        kinds: Object.fromEntries(
            legendsViewerKindSpecs
                .filter(spec => (legendRecord[spec.key] ?? []).length > 0)
                .map(spec => [spec.kind, true]),
        ),
    };
}

function createLegendsViewerChunkMetadata(legends: LegendsExport) {
    const legendRecord = createLegendsViewerRecordSource(legends);
    return {
        basePath: "records",
        chunkSize: legendsViewerChunkSize,
        cacheChunks: 32,
        kinds: Object.fromEntries(
            legendsViewerKindSpecs
                .filter(spec => (legendRecord[spec.key] ?? []).length > 0)
                .map(spec => [spec.kind, true]),
        ),
    };
}

function createLegendsViewerTextMetadata(legends: LegendsExport) {
    const legendRecord = createLegendsViewerRecordSource(legends);
    return {
        basePath: "texts",
        chunkSize: legendsViewerChunkSize,
        cacheChunks: 32,
        fields: legendsViewerExternalTextFields,
        kinds: Object.fromEntries(
            legendsViewerKindSpecs
                .filter(spec => (legendRecord[spec.key] ?? []).some(recordHasLegendsViewerExternalText))
                .map(spec => [spec.kind, true]),
        ),
    };
}

function createLegendsViewerMentionMetadata(legends: LegendsExport) {
    const legendRecord = createLegendsViewerRecordSource(legends);
    return {
        basePath: "mentions",
        chunkSize: legendsViewerMentionChunkSize,
        cacheChunks: 64,
        groupLimit: legendsViewerPersonMentionGroupLimit,
        kinds: Object.fromEntries(
            legendMentionTargets
                .filter(target => (legendRecord[target.key] ?? []).length > 0)
                .map(target => [target.kind, true]),
        ),
    };
}

function createLegendsViewerArchive(legends: LegendsExport, mapImagePath?: string) {
    const viewer = {...legends} as Record<string, unknown>;
    const legendRecord = createLegendsViewerRecordSource(legends);
    const chapterIds = createLegendsViewerChapterIdMap(legends);
    const trimStats: LegendsViewerTrimStats = new Map();

    for (let [key, value] of Object.entries(legends)) {
        if (key === "history" && Array.isArray(value)) {
            viewer[key] = [];
            recordViewerTrim(trimStats, key, 0, value.length);
            continue;
        }
        if (Array.isArray(value)) {
            const limit = legendsViewerTopLevelArrayLimits[key] ?? defaultLegendsViewerTopLevelArrayLimit;
            const selected = value.length > limit ? value.slice(0, limit) : value;
            if (selected.length < value.length) recordViewerTrim(trimStats, key, selected.length, value.length);
            const kind = legendsViewerKindByKey.get(key);
            viewer[key] = selected.map(item => sanitizeLegendsViewerValue(kind ? decorateLegendsViewerOwnerChapters(item as LegendRecord, kind, chapterIds) : item, key, trimStats));
        }
    }

    const chapters = legendRecord.chapters ?? [];
    if (chapters.length > 0) {
        const limit = legendsViewerTopLevelArrayLimits.chapters ?? defaultLegendsViewerTopLevelArrayLimit;
        const selected = chapters.length > limit ? chapters.slice(0, limit) : chapters;
        if (selected.length < chapters.length) recordViewerTrim(trimStats, "chapters", selected.length, chapters.length);
        viewer.chapters = selected.map(item => sanitizeLegendsViewerValue(item, "chapters", trimStats));
        viewer.chapterCount = chapters.length;
    }

    const truncations = [...trimStats.entries()]
        .map(([key, stats]) => ({key, arrays: stats.arrays, included: stats.included, total: stats.total, maxTotal: stats.maxTotal}))
        .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

    viewer.viewerSample = {
        truncated: truncations.length > 0,
        defaultPrimitiveListLimit: defaultLegendsViewerPrimitiveListLimit,
        defaultObjectListLimit: defaultLegendsViewerObjectListLimit,
        truncations,
    };
    viewer.viewerIndex = {};
    viewer.viewerIndexes = createLegendsViewerIndexMetadata(legends);
    viewer.viewerChunks = createLegendsViewerChunkMetadata(legends);
    viewer.viewerTexts = createLegendsViewerTextMetadata(legends);
    viewer.viewerMentions = createLegendsViewerMentionMetadata(legends);
    if (mapImagePath) {
        viewer.viewerMap = {imagePath: mapImagePath};
    }

    return viewer;
}

function writeLegendsViewerIndexes(legends: LegendsExport, htmlPath: string) {
    const outputPath = path.resolve(htmlPath);
    const indexesDir = path.join(path.dirname(outputPath), "indexes");
    const fullIndex = createLegendsViewerIndex(legends);
    fs.rmSync(indexesDir, {recursive: true, force: true});

    for (let [kind, entries] of Object.entries(fullIndex)) {
        writeJsonPayload(path.join(indexesDir, `${kind}.json`), entries);
    }

    console.log(`Wrote Legends indexes to ${indexesDir}`);
}

function writeLegendsViewerChunks(legends: LegendsExport, htmlPath: string) {
    const outputPath = path.resolve(htmlPath);
    const recordsDir = path.join(path.dirname(outputPath), "records");
    const textsDir = path.join(path.dirname(outputPath), "texts");
    const legendRecord = createLegendsViewerRecordSource(legends);
    const chapterIds = createLegendsViewerChapterIdMap(legends);
    fs.rmSync(recordsDir, {recursive: true, force: true});
    fs.rmSync(textsDir, {recursive: true, force: true});

    for (let spec of legendsViewerKindSpecs) {
        const records = legendRecord[spec.key] ?? [];
        if (!records.length) continue;

        const kindDir = path.join(recordsDir, spec.kind);
        const textKindDir = path.join(textsDir, spec.kind);
        for (let start = 0; start < records.length; start += legendsViewerChunkSize) {
            const chunkId = Math.floor(start / legendsViewerChunkSize);
            const stats: LegendsViewerTrimStats = new Map();
            const textChunk: Record<string, LegendsViewerExternalText> = {};
            const chunk = records
                .slice(start, start + legendsViewerChunkSize)
                .map(record => {
                    const sanitized = sanitizeLegendsViewerValue(decorateLegendsViewerOwnerChapters(record, spec.kind, chapterIds), spec.key, stats) as LegendRecord;
                    const extracted = extractLegendsViewerExternalText(sanitized);
                    if (extracted.text) textChunk[String(extracted.record.id)] = extracted.text;
                    return extracted.record;
                });
            writeJsonPayload(path.join(kindDir, `${chunkId}.json`), chunk);
            if (Object.keys(textChunk).length > 0) {
                writeJsonPayload(path.join(textKindDir, `${chunkId}.json`), textChunk);
            }
        }
    }

    console.log(`Wrote Legends record chunks to ${recordsDir}`);
    console.log(`Wrote Legends text chunks to ${textsDir}`);
}

function writeLegendsViewerMentionIndexes(legends: LegendsExport, htmlPath: string) {
    const outputPath = path.resolve(htmlPath);
    const mentionsDir = path.join(path.dirname(outputPath), "mentions");
    const mentionIndexes = createLegendsMentionIndexes(legends);

    fs.rmSync(mentionsDir, {recursive: true, force: true});

    for (let [kind, mentions] of Object.entries(mentionIndexes)) {
        const chunks = new Map<number, Record<string, Record<string, LegendMentionEntry[]>>>();
        for (let [entityId, groups] of Object.entries(mentions)) {
            const chunkId = Math.floor(Number(entityId) / legendsViewerMentionChunkSize);
            let chunk = chunks.get(chunkId);
            if (!chunk) {
                chunk = {};
                chunks.set(chunkId, chunk);
            }
            chunk[entityId] = groups;
        }

        for (let [chunkId, chunk] of chunks) {
            writeJsonPayload(path.join(mentionsDir, kind, `${chunkId}.json`), chunk);
        }
    }

    console.log(`Wrote Legends mention indexes to ${mentionsDir}`);
}

function writeLegendsHtml(legends: LegendsExport, htmlPath: string, mapImagePath?: string) {
    const outputPath = path.resolve(htmlPath);
    writeLegendsViewerIndexes(legends, outputPath);
    writeLegendsViewerChunks(legends, outputPath);
    writeLegendsViewerMentionIndexes(legends, outputPath);
    const relativeMapImagePath = mapImagePath
        ? path.relative(path.dirname(outputPath), path.resolve(mapImagePath)).replace(/\\/g, "/")
        : undefined;
    const viewerLegends = createLegendsViewerArchive(legends, relativeMapImagePath);
    const sentinel = "__WORLD_MAP_LEGENDS_JSON__";
    const html = legendsViewerHtml(sentinel);
    const [prefix, suffix] = html.split(sentinel);
    if (suffix === undefined) throw new Error("Legends viewer template is missing the data sentinel");
    writeJsonPayload(outputPath, viewerLegends, true, prefix, suffix);
    console.log(`Wrote ${outputPath}`);
}

function writeLegendsJson(legends: LegendsExport, jsonPath: string) {
    const outputPath = path.resolve(jsonPath);
    writeJsonPayload(outputPath, legends);
    console.log(`Wrote ${outputPath}`);
}

function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

function formatMegabytes(bytes: number): string {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function civilizationArrayCounts(simulation: CivilizationSimulation): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let [key, value] of Object.entries(simulation as unknown as Record<string, unknown>)) {
        if (Array.isArray(value)) counts[key] = value.length;
    }
    return counts;
}

function topCivilizationArrayCounts(counts: Record<string, number>, limit = 16) {
    return Object.entries(counts)
        .map(([key, count]) => ({key, count}))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        .slice(0, limit);
}

function countNestedEventIdLinks(simulation: CivilizationSimulation): number {
    let total = 0;
    for (let value of Object.values(simulation as unknown as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        for (let item of value) {
            if (item && typeof item === "object" && Array.isArray((item as {eventIds?: unknown[]}).eventIds)) {
                total += (item as {eventIds: unknown[]}).eventIds.length;
            }
        }
    }
    return total;
}

function nestedEventIdLinkStats(simulation: CivilizationSimulation): {total: number; counts: Record<string, number>} {
    const counts: Record<string, number> = {};
    let overallTotal = 0;
    for (let [key, value] of Object.entries(simulation as unknown as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        let total = 0;
        for (let item of value) {
            if (item && typeof item === "object" && Array.isArray((item as {eventIds?: unknown[]}).eventIds)) {
                total += (item as {eventIds: unknown[]}).eventIds.length;
            }
        }
        if (total > 0) {
            counts[key] = total;
            overallTotal += total;
        }
    }
    return {total: overallTotal, counts};
}

function topRecordCounts(counts: Record<string, number>, limit = 16) {
    return Object.entries(counts)
        .map(([key, count]) => ({key, count}))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        .slice(0, limit);
}

function civilizationLifecycleProfile(simulation: CivilizationSimulation) {
    const statusCounts: Record<string, number> = {};
    const originKindCounts: Record<string, number> = {};
    const collapseStageCounts: Record<string, number> = {};
    const collapseFailureKindCounts: Record<string, number> = {};
    const eventTypeCounts: Record<string, number> = {};
    const successors = [];
    const fallen = [];

    for (let civilization of simulation.civilizations) {
        statusCounts[civilization.status] = (statusCounts[civilization.status] ?? 0) + 1;
        originKindCounts[civilization.originKind] = (originKindCounts[civilization.originKind] ?? 0) + 1;
        const stageKey = String(civilization.collapseStage);
        collapseStageCounts[stageKey] = (collapseStageCounts[stageKey] ?? 0) + 1;
        for (let kind of civilization.collapseFailureKinds) {
            collapseFailureKindCounts[kind] = (collapseFailureKindCounts[kind] ?? 0) + 1;
        }
        if (civilization.parentCivilizationId !== undefined || civilization.restoredCivilizationId !== undefined) {
            successors.push({
                id: civilization.id,
                name: civilization.name,
                status: civilization.status,
                originKind: civilization.originKind,
                foundedYear: civilization.foundedYear,
                parentCivilizationId: civilization.parentCivilizationId,
                restoredCivilizationId: civilization.restoredCivilizationId,
                capitalSettlementId: civilization.capitalSettlementId,
            });
        }
        if (civilization.status === "fallen") {
            fallen.push({
                id: civilization.id,
                name: civilization.name,
                originKind: civilization.originKind,
                foundedYear: civilization.foundedYear,
                fallenYear: civilization.fallenYear,
                collapsePressure: civilization.collapsePressure,
                collapseFailureKinds: civilization.collapseFailureKinds,
            });
        }
    }
    for (let event of simulation.legendEvents) {
        if (!event.type.startsWith("civilization-")) continue;
        eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
    }

    return {
        statusCounts,
        originKindCounts,
        collapseStageCounts,
        collapseFailureKindCounts,
        eventTypeCounts,
        successorCount: successors.length,
        fallenCount: fallen.length,
        successors: successors.sort((a, b) => a.foundedYear - b.foundedYear || a.id - b.id).slice(-24),
        fallen: fallen.sort((a, b) => (a.fallenYear ?? 0) - (b.fallenYear ?? 0) || a.id - b.id).slice(-24),
    };
}

function legendEventTypeCounts(simulation: CivilizationSimulation): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let event of simulation.legendEvents) {
        counts[event.type] = (counts[event.type] ?? 0) + 1;
    }
    return counts;
}

function memorySourceEventTypeCounts(simulation: CivilizationSimulation): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let memory of simulation.memories) {
        const type = simulation.legendEvents[memory.sourceEventId]?.type ?? "unknown";
        counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
}

function topPhaseTimings(simulation: CivilizationSimulation, limit = 12) {
    return simulation.lastPhaseTimings
        .slice()
        .sort((a, b) => b.elapsedMs - a.elapsedMs || a.name.localeCompare(b.name))
        .slice(0, limit);
}

function namedLegendRefCacheEntries(simulation: CivilizationSimulation): number {
    let named = 0;
    for (let ref of simulation.legendRefCache.values()) {
        if (ref.name !== undefined) named++;
    }
    return named;
}

function legendEventStats(simulation: CivilizationSimulation): {
    entityRefs: number;
    namedEntityRefs: number;
    refLengthBuckets: Record<string, number>;
    refKindCounts: Record<string, number>;
    namedRefKindCounts: Record<string, number>;
    eventTypeCounts: Record<string, number>;
} {
    const refLengthBuckets: Record<string, number> = {"0": 0, "1-2": 0, "3-4": 0, "5-8": 0, "9-16": 0, "17+": 0};
    const refKindCounts: Record<string, number> = {};
    const namedRefKindCounts: Record<string, number> = {};
    const eventTypeCounts: Record<string, number> = {};
    let entityRefs = 0;
    let namedEntityRefs = 0;

    for (let event of simulation.legendEvents) {
        eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
        const count = event.entityRefs.length;
        entityRefs += count;
        if (count === 0) refLengthBuckets["0"]++;
        else if (count <= 2) refLengthBuckets["1-2"]++;
        else if (count <= 4) refLengthBuckets["3-4"]++;
        else if (count <= 8) refLengthBuckets["5-8"]++;
        else if (count <= 16) refLengthBuckets["9-16"]++;
        else refLengthBuckets["17+"]++;

        for (let ref of event.entityRefs) {
            refKindCounts[ref.kind] = (refKindCounts[ref.kind] ?? 0) + 1;
            if (ref.name === undefined) continue;
            namedEntityRefs++;
            namedRefKindCounts[ref.kind] = (namedRefKindCounts[ref.kind] ?? 0) + 1;
        }
    }

    return {entityRefs, namedEntityRefs, refLengthBuckets, refKindCounts, namedRefKindCounts, eventTypeCounts};
}

const storyHookSampleKinds: StoryHookKind[] = [
    "relationship",
    "artifact",
    "conflict",
    "prophecy",
    "mystery",
    "character",
    "legacy",
];

type ProfileLegendRecord = Record<string, unknown>;
type ProfileRefContext = {
    kind: LegendEntityRef["kind"];
    id: number;
    name?: string;
    missing?: boolean;
    [key: string]: unknown;
};

const profileRefCollectionKeys: Partial<Record<LegendEntityRef["kind"], keyof CivilizationSimulation>> = {
    civilization: "civilizations",
    settlement: "settlements",
    "settlement-control": "settlementControls",
    "natural-feature": "naturalFeatures",
    person: "agents",
    "person-allegiance": "personAllegiances",
    preference: "preferences",
    tradition: "traditions",
    epithet: "epithets",
    "reputation-milestone": "reputationMilestones",
    artifact: "artifacts",
    "artifact-condition": "artifactConditions",
    chronicle: "chronicles",
    "written-work": "writtenWorks",
    memory: "memories",
    thought: "thoughts",
    "personality-shift": "personalityShifts",
    "need-episode": "needEpisodes",
    opinion: "opinions",
    "social-claim": "socialClaims",
    conversation: "conversations",
    rumor: "rumors",
    secret: "secrets",
    scheme: "schemes",
    feud: "feuds",
    oath: "oaths",
    ceremony: "ceremonies",
    "ceremony-participation": "ceremonyParticipations",
    activity: "activities",
    teaching: "teachings",
    project: "projects",
    "project-participation": "projectParticipations",
    obligation: "obligations",
    holding: "holdings",
    belonging: "belongings",
    "possession-attachment": "possessionAttachments",
    estate: "estates",
    residence: "residences",
    career: "careers",
    organization: "organizations",
    membership: "memberships",
    "organization-rank": "organizationRanks",
    relationship: "socialBonds",
    "relationship-milestone": "relationshipMilestones",
    union: "unions",
    belief: "beliefs",
    "belief-adherence": "beliefAdherences",
    god: "gods",
    commandment: "commandments",
    destiny: "destinies",
    miracle: "miracles",
    myth: "myths",
    doctrine: "doctrines",
    "magic-role": "magicRoles",
    prophecy: "prophecies",
    "civilization-goal": "civilizationGoals",
    "sacred-site": "sacredSites",
    office: "offices",
    "office-term": "officeTerms",
    law: "laws",
    case: "cases",
    testimony: "testimonies",
    conflict: "conflicts",
    battle: "battles",
    "battle-participation": "battleParticipations",
    "military-unit": "militaryUnits",
    "equipment-cache": "equipmentCaches",
    "spy-network": "spyNetworks",
    "spy-operation": "spyOperations",
    injury: "injuries",
    illness: "illnesses",
    "care-record": "careRecords",
    "wound-legacy": "woundLegacies",
    memorial: "memorials",
    burial: "burials",
    "death-record": "deathRecords",
    birth: "births",
    "age-milestone": "ageMilestones",
    "appearance-feature": "appearanceFeatures",
    ambition: "ambitions",
    apprenticeship: "apprenticeships",
    skill: "skills",
    structure: "structures",
    journey: "journeys",
    road: "roads",
    household: "households",
    lineage: "lineages",
    "story-hook": "storyHooks",
    event: "legendEvents",
};

function profileAsRecord(value: unknown): ProfileLegendRecord | undefined {
    return value && typeof value === "object" ? value as ProfileLegendRecord : undefined;
}

function profileRecordAt(simulation: CivilizationSimulation, key: keyof CivilizationSimulation, id: number): ProfileLegendRecord | undefined {
    const collection = (simulation as unknown as Record<string, unknown>)[String(key)];
    if (!Array.isArray(collection)) return undefined;
    return profileAsRecord(collection[id]);
}

function profileRecordForRef(simulation: CivilizationSimulation, ref: LegendEntityRef): ProfileLegendRecord | undefined {
    const key = profileRefCollectionKeys[ref.kind];
    return key === undefined ? undefined : profileRecordAt(simulation, key, ref.id);
}

function profileCompactText(value: unknown, maxLength = 420): string | undefined {
    if (typeof value !== "string") return undefined;
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) return undefined;
    return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}

function profileRound(value: unknown, digits = 3): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function profileNumberList(value: unknown, limit = 8): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const ids = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).slice(0, limit);
    return ids.length ? ids : undefined;
}

function profileStringList(value: unknown, limit = 8): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const strings = value
        .map(item => profileCompactText(item, 80))
        .filter((item): item is string => item !== undefined)
        .slice(0, limit);
    return strings.length ? strings : undefined;
}

function profileRefList(value: unknown, limit = 6): Array<{kind: LegendEntityRef["kind"]; id: number; name?: string}> | undefined {
    if (!Array.isArray(value)) return undefined;
    const refs = value
        .map(item => profileAsRecord(item))
        .filter((item): item is ProfileLegendRecord => item !== undefined)
        .map(item => ({
            kind: item.kind as LegendEntityRef["kind"],
            id: typeof item.id === "number" ? item.id : -1,
            name: profileCompactText(item.name, 120),
        }))
        .filter(ref => typeof ref.kind === "string" && ref.id >= 0)
        .slice(0, limit);
    return refs.length ? refs : undefined;
}

function profileFirstNumber(record: ProfileLegendRecord, keys: string[], digits = 3): number | undefined {
    for (let key of keys) {
        const value = profileRound(record[key], digits);
        if (value !== undefined) return value;
    }
    return undefined;
}

function profileFirstText(record: ProfileLegendRecord, keys: string[], maxLength = 420): string | undefined {
    for (let key of keys) {
        const value = profileCompactText(record[key], maxLength);
        if (value !== undefined) return value;
    }
    return undefined;
}

function profileMaybeSet(target: ProfileLegendRecord, key: string, value: unknown) {
    if (value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    target[key] = value;
}

function profileEntityName(simulation: CivilizationSimulation, kind: LegendEntityRef["kind"], id: number): string | undefined {
    if (kind === "relationship") {
        const bond = profileRecordAt(simulation, "socialBonds", id);
        const agentIds = profileNumberList(bond?.agentIds, 2) ?? [];
        if (agentIds.length === 2) {
            return `${profileEntityName(simulation, "person", agentIds[0]) ?? `Person ${agentIds[0]}`} and ${profileEntityName(simulation, "person", agentIds[1]) ?? `Person ${agentIds[1]}`}`;
        }
    }
    if (kind === "road") {
        const road = profileRecordAt(simulation, "roads", id);
        const fromId = typeof road?.fromSettlementId === "number" ? road.fromSettlementId : undefined;
        const toId = typeof road?.toSettlementId === "number" ? road.toSettlementId : undefined;
        if (fromId !== undefined && toId !== undefined) {
            return `${profileEntityName(simulation, "settlement", fromId) ?? `Settlement ${fromId}`} to ${profileEntityName(simulation, "settlement", toId) ?? `Settlement ${toId}`} road`;
        }
    }
    if (kind === "event") {
        const event = simulation.legendEvents[id];
        return event ? `${event.year}: ${legendEventHeadline(event)}` : undefined;
    }
    const record = profileRecordForRef(simulation, {kind, id});
    return profileCompactText(record?.name, 160);
}

function profileNamedIds(simulation: CivilizationSimulation, kind: LegendEntityRef["kind"], value: unknown, limit = 6): string[] | undefined {
    const ids = profileNumberList(value, limit);
    if (!ids) return undefined;
    return ids.map(id => `${id}:${profileEntityName(simulation, kind, id) ?? `${kind} ${id}`}`);
}

function profileNamedLinkFields(simulation: CivilizationSimulation, record: ProfileLegendRecord) {
    const fields: Array<[string, LegendEntityRef["kind"]]> = [
        ["civilizationId", "civilization"],
        ["targetCivilizationId", "civilization"],
        ["attackerCivilizationId", "civilization"],
        ["defenderCivilizationId", "civilization"],
        ["settlementId", "settlement"],
        ["originSettlementId", "settlement"],
        ["targetSettlementId", "settlement"],
        ["personId", "person"],
        ["agentId", "person"],
        ["speakerAgentId", "person"],
        ["targetAgentId", "person"],
        ["creatorAgentId", "person"],
        ["ownerAgentId", "person"],
        ["swearerAgentId", "person"],
        ["beliefId", "belief"],
        ["godId", "god"],
        ["prophecyId", "prophecy"],
        ["targetArtifactId", "artifact"],
        ["artifactId", "artifact"],
        ["conflictId", "conflict"],
        ["battleId", "battle"],
        ["relationshipId", "relationship"],
        ["secretId", "secret"],
        ["feudId", "feud"],
        ["oathId", "oath"],
    ];
    const links: string[] = [];
    const seen = new Set<string>();
    for (let [field, kind] of fields) {
        const id = record[field];
        if (typeof id !== "number" || !Number.isFinite(id)) continue;
        const key = `${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push(`${field}=${key}:${profileEntityName(simulation, kind, id) ?? `${kind} ${id}`}`);
    }
    return links.length ? links : undefined;
}

function profileRefSummary(simulation: CivilizationSimulation, ref: LegendEntityRef, record: ProfileLegendRecord): string | undefined {
    if (ref.kind === "person") {
        const name = profileEntityName(simulation, "person", ref.id) ?? ref.name ?? `Person ${ref.id}`;
        const civilization = typeof record.civilizationId === "number" ? profileEntityName(simulation, "civilization", record.civilizationId) : undefined;
        const settlement = typeof record.settlementId === "number" ? profileEntityName(simulation, "settlement", record.settlementId) : undefined;
        const traits = profileStringList(record.traits, 3)?.join(", ");
        const values = profileStringList(record.values, 3)?.join(", ");
        return `${name} is ${record.alive === false ? "dead" : "alive"}, age ${record.age ?? "unknown"}, ${record.profession ?? "unknown profession"}${civilization ? ` of ${civilization}` : ""}${settlement ? ` in ${settlement}` : ""}. Mental state ${record.mentalState ?? "unknown"}; reputation ${profileRound(record.reputation) ?? "unknown"}${traits ? `; traits ${traits}` : ""}${values ? `; values ${values}` : ""}.`;
    }
    if (ref.kind === "relationship") {
        const agentIds = profileNumberList(record.agentIds, 2) ?? [];
        const people = agentIds.map(id => profileEntityName(simulation, "person", id) ?? `Person ${id}`);
        return `${record.kind ?? "relationship"} between ${people.join(" and ") || "unknown people"} started in ${record.startedYear ?? "unknown year"}. Strength ${profileRound(record.strength) ?? "unknown"}, trust ${profileRound(record.trust) ?? "unknown"}, tension ${profileRound(record.tension) ?? "unknown"}, active ${record.active === false ? "no" : "yes"}, milestones ${(profileNumberList(record.milestoneIds, 1000) ?? []).length}.`;
    }
    if (ref.kind === "artifact") {
        const civilization = typeof record.civilizationId === "number" ? profileEntityName(simulation, "civilization", record.civilizationId) : undefined;
        const owner = typeof record.ownerAgentId === "number" ? profileEntityName(simulation, "person", record.ownerAgentId) : undefined;
        return `${record.name ?? ref.name ?? `Artifact ${ref.id}`} is a ${record.quality ?? "unknown-quality"} ${record.scale ?? "unknown-scale"} ${record.kind ?? "artifact"} made of ${record.material ?? "unknown material"} for ${record.purpose ?? "unknown purpose"}. Condition ${record.condition ?? "unknown"}, renown ${profileRound(record.renown) ?? "unknown"}${civilization ? `, civilization ${civilization}` : ""}${owner ? `, owner ${owner}` : ""}. ${profileCompactText(record.detail, 260) ?? profileCompactText(record.inscription, 260) ?? ""}`.trim();
    }
    if (ref.kind === "conflict") {
        const attacker = typeof record.attackerCivilizationId === "number" ? profileEntityName(simulation, "civilization", record.attackerCivilizationId) : undefined;
        const defender = typeof record.defenderCivilizationId === "number" ? profileEntityName(simulation, "civilization", record.defenderCivilizationId) : undefined;
        return `${record.name ?? ref.name ?? `Conflict ${ref.id}`} is a ${record.status ?? "unknown"} ${record.kind ?? "conflict"} from ${record.startedYear ?? "unknown year"}${record.endedYear ? ` to ${record.endedYear}` : ""}. ${attacker ?? "Unknown attacker"} versus ${defender ?? "unknown defender"}, battles ${(profileNumberList(record.battleIds, 1000) ?? []).length}, casualties ${(profileNumberList(record.casualtyAgentIds, 1000) ?? []).length}, captured settlements ${(profileNumberList(record.capturedSettlementIds, 1000) ?? []).length}.`;
    }
    if (ref.kind === "battle") {
        const attacker = typeof record.attackerCivilizationId === "number" ? profileEntityName(simulation, "civilization", record.attackerCivilizationId) : undefined;
        const defender = typeof record.defenderCivilizationId === "number" ? profileEntityName(simulation, "civilization", record.defenderCivilizationId) : undefined;
        return `${record.name ?? ref.name ?? `Battle ${ref.id}`} happened at ${record.battlefieldName ?? "an unnamed battlefield"} in year ${record.year ?? "unknown"}. Terrain ${record.battlefieldTerrain ?? "unknown"}, outcome ${record.outcome ?? "unknown"}, ${attacker ?? "unknown attacker"} versus ${defender ?? "unknown defender"}, casualties ${(profileNumberList(record.casualtyAgentIds, 1000) ?? []).length}.`;
    }
    const description = profileFirstText(record, ["description", "detail", "inscription", "principle", "demand", "effect"], 420);
    if (description) return description;
    const attributes = ["kind", "status", "type", "domain", "scale", "purpose", "quality", "condition", "outcome"]
        .map(key => profileCompactText(record[key], 80))
        .filter((item): item is string => item !== undefined);
    const year = profileFirstNumber(record, ["year", "startedYear", "foundedYear", "createdYear", "builtYear", "openedYear", "swornYear", "givenYear"], 0);
    if (attributes.length || year !== undefined) {
        return `${profileEntityName(simulation, ref.kind, ref.id) ?? ref.name ?? `${ref.kind} ${ref.id}`} has ${attributes.join(", ") || "recorded context"}${year !== undefined ? ` in year ${year}` : ""}.`;
    }
    return undefined;
}

function profileResolvedSeedRef(simulation: CivilizationSimulation, ref: LegendEntityRef): ProfileRefContext {
    const record = profileRecordForRef(simulation, ref);
    const context: ProfileRefContext = {
        kind: ref.kind,
        id: ref.id,
        name: ref.name ?? profileEntityName(simulation, ref.kind, ref.id),
    };
    if (!record) {
        context.missing = true;
        return context;
    }
    profileMaybeSet(context, "recordKind", profileCompactText(record.kind, 80) ?? profileCompactText(record.type, 80) ?? profileCompactText(record.domain, 80));
    profileMaybeSet(context, "status", profileCompactText(record.status, 80));
    profileMaybeSet(context, "year", profileFirstNumber(record, ["year", "startedYear", "foundedYear", "createdYear", "builtYear", "openedYear", "swornYear", "givenYear"], 0));
    profileMaybeSet(context, "endedYear", profileFirstNumber(record, ["endedYear", "resolvedYear", "fallenYear", "settledYear", "revealedYear"], 0));
    profileMaybeSet(context, "summary", profileRefSummary(simulation, ref, record));
    profileMaybeSet(context, "description", profileFirstText(record, ["description", "detail", "inscription", "creationClaim", "religiousMandate"], 520));
    profileMaybeSet(context, "eventIds", profileNumberList(record.eventIds, 8));
    profileMaybeSet(context, "subjectRefs", profileRefList(record.subjectRefs, 6));
    profileMaybeSet(context, "linkedEntities", profileNamedLinkFields(simulation, record));
    if (ref.kind === "relationship") profileMaybeSet(context, "participants", profileNamedIds(simulation, "person", record.agentIds, 2));
    if (ref.kind === "feud") {
        profileMaybeSet(context, "sideA", profileNamedIds(simulation, "person", record.sideAAgentIds, 4));
        profileMaybeSet(context, "sideB", profileNamedIds(simulation, "person", record.sideBAgentIds, 4));
    }
    if (ref.kind === "oath") profileMaybeSet(context, "witnesses", profileNamedIds(simulation, "person", record.witnessAgentIds, 4));
    if (ref.kind === "secret") profileMaybeSet(context, "keepers", profileNamedIds(simulation, "person", record.keeperAgentIds, 5));
    if (ref.kind === "god") profileMaybeSet(context, "controlSpheres", profileStringList(record.controlSpheres, 8));
    if (ref.kind === "prophecy" || ref.kind === "civilization-goal" || ref.kind === "destiny" || ref.kind === "miracle") {
        profileMaybeSet(context, "strength", profileRound(record.strength ?? record.priority ?? record.pressure));
    }
    return context;
}

function profileResolvedEvent(simulation: CivilizationSimulation, eventId: number) {
    const event = simulation.legendEvents[eventId];
    if (!event) return {id: eventId, missing: true};
    return {
        id: event.id,
        year: event.year,
        type: event.type,
        headline: profileCompactText(legendEventHeadline(event), 220),
        description: profileCompactText(legendEventDescription(event), 520),
        entityRefs: profileRefList(event.entityRefs, 8),
    };
}

function profileStoryHookSample(simulation: CivilizationSimulation, hook: CivilizationSimulation["storyHooks"][number]) {
    const seedRefs = hook.seedRefs.slice(0, 8).map(ref => ({
        kind: ref.kind,
        id: ref.id,
        name: ref.name,
    }));
    const eventIds = hook.eventIds.slice(0, 8);
    return {
        id: hook.id,
        name: hook.name,
        kind: hook.kind,
        tone: hook.tone,
        year: hook.year,
        score: hook.score,
        urgency: hook.urgency,
        prompt: hook.prompt,
        stakes: hook.stakes,
        complication: hook.complication,
        suggestedFocus: hook.suggestedFocus,
        seedRefs,
        resolvedSeedRefs: hook.seedRefs.slice(0, 8).map(ref => profileResolvedSeedRef(simulation, ref)),
        eventIds,
        resolvedEvents: eventIds.map(eventId => profileResolvedEvent(simulation, eventId)),
    };
}

function storyHookCountsByKind(simulation: CivilizationSimulation): Record<StoryHookKind, number> {
    const counts = Object.fromEntries(storyHookSampleKinds.map(kind => [kind, 0])) as Record<StoryHookKind, number>;
    for (let hook of simulation.storyHooks) counts[hook.kind]++;
    return counts;
}

function storyHookSamplesByKind(simulation: CivilizationSimulation, limitPerKind = 3) {
    const samples = Object.fromEntries(storyHookSampleKinds.map(kind => [kind, []])) as Record<StoryHookKind, ReturnType<typeof profileStoryHookSample>[]>;
    for (let hook of simulation.storyHooks) {
        const bucket = samples[hook.kind];
        if (bucket.length >= limitPerKind) continue;
        bucket.push(profileStoryHookSample(simulation, hook));
    }
    return samples;
}

function civilizationProfile(simulation: CivilizationSimulation) {
    const counts = civilizationArrayCounts(simulation);
    const eventIdLinkStats = nestedEventIdLinkStats(simulation);
    const eventIdLinkCounts = eventIdLinkStats.counts;
    const eventStats = legendEventStats(simulation);
    const memoryEventTypeCounts = memorySourceEventTypeCounts(simulation);
    const memory = process.memoryUsage();
    const aliveAgents = simulation.aliveAgentIds.length;
    const aliveAgentScanCount = simulation.agents.reduce((sum, agent) => sum + (agent.alive ? 1 : 0), 0);
    const lifecycle = civilizationLifecycleProfile(simulation);
    return {
        year: simulation.year,
        civilizations: simulation.civilizations.length,
        workerCount: simulation.workerCount,
        settlements: simulation.settlements.length,
        aliveAgents,
        aliveAgentScanCount,
        aliveAgentIndexCount: simulation.aliveAgentIds.length,
        totalAgents: simulation.agents.length,
        deadAgents: simulation.agents.length - aliveAgents,
        legendEvents: simulation.legendEvents.length,
        legendEventEntityRefs: eventStats.entityRefs,
        legendEventNamedEntityRefs: eventStats.namedEntityRefs,
        legendEventRefLengthBuckets: eventStats.refLengthBuckets,
        topLegendEventRefKinds: topRecordCounts(eventStats.refKindCounts, 24),
        topLegendEventNamedRefKinds: topRecordCounts(eventStats.namedRefKindCounts, 24),
        legendRefCacheSize: simulation.legendRefCache.size,
        legendRefCacheNamedEntries: namedLegendRefCacheEntries(simulation),
        compactedLegendEvents: simulation.compactedLegendEventRefCursor,
        spilledLegendEventTexts: simulation.spilledLegendEventTextCursor,
        nestedEventIdLinks: eventIdLinkStats.total,
        eventIdLinkCounts,
        topEventIdLinkCounts: topRecordCounts(eventIdLinkCounts),
        topLegendEventTypes: topRecordCounts(eventStats.eventTypeCounts),
        topMemorySourceEventTypes: topRecordCounts(memoryEventTypeCounts),
        lifecycle,
        topPhaseTimings: topPhaseTimings(simulation),
        counts,
        topArrays: topCivilizationArrayCounts(counts),
        storyHookCountsByKind: storyHookCountsByKind(simulation),
        storyHookSamples: simulation.storyHooks.slice(0, 12).map(hook => profileStoryHookSample(simulation, hook)),
        storyHookSamplesByKind: storyHookSamplesByKind(simulation),
        memory: {
            heapUsedBytes: memory.heapUsed,
            heapTotalBytes: memory.heapTotal,
            rssBytes: memory.rss,
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
            rssMB: Math.round(memory.rss / 1024 / 1024),
        },
    };
}

function compactProgressRecordSummary(simulation: CivilizationSimulation): string {
    const counts = civilizationArrayCounts(simulation);
    const selectedKeys = ["memories", "opinions", "residences", "careers", "memberships", "activities", "holdings", "belongings"];
    return selectedKeys
        .filter(key => counts[key] !== undefined)
        .map(key => `${key} ${counts[key]}`)
        .join("; ");
}

function compactPhaseTimingSummary(progress: CivilizationProgress): string {
    const timings = progress.phaseTimings ?? [];
    if (timings.length === 0) return "";
    return timings
        .slice(0, 8)
        .map(timing => `${timing.name} ${formatDuration(timing.elapsedMs)}`)
        .join("; ");
}

function writeCivilizationProfileJson(simulation: CivilizationSimulation, jsonPath: string) {
    const outputPath = path.resolve(jsonPath);
    writeJsonPayload(outputPath, civilizationProfile(simulation));
    console.log(`Wrote ${outputPath}`);
}

function writeCivilizationCheckpointProfile(simulation: CivilizationSimulation, profileDir: string) {
    const outputPath = path.join(profileDir, `year-${paddedYear(simulation.year)}.json`);
    writeJsonPayload(outputPath, civilizationProfile(simulation));
    console.log(`Wrote ${outputPath}`);
}

function logCivilizationProgress(progress: CivilizationProgress, simulation: CivilizationSimulation) {
    const memory = process.memoryUsage();
    console.log(
        `[year ${progress.year}/${progress.targetYears}] `
        + `elapsed ${formatDuration(progress.elapsedMs)}; `
        + `workers ${progress.workerCount}; `
        + `agents ${progress.aliveAgents}/${progress.totalAgents} alive/total; `
        + `settlements ${progress.settlements}; roads ${progress.roads}; `
        + `events ${progress.events}; legendEvents ${progress.legendEvents}; `
        + `births ${progress.births}; deaths ${progress.deaths}; migrations ${progress.migrations}; `
        + (progress.compactedEventRefs > 0 ? `compactedEventRefs ${progress.compactedEventRefs}; ` : "")
        + (progress.spilledEventTexts > 0 ? `spilledEventTexts ${progress.spilledEventTexts}; ` : "")
        + `records ${compactProgressRecordSummary(simulation)}; `
        + (compactPhaseTimingSummary(progress) ? `phases ${compactPhaseTimingSummary(progress)}; ` : "")
        + `heap ${formatMegabytes(memory.heapUsed)}/${formatMegabytes(memory.heapTotal)}; rss ${formatMegabytes(memory.rss)}`,
    );
}

function writeCivilizationSnapshots(
    world: ReturnType<typeof generateWorldMap>,
    options: CliOptions,
    civilizations: CivilizationSimulation,
    capturedFrameYears: Set<number> = new Set(),
) {
    if (!options.snapshotDir) return;

    const snapshotDir = path.resolve(options.snapshotDir);
    const yearsDir = path.join(snapshotDir, "years");
    const mapsDir = path.join(snapshotDir, "maps");
    fs.mkdirSync(yearsDir, {recursive: true});
    fs.mkdirSync(mapsDir, {recursive: true});

    const summary = summarizeCivilizations(civilizations);
    const manifest = {
        generatedAt: new Date().toISOString(),
        terrainSeed: defaultControlValues(world.controls).elevation.seed,
        civilizationSeed: options.civilizationSeed,
        years: options.civilizationYears,
        civilizationWorkers: resolvedCivilizationWorkerCount(options),
        settlementClaimRadius: options.settlementClaimRadius ?? null,
        capitalClaimRadius: options.capitalClaimRadius ?? null,
        snapshotEvery: options.snapshotEvery,
        snapshotRenderEvery: options.snapshotRenderEvery,
        snapshotGif: options.snapshotGif ? path.resolve(options.snapshotGif) : null,
        snapshotGifFps: options.snapshotGifFps,
        width: options.width,
        height: options.height,
        civilizationCount: summary.civilizationCount,
        finalAgentCount: summary.agentCount,
        finalSettlementCount: summary.settlementCount,
        finalRoadCount: summary.roadCount,
        historyCount: civilizations.history.length,
    };

    fs.writeFileSync(path.join(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(snapshotDir, "history.json"), JSON.stringify(civilizations.history, null, 2));

    for (let snapshot of civilizations.history) {
        fs.writeFileSync(
            path.join(yearsDir, `year-${paddedYear(snapshot.year)}.json`),
            JSON.stringify(snapshot, null, 2),
        );
    }

    for (let year of snapshotRenderYears(options)) {
        const framePath = path.join(mapsDir, `year-${paddedYear(year)}.png`);
        if (capturedFrameYears.has(year) && fs.existsSync(framePath)) continue;

        const frameSimulation = simulateCivilizations(world, civilizationOptions(options, year), {
            workerCount: resolvedCivilizationWorkerCount(options),
        });
        renderSnapshotFrame(world, options, frameSimulation, mapsDir);
    }

    if (options.snapshotGif) {
        writeSnapshotGif(mapsDir, options.snapshotGif, options.snapshotGifFps);
    }

    console.log(`Wrote civilization snapshots to ${snapshotDir}`);
}

export function runGenerateCommand(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const outputPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});

    console.log("Generating map...");
    const world = generateWorldMap(options.controls);
    let civilizations: CivilizationSimulation | undefined;
    const capturedFrameYears = new Set<number>();
    if (options.civilizations > 0) {
        const checkpointProfileDir = options.civilizationProfileDir ? path.resolve(options.civilizationProfileDir) : undefined;
        if (checkpointProfileDir) fs.mkdirSync(checkpointProfileDir, {recursive: true});
        const workerCount = resolvedCivilizationWorkerCount(options);
        const runOptions: CivilizationRunOptions = {
            workerCount,
            snapshotEvery: options.snapshotEvery,
            progressEvery: options.progressEvery,
            compactEventRefNamesAfter: options.compactEventRefNamesAfter,
            compactEventRefsEvery: options.compactEventRefsEvery,
            spillEventTextAfter: options.spillEventTextAfter,
            spillEventTextEvery: options.spillEventTextEvery,
            legendEventTextSpillDir: options.spillEventTextDir,
            legendEventTextCacheChunks: options.spillEventTextCacheChunks,
            compactNewLegendEventRefs: options.compactNewEventRefs,
            gcAfterCompaction: options.gcAfterCompaction,
            profilePhaseTimings: options.profileCivilizationPhases,
        };
        if (options.progressEvery > 0) {
            runOptions.onProgress = (progress, progressSimulation) => {
                logCivilizationProgress(progress, progressSimulation);
                if (checkpointProfileDir) writeCivilizationCheckpointProfile(progressSimulation, checkpointProfileDir);
            };
        }
        if (options.snapshotDir) {
            const mapsDir = path.join(path.resolve(options.snapshotDir), "maps");
            fs.mkdirSync(mapsDir, {recursive: true});
            const renderYears = new Set(snapshotRenderYears(options));
            runOptions.captureEvery = options.snapshotRenderEvery;
            runOptions.onCapture = frameSimulation => {
                if (!renderYears.has(frameSimulation.year)) return;
                renderSnapshotFrame(world, options, frameSimulation, mapsDir);
                capturedFrameYears.add(frameSimulation.year);
            };
        }

        console.log(`Advancing ${options.civilizations} civilizations for ${options.civilizationYears} years with ${workerCount} civilization worker${workerCount === 1 ? "" : "s"}...`);
        civilizations = simulateCivilizations(world, civilizationOptions(options), runOptions);
    }

    if (civilizations && options.civilizationProfileJson) {
        writeCivilizationProfileJson(civilizations, options.civilizationProfileJson);
    }

    console.log(`Rendering ${options.width}x${options.height} PNG...`);
    const image = renderWorldMapPng(world, {width: options.width, height: options.height, civilizations});
    fs.writeFileSync(outputPath, PNG.sync.write(image));
    console.log(`Wrote ${outputPath}`);

    if (civilizations && options.civilizationJson) {
        const civilizationJsonPath = path.resolve(options.civilizationJson);
        fs.mkdirSync(path.dirname(civilizationJsonPath), {recursive: true});
        fs.writeFileSync(civilizationJsonPath, JSON.stringify(summarizeCivilizations(civilizations), null, 2));
        console.log(`Wrote ${civilizationJsonPath}`);
    }

    if (civilizations && (options.legendsJson || options.legendsHtml)) {
        const legends = exportLegends(civilizations);
        if (options.legendsJson) {
            writeLegendsJson(legends, options.legendsJson);
        }
        if (options.legendsHtml) {
            writeLegendsHtml(legends, options.legendsHtml, options.out);
        }
    }

    if (civilizations && options.snapshotDir) {
        writeCivilizationSnapshots(world, options, civilizations, capturedFrameYears);
    }

    if (options.summary) {
        summarize(world, outputPath, options.width, options.height, civilizations);
    }
}
