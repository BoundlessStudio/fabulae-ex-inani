#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultInput = "output/stress-probes/probe-500-final.json";
const defaultOutputDir = "output/story-hook-report-cards";
const defaultModel = process.env.OPENROUTER_MODEL || "openai/gpt-5.5";
const defaultBaseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

const storyHookKinds = [
  "relationship",
  "artifact",
  "conflict",
  "prophecy",
  "mystery",
  "character",
  "legacy",
];

function printHelp() {
  console.log(`Evaluate Story Hooks

Usage:
  node scripts/evaluate-story-hooks.mjs [options]
  npm run evaluate:story-hooks -- [options]

Options:
  --input <json>          Profile or Legends JSON. Defaults to ${defaultInput}
  --out <dir>             Output directory. Defaults to ${defaultOutputDir}
  --top <count>           Global top hook count. Defaults to 12
  --per-kind <count>      Extra top hooks per kind. Defaults to 1
  --mode <top|by-kind|both>
                          Which hooks to evaluate. Defaults to both
  --provider <openrouter|mock>
                          AI provider. Defaults to openrouter
  --model <model>         OpenRouter model slug. Defaults to OPENROUTER_MODEL or ${defaultModel}
  --base-url <url>        OpenRouter-compatible base URL. Defaults to OPENROUTER_BASE_URL or ${defaultBaseUrl}
  --overwrite             Remove existing output directory first
  --help                  Show this help

Environment:
  OPENROUTER_API_KEY      Required for --provider openrouter
  OPENROUTER_MODEL        Optional model override
  OPENROUTER_BASE_URL     Optional OpenRouter-compatible base URL
  OPENROUTER_HTTP_REFERER Optional HTTP-Referer header for OpenRouter rankings
  OPENROUTER_APP_TITLE    Optional X-OpenRouter-Title header

Examples:
  npm run stress:500
  npm run evaluate:story-hooks -- --input output/stress-probes/probe-500-final.json --out output/stress-probes/probe-500-story-hook-report-cards
  npm run evaluate:story-hooks -- --input output/stress-probes/story-hook-no-place-sample.json --out output/story-hook-report-cards-smoke --provider mock --overwrite
`);
}

function readValue(args, index, optionName) {
  const current = args[index];
  const prefix = `${optionName}=`;
  if (current.startsWith(prefix)) return {value: current.slice(prefix.length), nextIndex: index};
  if (index + 1 >= args.length) throw new Error(`${optionName} requires a value`);
  return {value: args[index + 1], nextIndex: index + 1};
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    input: defaultInput,
    out: defaultOutputDir,
    top: 12,
    perKind: 1,
    mode: "both",
    provider: "openrouter",
    model: defaultModel,
    baseUrl: defaultBaseUrl,
    overwrite: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--input" || arg.startsWith("--input=")) {
      const result = readValue(argv, i, "--input");
      options.input = result.value;
      i = result.nextIndex;
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const result = readValue(argv, i, "--out");
      options.out = result.value;
      i = result.nextIndex;
    } else if (arg === "--top" || arg.startsWith("--top=")) {
      const result = readValue(argv, i, "--top");
      options.top = parsePositiveInteger(result.value, "--top");
      i = result.nextIndex;
    } else if (arg === "--per-kind" || arg.startsWith("--per-kind=")) {
      const result = readValue(argv, i, "--per-kind");
      options.perKind = parsePositiveInteger(result.value, "--per-kind");
      i = result.nextIndex;
    } else if (arg === "--mode" || arg.startsWith("--mode=")) {
      const result = readValue(argv, i, "--mode");
      options.mode = result.value;
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
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else {
      throw new Error(`Unknown option "${arg}"`);
    }
  }

  if (!["top", "by-kind", "both"].includes(options.mode)) {
    throw new Error(`--mode must be top, by-kind, or both, got "${options.mode}"`);
  }
  if (!["openrouter", "mock"].includes(options.provider)) {
    throw new Error(`--provider must be openrouter or mock, got "${options.provider}"`);
  }
  return options;
}

function slugify(value, fallback = "hook") {
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

function scoreSort(a, b) {
  return (b.score ?? 0) - (a.score ?? 0)
    || (b.urgency ?? 0) - (a.urgency ?? 0)
    || (b.year ?? 0) - (a.year ?? 0)
    || String(a.name ?? "").localeCompare(String(b.name ?? ""));
}

function hookKey(hook) {
  if (hook.id !== undefined && hook.kind) return `${hook.kind}:${hook.id}`;
  return `${hook.kind ?? "hook"}:${hook.name ?? JSON.stringify(hook).slice(0, 80)}`;
}

function normalizeHook(hook) {
  return {
    id: hook.id,
    name: hook.name ?? `Story Hook ${hook.id ?? "unknown"}`,
    kind: hook.kind ?? "unknown",
    tone: hook.tone ?? "unknown",
    year: hook.year,
    score: hook.score,
    urgency: hook.urgency,
    prompt: hook.prompt ?? "",
    stakes: hook.stakes ?? "",
    complication: hook.complication ?? "",
    suggestedFocus: hook.suggestedFocus ?? "",
    seedRefs: Array.isArray(hook.seedRefs) ? hook.seedRefs : [],
    eventIds: Array.isArray(hook.eventIds) ? hook.eventIds : [],
    resolvedSeedRefs: Array.isArray(hook.resolvedSeedRefs) ? hook.resolvedSeedRefs : [],
    resolvedEvents: Array.isArray(hook.resolvedEvents) ? hook.resolvedEvents : [],
  };
}

const refCollectionKeys = {
  civilization: ["civilizations"],
  settlement: ["settlements"],
  "settlement-control": ["settlementControls"],
  "natural-feature": ["naturalFeatures"],
  person: ["people", "agents"],
  "person-allegiance": ["personAllegiances"],
  preference: ["preferences"],
  tradition: ["traditions"],
  epithet: ["epithets"],
  "reputation-milestone": ["reputationMilestones"],
  artifact: ["artifacts"],
  "artifact-condition": ["artifactConditions"],
  chronicle: ["chronicles"],
  "written-work": ["writtenWorks"],
  memory: ["memories"],
  thought: ["thoughts"],
  "personality-shift": ["personalityShifts"],
  "need-episode": ["needEpisodes"],
  opinion: ["opinions"],
  "social-claim": ["socialClaims"],
  conversation: ["conversations"],
  rumor: ["rumors"],
  secret: ["secrets"],
  scheme: ["schemes"],
  feud: ["feuds"],
  oath: ["oaths"],
  ceremony: ["ceremonies"],
  "ceremony-participation": ["ceremonyParticipations"],
  activity: ["activities"],
  teaching: ["teachings"],
  project: ["projects"],
  "project-participation": ["projectParticipations"],
  obligation: ["obligations"],
  holding: ["holdings"],
  belonging: ["belongings"],
  "possession-attachment": ["possessionAttachments"],
  estate: ["estates"],
  residence: ["residences"],
  career: ["careers"],
  organization: ["organizations"],
  membership: ["memberships"],
  "organization-rank": ["organizationRanks"],
  relationship: ["relationships", "socialBonds"],
  "relationship-milestone": ["relationshipMilestones"],
  union: ["unions"],
  belief: ["beliefs"],
  "belief-adherence": ["beliefAdherences"],
  god: ["gods"],
  commandment: ["commandments"],
  destiny: ["destinies"],
  miracle: ["miracles"],
  myth: ["myths"],
  doctrine: ["doctrines"],
  "magic-role": ["magicRoles"],
  prophecy: ["prophecies"],
  "civilization-goal": ["civilizationGoals"],
  "sacred-site": ["sacredSites"],
  office: ["offices"],
  "office-term": ["officeTerms"],
  law: ["laws"],
  case: ["cases"],
  testimony: ["testimonies"],
  conflict: ["conflicts"],
  battle: ["battles"],
  "battle-participation": ["battleParticipations"],
  "military-unit": ["militaryUnits"],
  "equipment-cache": ["equipmentCaches"],
  "spy-network": ["spyNetworks"],
  "spy-operation": ["spyOperations"],
  injury: ["injuries"],
  illness: ["illnesses"],
  "care-record": ["careRecords"],
  "wound-legacy": ["woundLegacies"],
  memorial: ["memorials"],
  burial: ["burials"],
  "death-record": ["deathRecords"],
  birth: ["births"],
  "age-milestone": ["ageMilestones"],
  "appearance-feature": ["appearanceFeatures"],
  ambition: ["ambitions"],
  apprenticeship: ["apprenticeships"],
  skill: ["skills"],
  structure: ["structures"],
  journey: ["journeys"],
  road: ["roads"],
  household: ["households"],
  lineage: ["lineages"],
  "story-hook": ["storyHooks"],
  event: ["events", "legendEvents"],
};

function compactText(value, maxLength = 500) {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}

function roundNumber(value, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function numberList(value, limit = 8) {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter(item => typeof item === "number" && Number.isFinite(item)).slice(0, limit);
  return ids.length ? ids : undefined;
}

function refList(value, limit = 6) {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .filter(item => item && typeof item === "object")
    .map(item => ({
      kind: item.kind,
      id: item.id,
      name: compactText(item.name, 120),
    }))
    .filter(item => typeof item.kind === "string" && typeof item.id === "number")
    .slice(0, limit);
  return refs.length ? refs : undefined;
}

function recordFromCollection(collection, id) {
  if (!Array.isArray(collection)) return undefined;
  const direct = collection[id];
  if (direct && typeof direct === "object" && direct.id === id) return direct;
  return collection.find(item => item && typeof item === "object" && item.id === id);
}

function recordForRef(data, ref) {
  const keys = refCollectionKeys[ref.kind] ?? [];
  for (const key of keys) {
    const record = recordFromCollection(data[key], ref.id);
    if (record) return record;
  }
  return undefined;
}

function nameForRef(data, kind, id) {
  if (kind === "event") {
    const event = recordFromCollection(data.events, id) ?? recordFromCollection(data.legendEvents, id);
    return event ? `${event.year}: ${compactText(event.headline, 160) ?? `Event ${id}`}` : undefined;
  }
  if (kind === "relationship") {
    const record = recordForRef(data, {kind, id});
    const ids = numberList(record?.agentIds, 2) ?? [];
    if (ids.length === 2) return `${nameForRef(data, "person", ids[0]) ?? `Person ${ids[0]}`} and ${nameForRef(data, "person", ids[1]) ?? `Person ${ids[1]}`}`;
  }
  if (kind === "road") {
    const record = recordForRef(data, {kind, id});
    if (typeof record?.fromSettlementId === "number" && typeof record?.toSettlementId === "number") {
      return `${nameForRef(data, "settlement", record.fromSettlementId) ?? `Settlement ${record.fromSettlementId}`} to ${nameForRef(data, "settlement", record.toSettlementId) ?? `Settlement ${record.toSettlementId}`} road`;
    }
  }
  const record = recordForRef(data, {kind, id});
  return compactText(record?.name, 160);
}

function firstText(record, keys, maxLength = 500) {
  for (const key of keys) {
    const text = compactText(record?.[key], maxLength);
    if (text) return text;
  }
  return undefined;
}

function firstNumber(record, keys, digits = 3) {
  for (const key of keys) {
    const value = roundNumber(record?.[key], digits);
    if (value !== undefined) return value;
  }
  return undefined;
}

function maybeSet(target, key, value) {
  if (value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  target[key] = value;
}

function namedLinkFields(data, record) {
  const fields = [
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
  const links = [];
  const seen = new Set();
  for (const [field, kind] of fields) {
    const id = record?.[field];
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(`${field}=${key}:${nameForRef(data, kind, id) ?? `${kind} ${id}`}`);
  }
  return links.length ? links : undefined;
}

function resolvedSeedRefSummary(data, ref, record) {
  if (ref.kind === "relationship") {
    const ids = numberList(record.agentIds, 2) ?? [];
    const people = ids.map(id => nameForRef(data, "person", id) ?? `Person ${id}`);
    return `${record.kind ?? "relationship"} between ${people.join(" and ") || "unknown people"} started in ${record.startedYear ?? "unknown year"}. Strength ${roundNumber(record.strength) ?? "unknown"}, trust ${roundNumber(record.trust) ?? "unknown"}, tension ${roundNumber(record.tension) ?? "unknown"}, active ${record.active === false ? "no" : "yes"}, milestones ${(numberList(record.milestoneIds, 1000) ?? []).length}.`;
  }
  if (ref.kind === "person") {
    const civ = typeof record.civilizationId === "number" ? nameForRef(data, "civilization", record.civilizationId) : undefined;
    const place = typeof record.settlementId === "number" ? nameForRef(data, "settlement", record.settlementId) : undefined;
    return `${record.name ?? ref.name ?? `Person ${ref.id}`} is ${record.alive === false ? "dead" : "alive"}, age ${record.age ?? "unknown"}, ${record.profession ?? "unknown profession"}${civ ? ` of ${civ}` : ""}${place ? ` in ${place}` : ""}. Mental state ${record.mentalState ?? "unknown"}; reputation ${roundNumber(record.reputation) ?? "unknown"}.`;
  }
  if (ref.kind === "artifact") {
    const owner = typeof record.ownerAgentId === "number" ? nameForRef(data, "person", record.ownerAgentId) : undefined;
    return `${record.name ?? ref.name ?? `Artifact ${ref.id}`} is a ${record.quality ?? "unknown-quality"} ${record.scale ?? "unknown-scale"} ${record.kind ?? "artifact"} made of ${record.material ?? "unknown material"}. Condition ${record.condition ?? "unknown"}, renown ${roundNumber(record.renown) ?? "unknown"}${owner ? `, owner ${owner}` : ""}. ${compactText(record.detail, 260) ?? compactText(record.inscription, 260) ?? ""}`.trim();
  }
  if (ref.kind === "conflict") {
    const attacker = typeof record.attackerCivilizationId === "number" ? nameForRef(data, "civilization", record.attackerCivilizationId) : undefined;
    const defender = typeof record.defenderCivilizationId === "number" ? nameForRef(data, "civilization", record.defenderCivilizationId) : undefined;
    return `${record.name ?? ref.name ?? `Conflict ${ref.id}`} is a ${record.status ?? "unknown"} ${record.kind ?? "conflict"}. ${attacker ?? "Unknown attacker"} versus ${defender ?? "unknown defender"}, battles ${(numberList(record.battleIds, 1000) ?? []).length}, casualties ${(numberList(record.casualtyAgentIds, 1000) ?? []).length}.`;
  }
  if (ref.kind === "battle") {
    const attacker = typeof record.attackerCivilizationId === "number" ? nameForRef(data, "civilization", record.attackerCivilizationId) : undefined;
    const defender = typeof record.defenderCivilizationId === "number" ? nameForRef(data, "civilization", record.defenderCivilizationId) : undefined;
    return `${record.name ?? ref.name ?? `Battle ${ref.id}`} happened at ${record.battlefieldName ?? "an unnamed battlefield"} in year ${record.year ?? "unknown"}. Terrain ${record.battlefieldTerrain ?? "unknown"}, outcome ${record.outcome ?? "unknown"}, ${attacker ?? "unknown attacker"} versus ${defender ?? "unknown defender"}, casualties ${(numberList(record.casualtyAgentIds, 1000) ?? []).length}.`;
  }
  const text = firstText(record, ["description", "detail", "inscription", "principle", "demand", "effect"], 500);
  if (text) return text;
  const attributes = ["kind", "status", "type", "domain", "scale", "purpose", "quality", "condition", "outcome"]
    .map(key => compactText(record[key], 80))
    .filter(Boolean);
  const year = firstNumber(record, ["year", "startedYear", "foundedYear", "createdYear", "builtYear", "openedYear", "swornYear", "givenYear"], 0);
  return attributes.length || year !== undefined
    ? `${nameForRef(data, ref.kind, ref.id) ?? ref.name ?? `${ref.kind} ${ref.id}`} has ${attributes.join(", ") || "recorded context"}${year !== undefined ? ` in year ${year}` : ""}.`
    : undefined;
}

function resolveSeedRef(data, ref) {
  const record = recordForRef(data, ref);
  const resolved = {
    kind: ref.kind,
    id: ref.id,
    name: ref.name ?? nameForRef(data, ref.kind, ref.id),
  };
  if (!record) return {...resolved, missing: true};
  maybeSet(resolved, "recordKind", compactText(record.kind, 80) ?? compactText(record.type, 80) ?? compactText(record.domain, 80));
  maybeSet(resolved, "status", compactText(record.status, 80));
  maybeSet(resolved, "year", firstNumber(record, ["year", "startedYear", "foundedYear", "createdYear", "builtYear", "openedYear", "swornYear", "givenYear"], 0));
  maybeSet(resolved, "endedYear", firstNumber(record, ["endedYear", "resolvedYear", "fallenYear", "settledYear", "revealedYear"], 0));
  maybeSet(resolved, "summary", resolvedSeedRefSummary(data, ref, record));
  maybeSet(resolved, "description", firstText(record, ["description", "detail", "inscription", "creationClaim", "religiousMandate"], 600));
  maybeSet(resolved, "eventIds", numberList(record.eventIds, 8));
  maybeSet(resolved, "subjectRefs", refList(record.subjectRefs, 6));
  maybeSet(resolved, "linkedEntities", namedLinkFields(data, record));
  return resolved;
}

function resolveEvent(data, eventId) {
  const event = recordFromCollection(data.events, eventId) ?? recordFromCollection(data.legendEvents, eventId);
  if (!event) return {id: eventId, missing: true};
  return {
    id: event.id,
    year: event.year,
    type: event.type,
    headline: compactText(event.headline, 240),
    description: compactText(event.description, 600),
    entityRefs: refList(event.entityRefs, 8),
  };
}

function resolvedHookContext(hook, data) {
  const resolvedSeedRefs = hook.resolvedSeedRefs.length
    ? hook.resolvedSeedRefs
    : hook.seedRefs.map(ref => resolveSeedRef(data, ref));
  const resolvedEvents = hook.resolvedEvents.length
    ? hook.resolvedEvents
    : hook.eventIds.map(eventId => resolveEvent(data, eventId));
  return {resolvedSeedRefs, resolvedEvents};
}

function sourceHooks(data) {
  if (Array.isArray(data.storyHooks) && data.storyHooks.length > 0) {
    return data.storyHooks.map(normalizeHook).sort(scoreSort);
  }
  if (Array.isArray(data.storyHookSamples) && data.storyHookSamples.length > 0) {
    return data.storyHookSamples.map(normalizeHook).sort(scoreSort);
  }
  if (data.storyHookSamplesByKind && typeof data.storyHookSamplesByKind === "object") {
    return Object.values(data.storyHookSamplesByKind)
      .flat()
      .map(normalizeHook)
      .sort(scoreSort);
  }
  throw new Error("Input JSON does not contain storyHooks, storyHookSamples, or storyHookSamplesByKind");
}

function byKindHooks(data, fallbackHooks) {
  const result = new Map(storyHookKinds.map(kind => [kind, []]));
  if (Array.isArray(data.storyHooks) && data.storyHooks.length > 0) {
    for (const hook of data.storyHooks.map(normalizeHook).sort(scoreSort)) {
      if (!result.has(hook.kind)) result.set(hook.kind, []);
      result.get(hook.kind).push(hook);
    }
    return result;
  }
  if (data.storyHookSamplesByKind && typeof data.storyHookSamplesByKind === "object") {
    for (const [kind, hooks] of Object.entries(data.storyHookSamplesByKind)) {
      if (!Array.isArray(hooks)) continue;
      result.set(kind, hooks.map(normalizeHook).sort(scoreSort));
    }
    return result;
  }
  for (const hook of fallbackHooks) {
    if (!result.has(hook.kind)) result.set(hook.kind, []);
    result.get(hook.kind).push(hook);
  }
  return result;
}

function selectHooks(data, options) {
  const globalHooks = sourceHooks(data);
  const selected = [];
  const seen = new Set();

  function add(hook, reason) {
    const key = hookKey(hook);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push({...hook, selectionReason: reason});
  }

  if (options.mode === "top" || options.mode === "both") {
    for (const hook of globalHooks.slice(0, options.top)) add(hook, `global-top-${options.top}`);
  }

  if (options.mode === "by-kind" || options.mode === "both") {
    const grouped = byKindHooks(data, globalHooks);
    for (const kind of storyHookKinds) {
      for (const hook of (grouped.get(kind) ?? []).slice(0, options.perKind)) {
        add(hook, `top-${options.perKind}-${kind}`);
      }
    }
  }

  return selected.sort(scoreSort).map((hook, index) => ({
    ...hook,
    ...resolvedHookContext(hook, data),
    reportIndex: index,
  }));
}

function selectedCounts(data) {
  const counts = data.counts && typeof data.counts === "object" ? data.counts : {};
  const keys = [
    "civilizations",
    "settlements",
    "roads",
    "agents",
    "aliveAgentIds",
    "socialBonds",
    "relationshipMilestones",
    "artifacts",
    "artifactConditions",
    "conflicts",
    "battles",
    "battleParticipations",
    "beliefs",
    "gods",
    "miracles",
    "prophecies",
    "civilizationGoals",
    "secrets",
    "schemes",
    "feuds",
    "oaths",
    "rumors",
    "chronicles",
    "writtenWorks",
    "legendEvents",
    "storyHooks",
  ];
  return Object.fromEntries(keys.filter(key => counts[key] !== undefined).map(key => [key, counts[key]]));
}

function worldSimulationDetails(data) {
  return {
    year: data.year,
    civilizations: data.civilizations,
    workerCount: data.workerCount,
    settlements: data.settlements,
    roads: data.counts?.roads,
    aliveAgents: data.aliveAgents,
    totalAgents: data.totalAgents,
    deadAgents: data.deadAgents,
    legendEvents: data.legendEvents,
    compactedLegendEvents: data.compactedLegendEvents,
    spilledLegendEventTexts: data.spilledLegendEventTexts,
    storyHooks: data.counts?.storyHooks ?? data.storyHookCount,
    storyHookCountsByKind: data.storyHookCountsByKind,
    selectedCounts: selectedCounts(data),
    lifecycle: data.lifecycle ? {
      statusCounts: data.lifecycle.statusCounts,
      originKindCounts: data.lifecycle.originKindCounts,
      collapseStageCounts: data.lifecycle.collapseStageCounts,
      collapseFailureKindCounts: data.lifecycle.collapseFailureKindCounts,
      successorCount: data.lifecycle.successorCount,
      fallenCount: data.lifecycle.fallenCount,
    } : undefined,
    topLegendEventTypes: data.topLegendEventTypes?.slice(0, 12),
    topMemorySourceEventTypes: data.topMemorySourceEventTypes?.slice(0, 12),
  };
}

function hookSimulationDetails(hook) {
  return {
    selectionReason: hook.selectionReason,
    reportIndex: hook.reportIndex,
    id: hook.id,
    kind: hook.kind,
    tone: hook.tone,
    year: hook.year,
    score: hook.score,
    urgency: hook.urgency,
    prompt: hook.prompt,
    stakes: hook.stakes,
    complication: hook.complication,
    suggestedFocus: hook.suggestedFocus,
    resolvedSeedRefs: hook.resolvedSeedRefs,
    resolvedEvents: hook.resolvedEvents,
    rawSeedRefs: hook.seedRefs,
    rawEventIds: hook.eventIds,
  };
}

function promptForHook(hook, data) {
  return `Evaluate this generated fantasy-world story hook as a writing prompt seed.

World simulation details:
${JSON.stringify(worldSimulationDetails(data), null, 2)}

Story hook with resolved simulation context:
${JSON.stringify(hookSimulationDetails(hook), null, 2)}

Return only valid JSON matching this shape:
{
  "writingPromptSummary": "1-2 sentence summary of the playable writing prompt.",
  "grade": "A, B, C, D, or F with optional +/-",
  "scores": {
    "premiseClarity": 1,
    "dramaticTension": 1,
    "specificity": 1,
    "worldGrounding": 1,
    "characterAgency": 1,
    "freshness": 1,
    "campaignUsability": 1,
    "overall": 1
  },
  "verdict": "Short direct verdict.",
  "strengths": ["three concise strengths"],
  "risks": ["three concise risks or weak spots"],
  "improvements": ["three concrete revision ideas"],
  "revisedWritingPrompt": "One paragraph revised writing prompt."
}

Use integer scores from 1 to 10. Prefer concrete, actionable criticism over praise.
The report card must use the simulation data directly. Mention specific people, factions, artifacts, conflicts, prophecies, counts, refs, or event ids when they matter.
Use resolvedSeedRefs and resolvedEvents as the primary context. rawSeedRefs and rawEventIds are traceability only.
Do not invent facts outside the supplied simulation details, but you may infer writing potential from the supplied details.`;
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

function normalizeReportCard(raw, hook) {
  const scores = raw.scores && typeof raw.scores === "object" ? raw.scores : {};
  const normalizedScores = {};
  for (const key of ["premiseClarity", "dramaticTension", "specificity", "worldGrounding", "characterAgency", "freshness", "campaignUsability", "overall"]) {
    const value = Math.round(Number(scores[key]));
    normalizedScores[key] = Number.isFinite(value) ? Math.max(1, Math.min(10, value)) : 5;
  }
  return {
    writingPromptSummary: String(raw.writingPromptSummary || hook.prompt || hook.name),
    grade: String(raw.grade || "C"),
    scores: normalizedScores,
    verdict: String(raw.verdict || "Needs more evaluation."),
    strengths: normalizeStringArray(raw.strengths, ["Specific world details are present."]),
    risks: normalizeStringArray(raw.risks, ["The hook may need sharper player-facing stakes."]),
    improvements: normalizeStringArray(raw.improvements, ["Clarify the immediate decision point."]),
    revisedWritingPrompt: String(raw.revisedWritingPrompt || hook.prompt || hook.name),
  };
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const strings = value.map(item => String(item).trim()).filter(Boolean);
  return strings.length ? strings : fallback;
}

function mockReportCard(hook) {
  const tension = Math.max(1, Math.min(10, Math.round((hook.urgency ?? 0.5) * 7 + 3)));
  const specificity = Math.max(1, Math.min(10, Math.round((hook.resolvedSeedRefs?.length ?? hook.seedRefs?.length ?? 0) / 2 + 4)));
  const worldGrounding = Math.max(1, Math.min(10, Math.round((hook.resolvedEvents?.length ?? hook.eventIds?.length ?? 0) / 2 + 5)));
  const agency = hook.kind === "relationship" || hook.kind === "character" ? 8 : hook.kind === "artifact" ? 7 : 6;
  const freshness = hook.kind === "artifact" || hook.kind === "prophecy" ? 8 : 6;
  const clarity = hook.prompt && hook.stakes ? 8 : 5;
  const usability = Math.round((clarity + tension + specificity + agency) / 4);
  const overall = Math.round((clarity + tension + specificity + worldGrounding + agency + freshness + usability) / 7);
  return normalizeReportCard({
    writingPromptSummary: `${hook.name} centers on ${hook.prompt || "a generated world hook"} ${hook.stakes ? `The core stakes are: ${hook.stakes}` : ""}`.trim(),
    grade: overall >= 8 ? "A-" : overall >= 7 ? "B" : overall >= 6 ? "C+" : "C",
    scores: {
      premiseClarity: clarity,
      dramaticTension: tension,
      specificity,
      worldGrounding,
      characterAgency: agency,
      freshness,
      campaignUsability: usability,
      overall,
    },
    verdict: `Mock evaluation: strongest as a ${hook.kind} hook when the opening scene gives the involved people a concrete decision.`,
    strengths: [
      "Uses named people, places, or records from the generated world.",
      "Has measurable stakes and enough context to anchor a scene.",
      "Can link outward through refs and event ids for follow-up research.",
    ],
    risks: [
      "May read like archive summary unless converted into an immediate scene.",
      "The player or protagonist decision point may need to be stated more sharply.",
      "Related records can overwhelm the prompt if too many are introduced at once.",
    ],
    improvements: [
      "Open with one visible conflict, demand, or discovery.",
      "Name the person who can act first and what they risk.",
      "Hold some background refs for later reveals instead of front-loading all of them.",
    ],
    revisedWritingPrompt: `${hook.prompt} ${hook.stakes} Start with the most exposed participant being forced to choose between public duty and a private tie, then use the linked records as complications rather than exposition.`.trim(),
  }, hook);
}

async function openRouterReportCard(hook, data, options) {
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
      "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE || "RGBKnights World Map Story Hook Evaluator",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "system",
          content: "You evaluate fantasy-world simulation story hooks as writing prompt seeds. Return only valid JSON.",
        },
        {
          role: "user",
          content: promptForHook(hook, data),
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
    throw new Error(`Could not parse report-card JSON for hook "${hook.name}": ${error.message}\n${outputText.slice(0, 1000)}`);
  }
  return normalizeReportCard(raw, hook);
}

async function evaluateHook(hook, data, options) {
  if (options.provider === "mock") return mockReportCard(hook);
  return openRouterReportCard(hook, data, options);
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function bulletList(values) {
  return values.map(value => `- ${value}`).join("\n");
}

function resolvedSeedRefLine(ref) {
  const prefix = `${ref.kind}:${ref.id}${ref.name ? ` - ${ref.name}` : ""}`;
  const attrs = [
    ref.recordKind,
    ref.status,
    ref.year !== undefined ? `year ${ref.year}` : undefined,
    ref.endedYear !== undefined ? `ended ${ref.endedYear}` : undefined,
  ].filter(Boolean);
  const text = compactText(ref.summary ?? ref.description, 420);
  return `${prefix}${attrs.length ? ` (${attrs.join(", ")})` : ""}${text ? `: ${text}` : ref.missing ? ": missing from input archive" : ""}`;
}

function resolvedEventLine(event) {
  if (event.missing) return `${event.id}: missing from input archive`;
  const headline = compactText(event.headline, 260) ?? "No headline";
  const description = compactText(event.description, 420);
  return `${event.id} year ${event.year ?? "unknown"} ${event.type ?? "event"}: ${headline}${description ? ` - ${description}` : ""}`;
}

function compactJsonBlock(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function cardMarkdown(entry) {
  const {hook, report} = entry;
  return `# ${hook.name}

| Field | Value |
| --- | --- |
| Hook id | ${markdownEscape(hook.id ?? "")} |
| Kind | ${markdownEscape(hook.kind)} |
| Tone | ${markdownEscape(hook.tone)} |
| Year | ${markdownEscape(hook.year ?? "")} |
| Score | ${markdownEscape(hook.score ?? "")} |
| Urgency | ${markdownEscape(hook.urgency ?? "")} |
| Selection | ${markdownEscape(hook.selectionReason)} |
| Grade | ${markdownEscape(report.grade)} |

## Writing Prompt Summary

${report.writingPromptSummary}

## World Simulation Details

These details are copied from the generated simulation profile so the report card can be traced back to the world state that produced the hook.

${compactJsonBlock(entry.worldDetails)}

## Hook Simulation Details

${compactJsonBlock(hookSimulationDetails(hook))}

## Report Card

| Criterion | Score |
| --- | ---: |
| Premise clarity | ${report.scores.premiseClarity}/10 |
| Dramatic tension | ${report.scores.dramaticTension}/10 |
| Specificity | ${report.scores.specificity}/10 |
| World grounding | ${report.scores.worldGrounding}/10 |
| Character agency | ${report.scores.characterAgency}/10 |
| Freshness | ${report.scores.freshness}/10 |
| Campaign usability | ${report.scores.campaignUsability}/10 |
| Overall | ${report.scores.overall}/10 |

## Verdict

${report.verdict}

## Strengths

${bulletList(report.strengths)}

## Risks

${bulletList(report.risks)}

## Improvements

${bulletList(report.improvements)}

## Revised Writing Prompt

${report.revisedWritingPrompt}

## Original Hook

**Prompt:** ${hook.prompt || ""}

**Stakes:** ${hook.stakes || ""}

**Complication:** ${hook.complication || ""}

**Suggested focus:** ${hook.suggestedFocus || ""}

## Resolved Seed Ref Context

${hook.resolvedSeedRefs.length ? bulletList(hook.resolvedSeedRefs.map(resolvedSeedRefLine)) : "- None"}

## Resolved Event Context

${hook.resolvedEvents.length ? bulletList(hook.resolvedEvents.map(resolvedEventLine)) : "- None"}

## Raw Seed Refs

${hook.seedRefs.length ? bulletList(hook.seedRefs.map(ref => `${ref.kind}:${ref.id}${ref.name ? ` - ${ref.name}` : ""}`)) : "- None"}

## Raw Event Ids

${hook.eventIds.length ? bulletList(hook.eventIds.map(id => String(id))) : "- None"}
`;
}

function summaryMarkdown({inputPath, outputDir, options, entries, data}) {
  const byKind = new Map();
  for (const entry of entries) {
    const list = byKind.get(entry.hook.kind) ?? [];
    list.push(entry);
    byKind.set(entry.hook.kind, list);
  }
  const promptSummaries = entries
    .map(entry => `- [${entry.hook.name}](${path.relative(outputDir, entry.cardPath).replace(/\\/g, "/")}): ${entry.report.writingPromptSummary}`)
    .join("\n");
  const tableRows = entries
    .map(entry => `| [${markdownEscape(entry.hook.name)}](${path.relative(outputDir, entry.cardPath).replace(/\\/g, "/")}) | ${markdownEscape(entry.hook.kind)} | ${markdownEscape(entry.report.grade)} | ${entry.report.scores.overall}/10 | ${markdownEscape(entry.hook.selectionReason)} |`)
    .join("\n");
  const kindRows = [...byKind.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([kind, kindEntries]) => `| ${markdownEscape(kind)} | ${kindEntries.length} | ${kindEntries.map(entry => `${entry.report.grade} ${entry.hook.name}`).join("; ")} |`)
    .join("\n");

  return `# Story Hook AI Review Summary

Generated at: ${new Date().toISOString()}

Input: ${inputPath}

Provider: ${options.provider}

Model: ${options.provider === "mock" ? "mock" : options.model}

World year: ${data.year ?? "unknown"}

Hooks evaluated: ${entries.length}

## Hook Report Cards

| Hook | Kind | Grade | Overall | Selection |
| --- | --- | --- | ---: | --- |
${tableRows}

## By Kind

| Kind | Cards | Top cards |
| --- | ---: | --- |
${kindRows}

## Writing Prompt Summaries

${promptSummaries}
`;
}

function indexMarkdown(entries, summaryFile) {
  const rows = entries
    .map(entry => `| [${markdownEscape(entry.hook.name)}](${path.relative(path.dirname(summaryFile), entry.cardPath).replace(/\\/g, "/")}) | ${markdownEscape(entry.hook.kind)} | ${markdownEscape(entry.report.grade)} | ${entry.report.scores.overall}/10 |`)
    .join("\n");
  return `# Story Hook Report Cards

See [summary.md](${path.basename(summaryFile)}) for the writing prompt summary.

| Hook | Kind | Grade | Overall |
| --- | --- | --- | ---: |
${rows}
`;
}

function writeOutputs({inputPath, outputDir, options, entries, data}) {
  if (options.overwrite) removeExistingOutputDir(outputDir);
  const resolvedOutputDir = assertWorkspaceOutputPath(outputDir);
  const cardsDir = path.join(resolvedOutputDir, "cards");
  fs.mkdirSync(cardsDir, {recursive: true});

  const worldDetails = worldSimulationDetails(data);
  for (const entry of entries) {
    entry.worldDetails = worldDetails;
    const filename = `hook-${String(entry.hook.reportIndex).padStart(3, "0")}-${slugify(entry.hook.kind)}-${slugify(entry.hook.name)}.md`;
    entry.cardPath = path.join(cardsDir, filename);
    fs.writeFileSync(entry.cardPath, cardMarkdown(entry), "utf8");
  }

  const summaryPath = path.join(resolvedOutputDir, "summary.md");
  fs.writeFileSync(summaryPath, summaryMarkdown({inputPath, outputDir: resolvedOutputDir, options, entries, data}), "utf8");
  fs.writeFileSync(path.join(resolvedOutputDir, "index.md"), indexMarkdown(entries, summaryPath), "utf8");
  fs.writeFileSync(path.join(resolvedOutputDir, "manifest.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    input: inputPath,
    provider: options.provider,
    model: options.provider === "mock" ? "mock" : options.model,
    mode: options.mode,
    top: options.top,
    perKind: options.perKind,
    hookCount: entries.length,
    cards: entries.map(entry => ({
      hookId: entry.hook.id,
      name: entry.hook.name,
      kind: entry.hook.kind,
      grade: entry.report.grade,
      overall: entry.report.scores.overall,
      file: path.relative(resolvedOutputDir, entry.cardPath).replace(/\\/g, "/"),
      writingPromptSummary: entry.report.writingPromptSummary,
    })),
  }, null, 2), "utf8");

  return {outputDir: resolvedOutputDir, summaryPath, cardsDir};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(options.input);
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const hooks = selectHooks(data, options);
  if (hooks.length === 0) throw new Error("No story hooks were selected for evaluation");

  const entries = [];
  for (const hook of hooks) {
    console.log(`Evaluating ${hook.reportIndex + 1}/${hooks.length}: [${hook.kind}] ${hook.name}`);
    const report = await evaluateHook(hook, data, options);
    entries.push({hook, report});
  }

  const output = writeOutputs({inputPath, outputDir: options.out, options, entries, data});
  console.log(`Wrote ${entries.length} story hook report card${entries.length === 1 ? "" : "s"} to ${output.outputDir}`);
  console.log(`Summary: ${output.summaryPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
