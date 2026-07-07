#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultCardsDir = "output/story-hook-report-cards/cards";
const defaultOutputDir = "output/story-outlines";
const defaultModel = process.env.OPENROUTER_MODEL || "openai/gpt-5.5";
const defaultBaseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const defaultWritingRules = process.env.STORY_OUTLINE_WRITING_RULES || "prompts/writing-rules.md";

const promptSectionOrder = [
  "Writing Prompt Summary",
  "Hook Simulation Details",
  "Verdict",
  "Strengths",
  "Risks",
  "Improvements",
  "Revised Writing Prompt",
  "Original Hook",
  "Resolved Seed Ref Context",
  "Resolved Event Context",
];

function printHelp() {
  console.log(`Create Story Outlines

Usage:
  world-mapgen outline-stories [report-card.md] [options]
  npm run outline:stories -- [report-card.md] [options]

Options:
  --cards-dir <dir>       Directory of report-card markdown files. Defaults to ${defaultCardsDir}
  --input <path>          Report-card markdown file or cards directory. Overrides --cards-dir when directory
  --out <dir>             Output directory. Defaults to ${defaultOutputDir}
  --provider <openrouter|mock>
                          AI provider. Defaults to openrouter
  --model <model>         OpenRouter model slug. Defaults to OPENROUTER_MODEL or ${defaultModel}
  --base-url <url>        OpenRouter-compatible base URL. Defaults to OPENROUTER_BASE_URL or ${defaultBaseUrl}
  --writing-rules <md>    Markdown writing rules injected into the system prompt.
                          Defaults to STORY_OUTLINE_WRITING_RULES or ${defaultWritingRules}
  --overwrite             Remove existing output directory first
  --help                  Show this help

Environment:
  OPENROUTER_API_KEY      Required for --provider openrouter
  OPENROUTER_MODEL        Optional model override
  OPENROUTER_BASE_URL     Optional OpenRouter-compatible base URL
  OPENROUTER_HTTP_REFERER Optional HTTP-Referer header for OpenRouter rankings
  OPENROUTER_APP_TITLE    Optional X-OpenRouter-Title header
  STORY_OUTLINE_WRITING_RULES Optional default writing-rules markdown path

Examples:
  npm run outline:stories -- --cards-dir output/stress-probes/probe-500-story-hook-report-cards/cards --out output/stress-probes/probe-500-story-outlines --overwrite
  npm run outline:stories -- hook-000-character-garin-quaovars-unresolved-thread.md --cards-dir output/story-hook-report-cards/cards --out output/story-outlines --provider mock --overwrite
`);
}

function readValue(args, index, optionName) {
  const current = args[index];
  const prefix = `${optionName}=`;
  if (current.startsWith(prefix)) return {value: current.slice(prefix.length), nextIndex: index};
  if (index + 1 >= args.length) throw new Error(`${optionName} requires a value`);
  return {value: args[index + 1], nextIndex: index + 1};
}

function parseArgs(argv) {
  const options = {
    cardsDir: defaultCardsDir,
    input: undefined,
    cardFile: undefined,
    out: defaultOutputDir,
    provider: "openrouter",
    model: defaultModel,
    baseUrl: defaultBaseUrl,
    writingRules: defaultWritingRules,
    writingRulesText: "",
    writingRulesPath: "",
    overwrite: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--cards-dir" || arg.startsWith("--cards-dir=")) {
      const result = readValue(argv, i, "--cards-dir");
      options.cardsDir = result.value;
      i = result.nextIndex;
    } else if (arg === "--input" || arg.startsWith("--input=")) {
      const result = readValue(argv, i, "--input");
      options.input = result.value;
      i = result.nextIndex;
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const result = readValue(argv, i, "--out");
      options.out = result.value;
      i = result.nextIndex;
    } else if (arg === "--provider" || arg.startsWith("--provider=")) {
      const result = readValue(argv, i, "--provider");
      options.provider = result.value;
      i = result.nextIndex;
    } else if (arg === "--model" || arg.startsWith("--model=")) {
      const result = readValue(argv, i, "--model");
      options.model = result.value;
      i = result.nextIndex;
    } else if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const result = readValue(argv, i, "--base-url");
      options.baseUrl = result.value.replace(/\/+$/, "");
      i = result.nextIndex;
    } else if (arg === "--writing-rules" || arg.startsWith("--writing-rules=")) {
      const result = readValue(argv, i, "--writing-rules");
      options.writingRules = result.value;
      i = result.nextIndex;
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}"`);
    } else {
      if (options.cardFile) throw new Error(`Only one report-card filename may be supplied, got "${arg}" after "${options.cardFile}"`);
      options.cardFile = arg;
    }
  }

  if (!["openrouter", "mock"].includes(options.provider)) {
    throw new Error(`--provider must be openrouter or mock, got "${options.provider}"`);
  }
  return options;
}

function loadWritingRules(options) {
  if (!options.writingRules) return;
  const rulesPath = path.resolve(options.writingRules);
  if (!fs.existsSync(rulesPath) || !fs.statSync(rulesPath).isFile()) {
    throw new Error(`Writing rules file does not exist: ${rulesPath}`);
  }
  options.writingRulesPath = rulesPath;
  options.writingRulesText = fs.readFileSync(rulesPath, "utf8").trim();
}

function slugify(value, fallback = "story-outline") {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

function assertWorkspaceOutputPath(outputDir) {
  const resolved = path.resolve(outputDir);
  const cwd = process.cwd();
  if (!resolved.startsWith(cwd)) {
    throw new Error(`Refusing to write outside the workspace: ${resolved}`);
  }
  return resolved;
}

function removeExistingOutputDir(outputDir) {
  const resolved = assertWorkspaceOutputPath(outputDir);
  if (fs.existsSync(resolved)) fs.rmSync(resolved, {recursive: true, force: true});
}

function compactText(value, maxLength = 1000) {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function bulletList(values) {
  const list = normalizeStringArray(values, []);
  return list.length ? list.map(value => `- ${value}`).join("\n") : "- None";
}

function numberedList(values) {
  const list = normalizeStringArray(values, []);
  return list.length ? list.map((value, index) => `${index + 1}. ${value}`).join("\n") : "1. None";
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const strings = value.map(item => String(item).trim()).filter(Boolean);
  return strings.length ? strings : fallback;
}

function normalizeObjectArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const objects = value.filter(item => item && typeof item === "object" && !Array.isArray(item));
  return objects.length ? objects : fallback;
}

function extractJsonText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function parseMarkdownSections(markdown) {
  const sections = new Map();
  const matches = [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const title = match[1].trim();
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    sections.set(title, markdown.slice(start, end).trim());
  }
  return sections;
}

function parseMetadataTable(markdown) {
  const metadata = {};
  const tableMatch = markdown.match(/\| Field \| Value \|\s*\n\| --- \| --- \|\s*\n([\s\S]*?)(?:\n\n|$)/);
  if (!tableMatch) return metadata;
  for (const line of tableMatch[1].split(/\r?\n/)) {
    const cells = line.trim().split("|").map(cell => cell.trim()).filter(Boolean);
    if (cells.length >= 2) metadata[cells[0]] = cells.slice(1).join(" | ");
  }
  return metadata;
}

function parseReportCard(cardPath) {
  const markdown = fs.readFileSync(cardPath, "utf8");
  const title = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? path.basename(cardPath, ".md");
  const sections = parseMarkdownSections(markdown);
  return {
    path: path.resolve(cardPath),
    filename: path.basename(cardPath),
    title,
    metadata: parseMetadataTable(markdown),
    sections,
    markdown,
  };
}

function section(card, name, maxLength = 4000) {
  return compactText(card.sections.get(name) ?? "", maxLength);
}

function reportCardPromptInput(card) {
  const chunks = [
    `Title: ${card.title}`,
    `Source file: ${card.filename}`,
    `Metadata:\n${JSON.stringify(card.metadata, null, 2)}`,
  ];
  for (const name of promptSectionOrder) {
    const text = section(card, name, name === "Hook Simulation Details" ? 7000 : 3500);
    if (text) chunks.push(`## ${name}\n${text}`);
  }
  return chunks.join("\n\n");
}

function promptForOutline(card) {
  return `Create a usable story outline from this fantasy-world report card.

Report card:
${reportCardPromptInput(card)}

Return only valid JSON matching this shape:
{
  "title": "Story title",
  "logline": "One sentence hook.",
  "premise": "One concise paragraph.",
  "protagonists": ["named protagonist or viewpoint option"],
  "supportingCast": ["named ally, witness, institution, faction, or location"],
  "antagonisticForces": ["person, faction, pressure, secret, prophecy, or social force"],
  "setting": ["important locations and world context"],
  "themes": ["two to five themes"],
  "actOutline": [
    {"act": "Act I", "purpose": "dramatic function", "beats": ["3-5 concrete beats"]},
    {"act": "Act II", "purpose": "dramatic function", "beats": ["4-7 concrete beats"]},
    {"act": "Act III", "purpose": "dramatic function", "beats": ["3-5 concrete beats"]}
  ],
  "keyScenes": ["specific scenes to include"],
  "relationshipThreads": ["social bond, feud, oath, secret, belief, or duty thread"],
  "worldLoreToUse": ["world facts from the report card that should appear on page"],
  "mysteriesAndReveals": ["question, clue, reveal, or reversal"],
  "choicesAndConsequences": ["choice and consequence pair"],
  "endingOptions": ["possible ending"],
  "continuationHooks": ["follow-up hook"]
}

Ground the outline in the report card. Use specific names and records from the resolved seed refs and resolved event context. Treat raw ids as traceability only. Do not invent facts outside the report card, but you may add connective plot logic that follows from those facts.`;
}

function systemInstructions(options) {
  const base = "You turn fantasy-world simulation report cards into concrete story outlines. Return only valid JSON.";
  if (!options.writingRulesText) return base;
  return `${base}

Apply these writing rules to every outline field. They control voice, banned phrasing, rhythm, and structure:

${options.writingRulesText}`;
}

function normalizeActOutline(value) {
  const acts = normalizeObjectArray(value, []);
  if (!acts.length) {
    return [
      {act: "Act I", purpose: "Introduce the immediate pressure.", beats: ["Open on the first public sign that the hook cannot stay private."]},
      {act: "Act II", purpose: "Escalate through linked records.", beats: ["Use the strongest resolved refs and events as complications."]},
      {act: "Act III", purpose: "Force a decision.", beats: ["Resolve the central choice while leaving one world-facing consequence."]},
    ];
  }
  return acts.map((act, index) => ({
    act: String(act.act || `Act ${index + 1}`),
    purpose: String(act.purpose || "Move the story forward."),
    beats: normalizeStringArray(act.beats, ["Add one concrete beat tied to the report card."]),
  }));
}

function normalizeOutline(raw, card) {
  return {
    title: String(raw.title || card.title),
    logline: String(raw.logline || section(card, "Writing Prompt Summary", 500) || card.title),
    premise: String(raw.premise || section(card, "Revised Writing Prompt", 900) || section(card, "Original Hook", 900) || card.title),
    protagonists: normalizeStringArray(raw.protagonists, []),
    supportingCast: normalizeStringArray(raw.supportingCast, []),
    antagonisticForces: normalizeStringArray(raw.antagonisticForces, []),
    setting: normalizeStringArray(raw.setting, []),
    themes: normalizeStringArray(raw.themes, []),
    actOutline: normalizeActOutline(raw.actOutline),
    keyScenes: normalizeStringArray(raw.keyScenes, []),
    relationshipThreads: normalizeStringArray(raw.relationshipThreads, []),
    worldLoreToUse: normalizeStringArray(raw.worldLoreToUse, []),
    mysteriesAndReveals: normalizeStringArray(raw.mysteriesAndReveals, []),
    choicesAndConsequences: normalizeStringArray(raw.choicesAndConsequences, []),
    endingOptions: normalizeStringArray(raw.endingOptions, []),
    continuationHooks: normalizeStringArray(raw.continuationHooks, []),
  };
}

function firstBulletLines(text, limit = 6) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith("- "))
    .map(line => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, limit);
}

function mockStoryOutline(card) {
  const summary = section(card, "Writing Prompt Summary", 700) || card.title;
  const revised = section(card, "Revised Writing Prompt", 900) || section(card, "Original Hook", 900) || summary;
  const refs = firstBulletLines(section(card, "Resolved Seed Ref Context", 2500), 6);
  const events = firstBulletLines(section(card, "Resolved Event Context", 2500), 6);
  const improvements = firstBulletLines(section(card, "Improvements", 1000), 3);
  const title = `${card.title} Outline`;
  return normalizeOutline({
    title,
    logline: summary.split(/\n+/)[0],
    premise: revised,
    protagonists: refs.slice(0, 2),
    supportingCast: refs.slice(2, 5),
    antagonisticForces: refs.slice(5, 6).concat(events.slice(0, 2)),
    setting: refs.filter(line => /\bsettlement:|\bcivilization:|\bbattle:|\bconflict:/i.test(line)).slice(0, 4),
    themes: ["duty under pressure", "public memory", "private cost"],
    actOutline: [
      {
        act: "Act I",
        purpose: "Turn the report-card hook into an immediate problem.",
        beats: [
          "Open with the named hook pressure becoming visible to witnesses.",
          refs[0] ? `Anchor the first scene on ${refs[0]}.` : "Anchor the first scene on the strongest resolved seed ref.",
          improvements[0] || "State the first hard choice before the backstory expands.",
        ],
      },
      {
        act: "Act II",
        purpose: "Use linked records as complications instead of exposition.",
        beats: [
          events[0] ? `Bring forward the consequence of ${events[0]}.` : "Bring forward the oldest relevant event as a complication.",
          refs[1] ? `Let ${refs[1]} change the social stakes.` : "Let a second resolved ref change the social stakes.",
          improvements[1] || "Reveal one hidden cost and one public consequence.",
        ],
      },
      {
        act: "Act III",
        purpose: "Resolve the central choice while preserving future hooks.",
        beats: [
          "Force the protagonist to choose between private loyalty and public duty.",
          events[1] ? `Echo or reverse ${events[1]}.` : "Echo one resolved event in the final decision.",
          improvements[2] || "End with one concrete change to trust, ownership, faith, law, or memory.",
        ],
      },
    ],
    keyScenes: [
      "A public discovery or accusation names the old record.",
      "A private conversation reframes the hook's strongest relationship.",
      "A final decision changes how the community remembers the event.",
    ],
    relationshipThreads: refs.concat(events).slice(0, 6),
    worldLoreToUse: refs.concat(events).slice(0, 8),
    mysteriesAndReveals: [
      "What really makes the old record dangerous now?",
      "Who benefits if the public accepts the simplest version of events?",
    ],
    choicesAndConsequences: [
      "Expose the truth and risk institutional backlash.",
      "Protect a private bond and let the public record harden around a lie.",
    ],
    endingOptions: [
      "Reconciliation restores one bond but creates a new public obligation.",
      "The truth wins legally or ritually, while a personal relationship breaks.",
    ],
    continuationHooks: [
      "A linked oath, feud, artifact, prophecy, or memory becomes the next pressure point.",
    ],
  }, card);
}

async function openRouterStoryOutline(card, options) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for --provider openrouter. Use --provider mock for local output-shape testing.");
  }

  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost",
      "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE || "RGBKnights World Map Story Outline Generator",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "system",
          content: systemInstructions(options),
        },
        {
          role: "user",
          content: promptForOutline(card),
        },
      ],
    }),
  });

  const payloadText = await response.text();
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error(`OpenRouter response was not JSON: ${payloadText.slice(0, 500)}`);
  }

  if (!response.ok) {
    const message = payload?.error?.message || payloadText;
    throw new Error(`OpenRouter request failed (${response.status}): ${message}`);
  }

  const outputText = payload.choices?.[0]?.message?.content
    ?? payload.choices?.[0]?.text
    ?? "";
  if (!outputText.trim()) {
    throw new Error(`OpenRouter response had no message content: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  let raw;
  try {
    raw = JSON.parse(extractJsonText(outputText));
  } catch (error) {
    throw new Error(`Could not parse story-outline JSON for "${card.title}": ${error.message}\n${outputText.slice(0, 1000)}`);
  }
  return normalizeOutline(raw, card);
}

async function createStoryOutline(card, options) {
  if (options.provider === "mock") return mockStoryOutline(card);
  return openRouterStoryOutline(card, options);
}

function actMarkdown(acts) {
  return acts.map(act => `### ${act.act}\n\n${act.purpose}\n\n${numberedList(act.beats)}`).join("\n\n");
}

function outlineMarkdown(entry) {
  const {card, outline, options, outputDir} = entry;
  const source = path.relative(outputDir, card.path).replace(/\\/g, "/");
  return `# ${outline.title}

| Field | Value |
| --- | --- |
| Source report card | [${markdownEscape(card.filename)}](${source}) |
| Provider | ${markdownEscape(options.provider)} |
| Model | ${markdownEscape(options.provider === "mock" ? "mock" : options.model)} |
| Hook kind | ${markdownEscape(card.metadata.Kind ?? "")} |
| Hook grade | ${markdownEscape(card.metadata.Grade ?? "")} |

## Logline

${outline.logline}

## Premise

${outline.premise}

## Protagonists

${bulletList(outline.protagonists)}

## Supporting Cast

${bulletList(outline.supportingCast)}

## Antagonistic Forces

${bulletList(outline.antagonisticForces)}

## Setting

${bulletList(outline.setting)}

## Themes

${bulletList(outline.themes)}

## Act Outline

${actMarkdown(outline.actOutline)}

## Key Scenes

${numberedList(outline.keyScenes)}

## Relationship Threads

${bulletList(outline.relationshipThreads)}

## World Lore To Use

${bulletList(outline.worldLoreToUse)}

## Mysteries And Reveals

${bulletList(outline.mysteriesAndReveals)}

## Choices And Consequences

${bulletList(outline.choicesAndConsequences)}

## Ending Options

${bulletList(outline.endingOptions)}

## Continuation Hooks

${bulletList(outline.continuationHooks)}
`;
}

function summaryMarkdown({entries, options, outputDir}) {
  const rows = entries
    .map(entry => `| [${markdownEscape(entry.outline.title)}](${path.relative(outputDir, entry.outlinePath).replace(/\\/g, "/")}) | ${markdownEscape(entry.card.title)} | ${markdownEscape(entry.card.metadata.Kind ?? "")} | ${markdownEscape(entry.card.metadata.Grade ?? "")} | ${markdownEscape(entry.outline.logline)} |`)
    .join("\n");
  return `# Story Outline Summary

Generated at: ${new Date().toISOString()}

Provider: ${options.provider}

Model: ${options.provider === "mock" ? "mock" : options.model}

Writing rules: ${options.writingRulesPath || "none"}

Outlines created: ${entries.length}

| Outline | Source Report Card | Kind | Grade | Logline |
| --- | --- | --- | --- | --- |
${rows}
`;
}

function indexMarkdown(entries, summaryPath) {
  const outputDir = path.dirname(summaryPath);
  const rows = entries
    .map(entry => `| [${markdownEscape(entry.outline.title)}](${path.relative(outputDir, entry.outlinePath).replace(/\\/g, "/")}) | ${markdownEscape(entry.card.title)} | ${markdownEscape(entry.card.metadata.Kind ?? "")} |`)
    .join("\n");
  return `# Story Outlines

See [summary.md](${path.basename(summaryPath)}) for the generated outline summary.

| Outline | Source Report Card | Kind |
| --- | --- | --- |
${rows}
`;
}

function resolveSingleCardPath(cardFile, cardsDir) {
  const candidates = [];
  if (path.isAbsolute(cardFile)) candidates.push(cardFile);
  candidates.push(path.resolve(cardFile));
  candidates.push(path.resolve(cardsDir, cardFile));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  throw new Error(`Could not find report card "${cardFile}" directly or under ${path.resolve(cardsDir)}`);
}

function resolveCardPaths(options) {
  let cardsDir = options.cardsDir;
  let cardFile = options.cardFile;
  if (options.input) {
    const inputPath = path.resolve(options.input);
    if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
      cardsDir = inputPath;
    } else {
      cardFile = options.input;
    }
  }

  if (cardFile) return [resolveSingleCardPath(cardFile, cardsDir)];

  const resolvedCardsDir = path.resolve(cardsDir);
  if (!fs.existsSync(resolvedCardsDir) || !fs.statSync(resolvedCardsDir).isDirectory()) {
    throw new Error(`Cards directory does not exist: ${resolvedCardsDir}. Supply a report-card filename or --cards-dir.`);
  }
  const cardPaths = fs.readdirSync(resolvedCardsDir)
    .filter(file => file.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map(file => path.join(resolvedCardsDir, file));
  if (!cardPaths.length) throw new Error(`No markdown report cards found in ${resolvedCardsDir}`);
  return cardPaths;
}

function writeOutputs({entries, options}) {
  if (options.overwrite) removeExistingOutputDir(options.out);
  const outputDir = assertWorkspaceOutputPath(options.out);
  const outlinesDir = path.join(outputDir, "outlines");
  fs.mkdirSync(outlinesDir, {recursive: true});

  for (const entry of entries) {
    const sourceBase = path.basename(entry.card.filename, path.extname(entry.card.filename));
    const filename = `${slugify(sourceBase)}-outline.md`;
    entry.outlinePath = path.join(outlinesDir, filename);
    entry.outputDir = outputDir;
    fs.writeFileSync(entry.outlinePath, outlineMarkdown({...entry, options, outputDir}), "utf8");
  }

  const summaryPath = path.join(outputDir, "summary.md");
  fs.writeFileSync(summaryPath, summaryMarkdown({entries, options, outputDir}), "utf8");
  fs.writeFileSync(path.join(outputDir, "index.md"), indexMarkdown(entries, summaryPath), "utf8");
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    provider: options.provider,
    model: options.provider === "mock" ? "mock" : options.model,
    writingRulesPath: options.writingRulesPath || undefined,
    outlineCount: entries.length,
    outlines: entries.map(entry => ({
      title: entry.outline.title,
      sourceCard: entry.card.path,
      sourceCardFilename: entry.card.filename,
      sourceKind: entry.card.metadata.Kind,
      sourceGrade: entry.card.metadata.Grade,
      file: path.relative(outputDir, entry.outlinePath).replace(/\\/g, "/"),
      logline: entry.outline.logline,
    })),
  }, null, 2), "utf8");

  return {outputDir, summaryPath, outlinesDir};
}

export async function runCreateStoryOutlinesCommand(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  loadWritingRules(options);
  const cardPaths = resolveCardPaths(options);
  const cards = cardPaths.map(parseReportCard);
  const entries = [];

  for (const card of cards) {
    console.log(`Creating outline ${entries.length + 1}/${cards.length}: ${card.title}`);
    const outline = await createStoryOutline(card, options);
    entries.push({card, outline});
  }

  const output = writeOutputs({entries, options});
  console.log(`Wrote ${entries.length} story outline${entries.length === 1 ? "" : "s"} to ${output.outputDir}`);
  console.log(`Summary: ${output.summaryPath}`);
}
