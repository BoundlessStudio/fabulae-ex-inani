import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

export function commandExists(command: string): boolean {
    const result = process.platform === "win32"
        ? spawnSync("where.exe", [command], {stdio: "ignore"})
        : spawnSync("sh", ["-lc", `command -v ${command}`], {stdio: "ignore"});
    return result.status === 0;
}

export function writeSnapshotGif(mapsDir: string, gifPath: string, fps: number) {
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

    throw new Error("Cannot write GIF because neither ffmpeg nor ImageMagick magick is available on PATH");
}
