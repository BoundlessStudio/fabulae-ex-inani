import {runCleanCommand} from "./commands/clean.ts";
import {runCompareCivProfilesCommand} from "./commands/compare-civ-profiles.ts";
import {runCreateStoryOutlinesCommand} from "./commands/create-story-outlines.ts";
import {runEvaluateStoryHooksCommand} from "./commands/evaluate-story-hooks.ts";
import {printGenerateHelp, runGenerateCommand} from "./commands/generate.ts";
import {runPublishLegendsCommand} from "./commands/publish-legends.ts";
import {runServeStaticCommand} from "./commands/serve-static.ts";
import {runVerifyLegendsCommand} from "./commands/verify-legends.ts";

async function main(argv = process.argv.slice(2)) {
    const [command, ...rest] = argv;
    switch (command) {
        case undefined:
        case "":
            runGenerateCommand([]);
            return;
        case "generate":
            runGenerateCommand(rest);
            return;
        case "serve-legends":
        case "serve-static":
            runServeStaticCommand(rest);
            return;
        case "verify-legends":
            runVerifyLegendsCommand(rest);
            return;
        case "compare-civ-profiles":
            runCompareCivProfilesCommand(rest);
            return;
        case "evaluate-story-hooks":
            await runEvaluateStoryHooksCommand(rest);
            return;
        case "outline-stories":
        case "create-story-outlines":
            await runCreateStoryOutlinesCommand(rest);
            return;
        case "publish-legends":
        case "publish-run":
            runPublishLegendsCommand(rest);
            return;
        case "clean":
            runCleanCommand(rest);
            return;
        default:
            if (command === "--help" || command === "-h") {
                printGenerateHelp();
                return;
            }
            runGenerateCommand(argv);
            return;
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
