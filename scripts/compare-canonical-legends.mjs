#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const canonicalEntries = ["legends.json", "indexes", "records", "texts", "mentions"];

function usage() {
    console.error("Usage: node scripts/compare-canonical-legends.mjs <left-viewer-dir> <right-viewer-dir>");
}

function hashFile(filePath) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collectFiles(root, entry, files) {
    const fullPath = path.join(root, entry);
    if (!fs.existsSync(fullPath)) return;

    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
        files.push(entry.replace(/\\/g, "/"));
        return;
    }
    if (!stat.isDirectory()) return;

    for (let child of fs.readdirSync(fullPath).sort((a, b) => a.localeCompare(b))) {
        collectFiles(root, path.join(entry, child), files);
    }
}

function canonicalHashes(root) {
    const files = [];
    for (let entry of canonicalEntries) collectFiles(root, entry, files);
    const hashes = new Map();
    for (let file of files.sort((a, b) => a.localeCompare(b))) {
        hashes.set(file, hashFile(path.join(root, file)));
    }
    return hashes;
}

function compareHashes(leftRoot, rightRoot) {
    const left = canonicalHashes(leftRoot);
    const right = canonicalHashes(rightRoot);
    const diffs = [];
    const files = new Set([...left.keys(), ...right.keys()]);

    for (let file of [...files].sort((a, b) => a.localeCompare(b))) {
        if (!left.has(file)) {
            diffs.push(`Only in ${rightRoot}: ${file}`);
        } else if (!right.has(file)) {
            diffs.push(`Only in ${leftRoot}: ${file}`);
        } else if (left.get(file) !== right.get(file)) {
            diffs.push(`Hash mismatch: ${file}`);
        }
    }

    return {diffs, fileCount: files.size};
}

const [leftArg, rightArg] = process.argv.slice(2);
if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    process.exit(0);
}
if (!leftArg || !rightArg) {
    usage();
    process.exit(2);
}

const leftRoot = path.resolve(leftArg);
const rightRoot = path.resolve(rightArg);
for (let root of [leftRoot, rightRoot]) {
    if (!fs.existsSync(path.join(root, "legends.json"))) {
        console.error(`Missing canonical Legends archive: ${path.join(root, "legends.json")}`);
        process.exit(1);
    }
}
const {diffs, fileCount} = compareHashes(leftRoot, rightRoot);
if (diffs.length > 0) {
    console.error(`Canonical Legends outputs differ (${diffs.length} difference${diffs.length === 1 ? "" : "s"}):`);
    for (let diff of diffs.slice(0, 50)) console.error(`- ${diff}`);
    if (diffs.length > 50) console.error(`- ... ${diffs.length - 50} more`);
    process.exit(1);
}

console.log(`Canonical Legends outputs match (${fileCount} files).`);
