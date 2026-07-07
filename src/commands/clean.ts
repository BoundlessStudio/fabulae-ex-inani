import fs from "node:fs";

export function runCleanCommand(argv = process.argv.slice(2)) {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(`Usage: world-mapgen clean [--output]

Options:
  --output    Also remove generated output files.
`);
        return;
    }

    const targets = ["dist"];

    if (argv.includes("--output")) {
        targets.push("output");
    }

    for (const target of targets) {
        fs.rmSync(target, {recursive: true, force: true});
        console.log(`Removed ${target}`);
    }
}
