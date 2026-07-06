#!/usr/bin/env node
import fs from "node:fs";

const ignoredKeys = new Set([
    "elapsedMs",
    "phaseTimings",
    "topPhaseTimings",
    "lastPhaseTimings",
    "memory",
    "memoryMb",
    "memoryMB",
    "heapUsed",
    "heapTotal",
    "rss",
    "heapUsedBytes",
    "heapTotalBytes",
    "rssBytes",
    "heapUsedMB",
    "heapTotalMB",
    "rssMB",
    "workerCount",
    "spilledLegendEventTexts",
    "spilledEventTexts",
]);

function usage() {
    console.error("Usage: node scripts/compare-civ-profiles.mjs <profile-a.json> <profile-b.json>");
}

function stripped(value) {
    if (Array.isArray(value)) return value.map(stripped);
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (ignoredKeys.has(key)) continue;
            out[key] = stripped(child);
        }
        return out;
    }
    return value;
}

function firstDifference(a, b) {
    let index = 0;
    while (index < a.length && index < b.length && a[index] === b[index]) index++;
    return index;
}

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
    usage();
    process.exit(2);
}

const a = JSON.stringify(stripped(JSON.parse(fs.readFileSync(aPath, "utf8"))));
const b = JSON.stringify(stripped(JSON.parse(fs.readFileSync(bPath, "utf8"))));

if (a !== b) {
    const index = firstDifference(a, b);
    console.error(`${aPath} != ${bPath}`);
    console.error(`First difference at ${index}`);
    console.error(`a: ${a.slice(Math.max(0, index - 120), index + 240)}`);
    console.error(`b: ${b.slice(Math.max(0, index - 120), index + 240)}`);
    process.exit(1);
}

console.log(`${aPath} == ${bPath}`);
