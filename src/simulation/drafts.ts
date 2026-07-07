// Shared pure draft logic used by both the main simulation thread
// (src/simulation/civilizations.ts) and the worker threads
// (src/simulation/civilization-worker.ts).
//
// Everything in this module must stay deterministic and side-effect free:
// the project's determinism contract (same seed => same history; worker
// count => no effect) depends on the main thread and the workers computing
// drafts with exactly the same code. Do not fork per-thread variants of
// these functions again; edit them here.

import {clamp} from "../mapgen/geometry.ts";

export type AgentProfession = "child" | "farmer" | "miner" | "artisan" | "merchant" | "guard" | "healer" | "scholar" | "elder";

export type AgentTrait = "brave" | "cautious" | "ambitious" | "patient" | "restless" | "generous" | "proud" | "curious" | "stern" | "gregarious" | "melancholy" | "dutiful";

export type AgentValue = "family" | "craft" | "wealth" | "faith" | "law" | "knowledge" | "honor" | "comfort" | "power" | "community";

export type AgentSpecialty = "farming" | "mining" | "stonework" | "trade" | "warfare" | "medicine" | "lore" | "law" | "ritual" | "leadership" | "crafting";

export type AgentMentalState = "inspired" | "steady" | "strained" | "troubled" | "haunted";

export type AgentNeedKind = "social" | "rest" | "craft" | "training" | "learning" | "faith" | "family" | "justice" | "wealth" | "comfort" | "legacy" | "health" | "play";

export type AgentNeedState = {
    kind: AgentNeedKind;
    name: string;
    urgency: number;
    satisfaction: number;
    lastSatisfiedYear?: number;
    lastActivityId?: number;
    lastCeremonyId?: number;
    lastThoughtId?: number;
    sourceMemoryId?: number;
    sourcePersonalityShiftId?: number;
    sourcePreferenceId?: number;
    sourceTraditionId?: number;
    description: string;
};

export type AgentSeedAgePlan = {
    age: number;
    index: number;
};

export type InitialAgentDraft = {
    id: number;
    name: string;
    profession: AgentProfession;
    health: number;
    morale: number;
    stress: number;
    resilience: number;
    mentalState: AgentMentalState;
    needStates: AgentNeedState[];
    wealth: number;
    skill: number;
    traits: AgentTrait[];
    values: AgentValue[];
    specialties: AgentSpecialty[];
    reputation: number;
};

export type ProfessionCounts = Record<AgentProfession, number>;

export type AnnualAgentProfessionInput = {
    agentId: number;
    age: number;
    profession: AgentProfession;
    settlementId: number;
    settlementType: "capital" | "town";
    suitability: number;
};

export type AnnualAgentProfessionDraft = {
    agentId: number;
    age: number;
    profession: AgentProfession;
};

export type SettlementAgentSeedPlanRequest = {
    settlementId: number;
    targetPopulation: number;
    firstAgentId: number;
    civilizationId: number;
    type: "capital" | "town";
    suitability: number;
    prosperity: number;
    unrest: number;
};

export type SettlementAgentSeedPlan = {
    settlementId: number;
    adultPlans: AgentSeedAgePlan[];
    childPlans: AgentSeedAgePlan[];
    adultDrafts: InitialAgentDraft[];
    childDrafts: InitialAgentDraft[];
};

export type SettlementSiteWorkerSettlement = {
    civilizationId: number;
    x: number;
    y: number;
};

export type SettlementSiteSelectionCommonInput = {
    year: number;
    seed: number;
    minSettlementDistance: number;
    expansionSearchRadius: number;
    settlementClaimRadius: number;
    topCandidateLimit: number;
    candidateTriangles: Int32Array;
    candidateX: Float32Array;
    candidateY: Float32Array;
    suitability: Float32Array;
    siteBonus: Float32Array;
    territory: Int16Array;
    settlements: SettlementSiteWorkerSettlement[];
};

export type TerrainAnalysisWorkerInput = {
    numTriangles: number;
    numSolidTriangles: number;
    numSides: number;
    minFlow: number;
    triangleNeighbors: Int32Array;
    sideOpposites: Int32Array;
    isBoundaryTriangle: Int8Array;
    elevation: Float32Array;
    moisture: Float32Array;
    flowSides: Float32Array;
};

export type TerrainAnalysisWorkerRange = {
    start: number;
    end: number;
};

export type TerrainAnalysisWorkerResult = {
    start: number;
    suitability: Float32Array;
    siteBonus: Float32Array;
    candidateTriangles: number[];
};

export type RoadPoint = {
    x: number;
    y: number;
};

export type InternalRoadWorkerSettlement = {
    id: number;
    civilizationId: number;
    type: "capital" | "town";
    triangle: number;
    x: number;
    y: number;
    foundedYear: number;
    controlledSinceYear: number;
    population: number;
};

export type InternalRoadWorkerInput = {
    year: number;
    seed: number;
    roadMinSettlementAge: number;
    roadMaturationYears: number;
    numTriangles: number;
    numSolidTriangles: number;
    triangleNeighbors: Int32Array;
    triangleX: Float32Array;
    triangleY: Float32Array;
    isBoundaryTriangle: Int8Array;
    elevation: Float32Array;
    suitability: Float32Array;
    territory: Int16Array;
    settlements: InternalRoadWorkerSettlement[];
};

export type InternalRoadWorkerDraft = {
    civilizationId: number;
    fromSettlementId: number;
    toSettlementId: number;
    openedYear: number;
    strength: number;
    length: number;
    cost: number;
    triangles: number[];
    points: RoadPoint[];
};

export type TriangleTerritoryWorkerInput = {
    numRegions: number;
    numTriangles: number;
    numSolidTriangles: number;
    triangleRegions: Int32Array;
    isBoundaryTriangle: Int8Array;
    elevation: Float32Array;
    territory: Int16Array;
};

export type TriangleTerritoryWorkerRange = {
    start: number;
    end: number;
};

export type TriangleTerritoryWorkerResult = {
    start: number;
    territory: Int16Array;
};

export type SettlementEconomyWorkerSettlement = {
    id: number;
    civilizationId: number;
    food: number;
    materials: number;
    prosperity: number;
    unrest: number;
    agentCount: number;
    foodPotential: number;
    materialPotential: number;
    professions: ProfessionCounts;
};

export type SettlementEconomyDraft = {
    settlementId: number;
    food: number;
    materials: number;
    prosperity: number;
    unrest: number;
    shortage: boolean;
    materialShortage: boolean;
    eventType?: "shortage" | "prosperity";
    eventSeverity?: number;
};

export type MigrationWorkerSettlement = {
    id: number;
    civilizationId: number;
    prosperity: number;
    food: number;
    population: number;
    unrest: number;
};

export type MigrationWorkerAgent = {
    id: number;
    age: number;
    morale: number;
};

export type MigrationWorkerOrigin = {
    settlement: MigrationWorkerSettlement;
    agents: MigrationWorkerAgent[];
};

export type MigrationDraft = {
    settlementId: number;
    destinationSettlementId?: number;
    agentIds: number[];
};

export type BirthCountWorkerSettlement = {
    id: number;
    type: "capital" | "town";
    population: number;
    suitability: number;
    prosperity: number;
    unrest: number;
    adultCount: number;
};

export type BirthCountDraft = {
    settlementId: number;
    count: number;
};

export type BirthParentWorkerAgent = {
    id: number;
    civilizationId: number;
    settlementId: number;
    age: number;
    spouseId?: number;
    alive: boolean;
    childCount: number;
};

export type BirthParentWorkerSettlement = {
    id: number;
    civilizationId: number;
    count: number;
    agents: BirthParentWorkerAgent[];
};

export type BirthParentDraft = {
    settlementId: number;
    parentIds: number[][];
};

export type HouseholdPairWorkerAgent = {
    id: number;
    civilizationId: number;
    settlementId: number;
    age: number;
    spouseId?: number;
    alive: boolean;
};

export type HouseholdPairWorkerSettlement = {
    id: number;
    civilizationId: number;
    prosperity: number;
    unrest: number;
};

export type HouseholdPairWorkerInput = {
    settlement: HouseholdPairWorkerSettlement;
    agents: HouseholdPairWorkerAgent[];
};

export type HouseholdPairDraft = {
    settlementId: number;
    pairs: Array<[number, number]>;
};

export const NAME_PREFIXES = ["Ar", "Bel", "Cor", "Dor", "El", "Fen", "Gal", "Har", "Il", "Jun", "Kel", "Lor", "Mar", "Nor", "Or", "Pel", "Qua", "Riv", "Sar", "Tor", "Ul", "Val"];
export const NAME_SUFFIXES = ["adia", "ara", "drim", "dun", "eria", "helm", "ia", "mere", "ora", "ovar", "port", "reach", "stead", "ton", "vale", "watch"];
export const AGENT_GIVEN_NAMES = [
    "Adan", "Bera", "Corin", "Dala", "Eris", "Fenn", "Garin", "Hara", "Ilan", "Jora", "Kell", "Lysa",
    "Mara", "Nerin", "Orin", "Pela", "Quin", "Riva", "Saren", "Tovin", "Una", "Vara",
    "Alba", "Aldo", "Arno", "Beda", "Bram", "Brenna", "Cade", "Caspar", "Cira", "Dell", "Doria", "Dorn",
    "Edran", "Elsa", "Ewan", "Fara", "Fiora", "Finn", "Gala", "Gideon", "Gorm", "Hale", "Hesta", "Hollis",
    "Ines", "Isla", "Ivo", "Jarek", "Jasper", "Jessa", "Kai", "Kestrel", "Kira", "Lark", "Lorn", "Luca",
    "Marek", "Mira", "Moss", "Nash", "Neva", "Nola", "Odo", "Ora", "Osric", "Petra", "Piera", "Pryn",
    "Quill", "Rane", "Rolf", "Rosa", "Sable", "Sela", "Sorn", "Talan", "Tessa", "Tilda", "Ulf", "Uma",
    "Vance", "Vesna", "Wick", "Wren", "Yorik", "Ysolt", "Zane", "Zora",
];
// Person family names draw from their own pools so expanding person naming does
// not rename settlements, structures, artifacts, or other place-styled records
// that share NAME_PREFIXES/NAME_SUFFIXES.
export const AGENT_FAMILY_PREFIXES = [
    ...NAME_PREFIXES,
    "Ash", "Bram", "Cald", "Dren", "Ever", "Fal", "Grim", "Hol", "Ing", "Jasp", "Kord", "Lang",
    "Mor", "Nyr", "Ost", "Pyre", "Quil", "Rud", "Stane", "Thal", "Ulm", "Vor", "Wend", "Yar", "Zel", "Bright",
];
export const AGENT_FAMILY_SUFFIXES = [
    ...NAME_SUFFIXES,
    "bark", "born", "brook", "crest", "dale", "fell", "field", "ford", "gate", "glen", "hall",
    "haven", "hill", "hold", "marsh", "moor", "ridge", "shore", "stone", "wick", "wold", "wood",
];
export const AGENT_TRAITS: AgentTrait[] = ["brave", "cautious", "ambitious", "patient", "restless", "generous", "proud", "curious", "stern", "gregarious", "melancholy", "dutiful"];
export const AGENT_VALUES: AgentValue[] = ["family", "craft", "wealth", "faith", "law", "knowledge", "honor", "comfort", "power", "community"];
export const AGENT_SPECIALTIES: AgentSpecialty[] = ["farming", "mining", "stonework", "trade", "warfare", "medicine", "lore", "law", "ritual", "leadership", "crafting"];

export function hashFloat(seed: number, a: number, b: number, c: number): number {
    let h = seed >>> 0;
    h = Math.imul(h ^ a, 2246822519);
    h = Math.imul(h ^ b, 3266489917);
    h = Math.imul(h ^ c, 668265263);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export function makeAgentName(seed: number, index: number, familyName?: string): string {
    const given = AGENT_GIVEN_NAMES[Math.floor(hashFloat(seed, index, 211, 1) * AGENT_GIVEN_NAMES.length)];
    const family = familyName ?? AGENT_FAMILY_PREFIXES[Math.floor(hashFloat(seed, index, 211, 2) * AGENT_FAMILY_PREFIXES.length)]
        + AGENT_FAMILY_SUFFIXES[Math.floor(hashFloat(seed, index, 211, 3) * AGENT_FAMILY_SUFFIXES.length)];
    return `${given} ${family}`;
}

export function uniqueChoices<T>(choices: T[], seed: number, id: number, salt: number, count: number): T[] {
    const ranked = choices
        .map((choice, index) => ({choice, score: hashFloat(seed, id, salt, index)}))
        .sort((a, b) => a.score - b.score);
    return ranked.slice(0, Math.min(count, ranked.length)).map(entry => entry.choice);
}

export function specialtiesForProfession(profession: AgentProfession): AgentSpecialty[] {
    if (profession === "farmer") return ["farming"];
    if (profession === "miner") return ["mining", "stonework"];
    if (profession === "artisan") return ["crafting", "stonework"];
    if (profession === "merchant") return ["trade"];
    if (profession === "guard") return ["warfare"];
    if (profession === "healer") return ["medicine", "ritual"];
    if (profession === "scholar") return ["lore", "law"];
    if (profession === "elder") return ["leadership"];
    return [];
}

export function chooseAdultProfession(seed: number, agentId: number, settlement: {id: number; type: "capital" | "town"}, terrainScore: number): AgentProfession {
    const roll = hashFloat(seed, agentId, settlement.id, 503);
    const mountainBias = clamp((terrainScore - 0.35) / 0.45, 0, 1);
    const capitalBias = settlement.type === "capital" ? 0.08 : 0;
    const farmerCutoff = 0.42 - mountainBias * 0.16;
    const minerCutoff = farmerCutoff + 0.12 + mountainBias * 0.16;
    const artisanCutoff = minerCutoff + 0.15 + capitalBias;
    const merchantCutoff = artisanCutoff + 0.08 + capitalBias;
    const guardCutoff = merchantCutoff + 0.08;
    const healerCutoff = guardCutoff + 0.04;

    if (roll < farmerCutoff) return "farmer";
    if (roll < minerCutoff) return "miner";
    if (roll < artisanCutoff) return "artisan";
    if (roll < merchantCutoff) return "merchant";
    if (roll < guardCutoff) return "guard";
    if (roll < healerCutoff) return "healer";
    return "scholar";
}

export function computeAnnualAgentProfessionDraft(seed: number, input: AnnualAgentProfessionInput): AnnualAgentProfessionDraft {
    const age = input.age + 1;
    let profession = input.profession;
    if (age < 15) {
        profession = "child";
    } else if (age >= 65) {
        profession = "elder";
    } else if (profession === "child" || profession === "elder") {
        profession = chooseAdultProfession(seed, input.agentId, {id: input.settlementId, type: input.settlementType}, input.suitability);
    }
    return {agentId: input.agentId, age, profession};
}

export function initialAgentTraits(seed: number, id: number): AgentTrait[] {
    return uniqueChoices(AGENT_TRAITS, seed, id, 227, 2 + Math.floor(hashFloat(seed, id, 227, 99) * 2));
}

export function initialAgentValues(seed: number, id: number, profession: AgentProfession): AgentValue[] {
    const values = uniqueChoices(AGENT_VALUES, seed, id, 229, 2);
    if ((profession === "healer" || profession === "scholar") && !values.includes("knowledge")) values[values.length - 1] = "knowledge";
    if (profession === "merchant" && !values.includes("wealth")) values[values.length - 1] = "wealth";
    if (profession === "guard" && !values.includes("honor")) values[values.length - 1] = "honor";
    if (profession === "child" && !values.includes("family")) values[values.length - 1] = "family";
    return values;
}

export function initialAgentSpecialties(seed: number, id: number, profession: AgentProfession): AgentSpecialty[] {
    const professionSpecialties = specialtiesForProfession(profession);
    const fallback = uniqueChoices(AGENT_SPECIALTIES, seed, id, 233, 1);
    const combined = [...professionSpecialties, ...fallback];
    return combined.filter((specialty, index) => combined.indexOf(specialty) === index).slice(0, 3);
}

export function needName(kind: AgentNeedKind): string {
    if (kind === "social") return "companionship";
    if (kind === "rest") return "rest";
    if (kind === "craft") return "craft";
    if (kind === "training") return "training";
    if (kind === "learning") return "learning";
    if (kind === "faith") return "faith";
    if (kind === "family") return "family";
    if (kind === "justice") return "justice";
    if (kind === "wealth") return "wealth";
    if (kind === "comfort") return "comfort";
    if (kind === "legacy") return "legacy";
    if (kind === "health") return "health";
    return "play";
}

export function needKindForValue(value: AgentValue): AgentNeedKind {
    if (value === "family") return "family";
    if (value === "craft") return "craft";
    if (value === "wealth") return "wealth";
    if (value === "faith") return "faith";
    if (value === "law") return "justice";
    if (value === "knowledge") return "learning";
    if (value === "honor") return "legacy";
    if (value === "comfort") return "comfort";
    if (value === "power") return "legacy";
    return "social";
}

export function needKindForProfession(profession: AgentProfession): AgentNeedKind {
    if (profession === "artisan" || profession === "miner" || profession === "farmer") return "craft";
    if (profession === "merchant") return "wealth";
    if (profession === "guard") return "training";
    if (profession === "healer") return "health";
    if (profession === "scholar") return "learning";
    if (profession === "elder") return "legacy";
    return "play";
}

export function initialAgentNeeds(seed: number, id: number, profession: AgentProfession, traits: AgentTrait[], values: AgentValue[]): AgentNeedState[] {
    const kinds: AgentNeedKind[] = profession === "child"
        ? ["play", "family", "learning"]
        : [
            needKindForProfession(profession),
            ...values.map(needKindForValue),
            ...(traits.includes("gregarious") ? ["social" as AgentNeedKind] : []),
            ...(traits.includes("restless") ? ["training" as AgentNeedKind] : []),
            ...(traits.includes("melancholy") ? ["comfort" as AgentNeedKind] : []),
            ...(traits.includes("dutiful") ? ["justice" as AgentNeedKind] : []),
            "rest",
        ];
    const uniqueKinds = kinds.filter((kind, index) => kinds.indexOf(kind) === index).slice(0, 4);
    return uniqueKinds.map((kind, index) => {
        const urgency = Math.round((0.18 + hashFloat(seed, id, 361 + index, 1) * 0.34) * 1000) / 1000;
        const satisfaction = Math.round((0.46 + hashFloat(seed, id, 361 + index, 2) * 0.32) * 1000) / 1000;
        return {
            kind,
            name: needName(kind),
            urgency,
            satisfaction,
            description: `${needName(kind)} matters to this person.`,
        };
    });
}

export function initialAgentResilience(traits: AgentTrait[], values: AgentValue[], seed: number, id: number): number {
    let resilience = 0.42 + hashFloat(seed, id, 239, 1) * 0.28;
    if (traits.includes("brave")) resilience += 0.08;
    if (traits.includes("patient")) resilience += 0.07;
    if (traits.includes("dutiful")) resilience += 0.05;
    if (traits.includes("gregarious")) resilience += 0.04;
    if (traits.includes("cautious")) resilience += 0.03;
    if (traits.includes("melancholy")) resilience -= 0.08;
    if (traits.includes("restless")) resilience -= 0.04;
    if (values.includes("family")) resilience += 0.03;
    if (values.includes("faith")) resilience += 0.03;
    if (values.includes("community")) resilience += 0.03;
    if (values.includes("comfort")) resilience += 0.02;
    return Math.round(clamp(resilience, 0.12, 0.92) * 1000) / 1000;
}

export function mentalStateFor(stress: number, morale: number): AgentMentalState {
    if (stress <= 0.22 && morale >= 0.72) return "inspired";
    if (stress < 0.42) return "steady";
    if (stress < 0.64) return "strained";
    if (stress < 0.82) return "troubled";
    return "haunted";
}

export function buildInitialAgentDraft(
    seed: number,
    settlement: {id: number; type: "capital" | "town"; suitability: number; prosperity: number; unrest: number},
    id: number,
    age: number,
    profession?: AgentProfession,
): InitialAgentDraft {
    const assignedProfession = profession
        ?? (age < 15 ? "child" : age >= 65 ? "elder" : chooseAdultProfession(seed, id, settlement, settlement.suitability));
    const traits = initialAgentTraits(seed, id);
    const values = initialAgentValues(seed, id, assignedProfession);
    const morale = clamp(0.58 + settlement.suitability * 0.25 + hashFloat(seed, id, 307, 2) * 0.17, 0, 1);
    const stress = clamp(
        0.12
        + (traits.includes("melancholy") ? 0.08 : 0)
        + (traits.includes("restless") ? 0.04 : 0)
        - (traits.includes("patient") ? 0.03 : 0)
        - settlement.prosperity * 0.04
        + settlement.unrest * 0.08,
        0,
        1,
    );
    const resilience = initialAgentResilience(traits, values, seed, id);
    return {
        id,
        name: makeAgentName(seed, id),
        profession: assignedProfession,
        health: clamp(0.72 + hashFloat(seed, id, 307, 1) * 0.28, 0, 1),
        morale,
        stress,
        resilience,
        mentalState: mentalStateFor(stress, morale),
        needStates: initialAgentNeeds(seed, id, assignedProfession, traits, values),
        wealth: Math.round((6 + hashFloat(seed, id, 307, 3) * 16) * 100) / 100,
        skill: clamp(0.2 + age / 90 + hashFloat(seed, id, 307, 4) * 0.25, 0, 1),
        traits,
        values,
        specialties: initialAgentSpecialties(seed, id, assignedProfession),
        reputation: Math.round(clamp(0.03 + (age >= 18 ? age / 120 : 0) + hashFloat(seed, id, 307, 5) * 0.08, 0, 1) * 1000) / 1000,
    };
}

export function buildSettlementAgentSeedPlan(seed: number, request: SettlementAgentSeedPlanRequest): SettlementAgentSeedPlan {
    const adultPlans: AgentSeedAgePlan[] = [];
    const childPlans: AgentSeedAgePlan[] = [];
    for (let i = 0; i < request.targetPopulation; i++) {
        const roll = hashFloat(seed, request.settlementId, i, 419);
        let age: number;
        if (roll < 0.24) age = Math.floor(hashFloat(seed, request.settlementId, i, 421) * 15);
        else if (roll < 0.82) age = 15 + Math.floor(hashFloat(seed, request.settlementId, i, 422) * 35);
        else age = 50 + Math.floor(hashFloat(seed, request.settlementId, i, 423) * 35);
        if (age < 15) childPlans.push({age, index: i});
        else adultPlans.push({age, index: i});
    }

    adultPlans.sort((a, b) => b.age - a.age || a.index - b.index);
    childPlans.sort((a, b) => b.age - a.age || a.index - b.index);
    const settlement = {
        id: request.settlementId,
        type: request.type,
        suitability: request.suitability,
        prosperity: request.prosperity,
        unrest: request.unrest,
    };
    const adultDrafts = adultPlans.map((plan, index) => buildInitialAgentDraft(
        seed,
        settlement,
        request.firstAgentId + index,
        plan.age,
    ));
    const firstChildAgentId = request.firstAgentId + adultPlans.length;
    const childDrafts = childPlans.map((plan, index) => buildInitialAgentDraft(
        seed,
        settlement,
        firstChildAgentId + index,
        plan.age,
        "child",
    ));
    return {settlementId: request.settlementId, adultPlans, childPlans, adultDrafts, childDrafts};
}

export function computeSettlementEconomyDraft(seed: number, year: number, input: SettlementEconomyWorkerSettlement): SettlementEconomyDraft {
    const professions = input.professions;
    const workers = Math.max(1, input.agentCount - professions.child - professions.elder);
    const foodProduced = Math.round(
        (professions.farmer * 2.95 + professions.merchant * 0.45 + professions.child * 0.12)
        * input.foodPotential,
    );
    const materialsProduced = Math.round(
        (professions.miner * 1.65 + professions.artisan * 0.65 + professions.farmer * 0.08)
        * input.materialPotential,
    );
    const tradeProduced = professions.merchant * 0.85 + professions.artisan * 0.38 + professions.scholar * 0.18;
    const foodNeeded = Math.round(input.agentCount * 0.54);
    const materialNeeded = Math.round(workers * 0.11 + input.agentCount * 0.015);
    const foodDelta = foodProduced - foodNeeded;
    const materialDelta = materialsProduced - materialNeeded;
    const food = clamp(input.food + foodDelta, 0, Math.max(650, input.agentCount * 4));
    const materials = clamp(input.materials + materialDelta, 0, Math.max(200, input.agentCount * 2));
    const shortage = foodDelta < 0 && food < input.agentCount * 0.24;
    const materialShortage = materialDelta < 0 && materials < input.agentCount * 0.15;
    const prosperity = clamp(
        input.prosperity
        + tradeProduced / Math.max(80, input.agentCount * 8)
        + (foodDelta > 0 ? 0.01 : -0.012)
        + (materialDelta > 0 ? 0.006 : -0.006),
        0,
        1,
    );
    const unrest = clamp(
        input.unrest
        + (shortage ? 0.045 : -0.024)
        + (materialShortage ? 0.025 : -0.006)
        - prosperity * 0.01,
        0,
        1,
    );
    const eventType = shortage
        ? "shortage"
        : prosperity > 0.78 && hashFloat(seed, year, input.id, 601) > 0.88
            ? "prosperity"
            : undefined;
    return {
        settlementId: input.id,
        food,
        materials,
        prosperity,
        unrest,
        shortage,
        materialShortage,
        eventType,
        eventSeverity: eventType === "shortage"
            ? clamp(0.35 + unrest, 0, 1)
            : eventType === "prosperity"
                ? prosperity
                : undefined,
    };
}

export function computeMigrationDraft(settlements: MigrationWorkerSettlement[], origin: MigrationWorkerOrigin): MigrationDraft {
    const settlement = origin.settlement;
    if (settlement.unrest < 0.32 && settlement.food > settlement.population * 0.45) {
        return {settlementId: settlement.id, agentIds: []};
    }

    const destinations = settlements
        .filter(candidate =>
            candidate.civilizationId === settlement.civilizationId
            && candidate.id !== settlement.id
            && candidate.prosperity > settlement.prosperity
            && candidate.food > candidate.population * 0.6
        )
        .sort((a, b) => b.prosperity - a.prosperity || a.id - b.id);
    if (destinations.length === 0) return {settlementId: settlement.id, agentIds: []};

    const destination = destinations[0];
    const candidates = origin.agents
        .filter(agent => agent.age >= 16 && agent.age <= 46)
        .sort((a, b) => a.morale - b.morale || a.id - b.id);
    const moveCount = Math.min(candidates.length, Math.max(0, Math.floor(settlement.population * (0.004 + settlement.unrest * 0.018))));
    return {
        settlementId: settlement.id,
        destinationSettlementId: moveCount > 0 ? destination.id : undefined,
        agentIds: candidates.slice(0, moveCount).map(agent => agent.id),
    };
}

export function computeBirthCountDraft(seed: number, year: number, input: BirthCountWorkerSettlement): BirthCountDraft {
    if (input.adultCount === 0) return {settlementId: input.id, count: 0};
    const base = input.type === "capital" ? 850 : 180;
    const multiplier = 0.7 + input.suitability * 0.5 + input.prosperity * 0.2 - input.unrest * 0.2;
    const capacity = Math.max(18, Math.round(base * clamp(multiplier, 0.35, 1.35)));
    const recovery = clamp((capacity - input.population) / capacity, 0, 1);
    const crowding = clamp((input.population - capacity) / capacity, 0, 1);
    const fertility = 0.032 + input.prosperity * 0.018 + input.suitability * 0.012 - input.unrest * 0.018 + recovery * 0.025 - crowding * 0.05;
    const expected = Math.max(0, input.adultCount * fertility);
    const whole = Math.floor(expected);
    const fractional = expected - whole;
    return {
        settlementId: input.id,
        count: whole + (hashFloat(seed, year, input.id, 613) < fractional ? 1 : 0),
    };
}

export function computeBirthParentDraft(seed: number, year: number, input: BirthParentWorkerSettlement): BirthParentDraft {
    const childCounts = new Map(input.agents.map(agent => [agent.id, agent.childCount]));
    const parentIds: number[][] = [];

    for (let ordinal = 0; ordinal < input.count; ordinal++) {
        const adults = input.agents
            .filter(agent =>
                agent.alive
                && agent.civilizationId === input.civilizationId
                && agent.settlementId === input.id
                && agent.age >= 18
                && agent.age <= 52
            );
        if (adults.length === 0) {
            parentIds.push([]);
            continue;
        }

        const adultIds = new Set(adults.map(agent => agent.id));
        const pairs = adults
            .filter(agent => agent.spouseId !== undefined && agent.id < agent.spouseId && adultIds.has(agent.spouseId))
            .sort((a, b) =>
                ((childCounts.get(a.id) ?? 0) + (childCounts.get(a.spouseId!) ?? 0))
                - ((childCounts.get(b.id) ?? 0) + (childCounts.get(b.spouseId!) ?? 0))
                || hashFloat(seed, year + ordinal * 997, input.id, a.id)
                - hashFloat(seed, year + ordinal * 997, input.id, b.id)
            );

        let chosen: number[];
        if (pairs.length > 0) {
            const pair = pairs[Math.floor(hashFloat(seed, year, input.id, ordinal + 811) * Math.min(4, pairs.length))];
            chosen = [pair.id, pair.spouseId!];
        } else {
            chosen = adults
                .sort((a, b) =>
                    (childCounts.get(a.id) ?? 0) - (childCounts.get(b.id) ?? 0)
                    || hashFloat(seed, year + ordinal * 997, input.id, a.id)
                    - hashFloat(seed, year + ordinal * 997, input.id, b.id)
                )
                .slice(0, Math.min(2, adults.length))
                .map(agent => agent.id);
        }

        parentIds.push(chosen);
        for (let parentId of chosen) {
            childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
        }
    }

    return {settlementId: input.id, parentIds};
}

export function computeHouseholdPairDraft(seed: number, year: number, input: HouseholdPairWorkerInput): HouseholdPairDraft {
    if (year <= 0) return {settlementId: input.settlement.id, pairs: []};
    const adultCount = input.agents.filter(agent =>
        agent.alive
        && agent.spouseId === undefined
        && agent.age >= 18
        && agent.age <= 42
    ).length;
    if (adultCount < 2) return {settlementId: input.settlement.id, pairs: []};

    const chance = clamp(0.02 + input.settlement.prosperity * 0.05 - input.settlement.unrest * 0.035, 0.005, 0.08);
    const maxPairs = Math.max(0, Math.floor(adultCount * (0.003 + input.settlement.prosperity * 0.004)));
    if (maxPairs <= 0 || chance <= 0) return {settlementId: input.settlement.id, pairs: []};

    const candidates = input.agents
        .filter(agent =>
            agent.alive
            && agent.spouseId === undefined
            && agent.civilizationId === input.settlement.civilizationId
            && agent.settlementId === input.settlement.id
            && agent.age >= 18
            && agent.age <= 42
        )
        .sort((a, b) =>
            hashFloat(seed, year, input.settlement.id, a.id)
            - hashFloat(seed, year, input.settlement.id, b.id)
            || a.id - b.id
        );

    const pairs: Array<[number, number]> = [];
    for (let i = 0; i + 1 < candidates.length && pairs.length < maxPairs; i += 2) {
        const a = candidates[i];
        const b = candidates[i + 1];
        if (hashFloat(seed, year + 823, a.id, b.id) > chance) continue;
        pairs.push([a.id, b.id]);
    }
    return {settlementId: input.settlement.id, pairs};
}

export function computeTriangleTerritoryRange(input: TriangleTerritoryWorkerInput & TriangleTerritoryWorkerRange): TriangleTerritoryWorkerResult {
    const territory = new Int16Array(input.end - input.start);
    territory.fill(-1);
    const counts = new Map<number, number>();

    for (let t = input.start; t < input.end; t++) {
        if (input.isBoundaryTriangle[t] || input.elevation[t] < 0) continue;

        let bestOwner = -1;
        let bestCount = 0;
        counts.clear();
        for (let i = 0; i < 3; i++) {
            const region = input.triangleRegions[3*t + i];
            if (region < 0 || region >= input.numRegions) continue;
            const owner = input.territory[region];
            if (owner < 0) continue;
            const count = (counts.get(owner) ?? 0) + 1;
            counts.set(owner, count);
            if (count > bestCount) {
                bestOwner = owner;
                bestCount = count;
            }
        }

        territory[t - input.start] = bestOwner;
    }

    return {start: input.start, territory};
}

type RoadQueueItem = {
    triangle: number;
    cost: number;
};

export class RoadQueue {
    private readonly items: RoadQueueItem[] = [];

    get length(): number {
        return this.items.length;
    }

    push(item: RoadQueueItem) {
        this.items.push(item);
        this.bubbleUp(this.items.length - 1);
    }

    pop(): RoadQueueItem | undefined {
        if (this.items.length === 0) return undefined;
        const first = this.items[0];
        const last = this.items.pop()!;
        if (this.items.length > 0) {
            this.items[0] = last;
            this.sinkDown(0);
        }
        return first;
    }

    private bubbleUp(index: number) {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.items[parent].cost <= this.items[index].cost) break;
            [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
            index = parent;
        }
    }

    private sinkDown(index: number) {
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;

            if (left < this.items.length && this.items[left].cost < this.items[smallest].cost) smallest = left;
            if (right < this.items.length && this.items[right].cost < this.items[smallest].cost) smallest = right;
            if (smallest === index) break;

            [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
            index = smallest;
        }
    }
}

function insertTopSettlementCandidateInternal(top: Array<{triangle: number; score: number}>, candidate: {triangle: number; score: number}, limit: number) {
    if (limit <= 0) return;
    if (top.length < limit) {
        top.push(candidate);
    } else if (candidate.score <= top[top.length - 1].score) {
        return;
    } else {
        top[top.length - 1] = candidate;
    }
    top.sort((a, b) => b.score - a.score || a.triangle - b.triangle);
}

export function settlementSiteCandidatesFromInput(input: SettlementSiteSelectionCommonInput, civilizationId: number): number[] {
    const settlements = input.settlements.filter(settlement => settlement.civilizationId === civilizationId);
    if (settlements.length === 0) return [];

    const minDistance2 = input.minSettlementDistance * input.minSettlementDistance;
    const maxDistance2 = input.expansionSearchRadius * input.expansionSearchRadius;
    const closeEnemyDistance2 = input.minSettlementDistance * input.minSettlementDistance * 2.25;
    const claimDistance2 = input.settlementClaimRadius * input.settlementClaimRadius;
    const idealDistance = input.settlementClaimRadius + input.minSettlementDistance * 0.85;
    const top: Array<{triangle: number; score: number}> = [];

    for (let i = 0; i < input.candidateTriangles.length; i++) {
        const triangle = input.candidateTriangles[i];
        const owner = input.territory[triangle] ?? -1;
        if (owner >= 0 && owner !== civilizationId) continue;

        const x = input.candidateX[i];
        const y = input.candidateY[i];
        let nearestSameDistance2 = Number.POSITIVE_INFINITY;
        for (let settlement of settlements) {
            const dx = settlement.x - x;
            const dy = settlement.y - y;
            nearestSameDistance2 = Math.min(nearestSameDistance2, dx*dx + dy*dy);
        }
        if (nearestSameDistance2 < minDistance2 || nearestSameDistance2 > maxDistance2) continue;

        let enemyPressure = 0;
        for (let settlement of input.settlements) {
            if (settlement.civilizationId === civilizationId) continue;
            const dx = settlement.x - x;
            const dy = settlement.y - y;
            const distance2 = dx*dx + dy*dy;
            if (distance2 < closeEnemyDistance2) enemyPressure += 0.35;
            else if (distance2 < claimDistance2) enemyPressure += 0.12;
        }

        const distance = Math.sqrt(nearestSameDistance2);
        const distanceScore = 1 - clamp(Math.abs(distance - idealDistance) / Math.max(1, idealDistance), 0, 1);
        const frontierBonus = owner < 0 ? 0.18 : 0.04;
        const jitter = hashFloat(input.seed, civilizationId, input.year, triangle) * 0.04;
        const score = input.suitability[triangle] * 1.25 + input.siteBonus[triangle] + distanceScore * 0.26 + frontierBonus - enemyPressure + jitter;
        insertTopSettlementCandidateInternal(top, {triangle, score}, input.topCandidateLimit);
    }

    return top.map(candidate => candidate.triangle);
}

function terrainHasRiverTriangle(input: TerrainAnalysisWorkerInput, triangle: number): boolean {
    for (let i = 0; i < 3; i++) {
        const side = 3*triangle + i;
        const opposite = input.sideOpposites[side];
        if (
            input.flowSides[side] > input.minFlow
            || opposite >= 0 && opposite < input.numSides && input.flowSides[opposite] > input.minFlow
        ) {
            return true;
        }
    }
    return false;
}

function terrainIsCoastalTriangle(input: TerrainAnalysisWorkerInput, triangle: number): boolean {
    for (let i = 0; i < 3; i++) {
        const neighbor = input.triangleNeighbors[3*triangle + i];
        if (neighbor >= 0 && neighbor < input.numSolidTriangles && input.elevation[neighbor] < 0) return true;
    }
    return false;
}

function terrainSlopePenalty(input: TerrainAnalysisWorkerInput, triangle: number): number {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 3; i++) {
        const neighbor = input.triangleNeighbors[3*triangle + i];
        if (neighbor < 0 || neighbor >= input.numSolidTriangles) continue;
        sum += Math.abs(input.elevation[triangle] - input.elevation[neighbor]);
        count++;
    }
    return count > 0 ? clamp(sum / count / 0.2, 0, 1) : 1;
}

export function computeTerrainAnalysisRange(input: TerrainAnalysisWorkerInput & TerrainAnalysisWorkerRange): TerrainAnalysisWorkerResult {
    const suitability = new Float32Array(input.end - input.start);
    const siteBonus = new Float32Array(input.end - input.start);
    const candidateTriangles: number[] = [];

    for (let triangle = input.start; triangle < input.end; triangle++) {
        const elevation = input.elevation[triangle];
        if (elevation <= 0 || input.isBoundaryTriangle[triangle]) continue;

        const lowland = 1 - clamp(Math.abs(elevation - 0.12) / 0.45, 0, 1);
        const moisture = clamp(input.moisture[triangle] ?? 0, 0, 1.5);
        const moistureScore = 1 - clamp(Math.abs(moisture - 0.55) / 0.8, 0, 1);
        const hasRiver = terrainHasRiverTriangle(input, triangle);
        const isCoastal = terrainIsCoastalTriangle(input, triangle);
        const slopePenalty = terrainSlopePenalty(input, triangle);
        const triangleSuitability = clamp(
            0.18 + lowland * 0.38 + moistureScore * 0.24 + (hasRiver ? 0.18 : 0) + (isCoastal ? 0.08 : 0) - slopePenalty * 0.26,
            0,
            1,
        );
        suitability[triangle - input.start] = triangleSuitability;
        siteBonus[triangle - input.start] = (hasRiver ? 0.08 : 0) + (isCoastal ? 0.04 : 0);
        if (triangleSuitability >= 0.44) candidateTriangles.push(triangle);
    }

    return {start: input.start, suitability, siteBonus, candidateTriangles};
}

export function pointDistance(a: RoadPoint, b: RoadPoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function roadPathLength(points: RoadPoint[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        length += pointDistance(points[i - 1], points[i]);
    }
    return length;
}

export function pointLineDistance(point: RoadPoint, start: RoadPoint, end: RoadPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length2 = dx*dx + dy*dy;
    if (length2 === 0) return pointDistance(point, start);

    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / length2, 0, 1);
    return pointDistance(point, {x: start.x + dx * t, y: start.y + dy * t});
}

export function simplifyRoadPoints(points: RoadPoint[], tolerance: number): RoadPoint[] {
    if (points.length <= 2) return points;

    let maxDistance = -1;
    let splitIndex = -1;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const distance = pointLineDistance(points[i], start, end);
        if (distance > maxDistance) {
            maxDistance = distance;
            splitIndex = i;
        }
    }

    if (maxDistance <= tolerance || splitIndex < 0) return [start, end];

    const left = simplifyRoadPoints(points.slice(0, splitIndex + 1), tolerance);
    const right = simplifyRoadPoints(points.slice(splitIndex), tolerance);
    return left.slice(0, -1).concat(right);
}

function roadInputTrianglePoint(input: InternalRoadWorkerInput, triangle: number): RoadPoint {
    return {
        x: input.triangleX[triangle],
        y: input.triangleY[triangle],
    };
}

function roadInputPassableTriangle(input: InternalRoadWorkerInput, civId: number, triangle: number, endpointTriangles: Set<number>): boolean {
    if (triangle < 0 || triangle >= input.numSolidTriangles || input.isBoundaryTriangle[triangle] || input.elevation[triangle] < 0) return false;
    const owner = input.territory[triangle] ?? -1;
    return endpointTriangles.has(triangle) || owner < 0 || owner === civId;
}

function roadInputStepCost(input: InternalRoadWorkerInput, civId: number, from: number, to: number): number {
    const fromPoint = roadInputTrianglePoint(input, from);
    const toPoint = roadInputTrianglePoint(input, to);
    const distance = pointDistance(fromPoint, toPoint);
    const elevation = Math.max(0, (input.elevation[from] + input.elevation[to]) * 0.5);
    const slope = Math.abs(input.elevation[from] - input.elevation[to]);
    const suitability = (input.suitability[from] + input.suitability[to]) * 0.5;
    const highlandPenalty = Math.max(0, elevation - 0.28) * 6.0;
    const slopePenalty = slope * 12.0;
    const lowSuitabilityPenalty = (1 - clamp(suitability, 0, 1)) * 0.45;
    const jitter = 0.96 + hashFloat(input.seed + 101, civId, from, to) * 0.08;
    return distance * (1 + highlandPenalty + slopePenalty + lowSuitabilityPenalty) * jitter;
}

function findRoadPathFromInput(
    input: InternalRoadWorkerInput,
    civId: number,
    startTriangle: number,
    targetTriangle: number,
): {triangles: number[]; cost: number} | undefined {
    const endpointTriangles = new Set([startTriangle, targetTriangle]);
    if (
        !roadInputPassableTriangle(input, civId, startTriangle, endpointTriangles)
        || !roadInputPassableTriangle(input, civId, targetTriangle, endpointTriangles)
    ) {
        return undefined;
    }

    const costs = new Float64Array(input.numTriangles);
    costs.fill(Number.POSITIVE_INFINITY);
    const previous = new Int32Array(input.numTriangles);
    previous.fill(-1);
    const queue = new RoadQueue();

    costs[startTriangle] = 0;
    queue.push({triangle: startTriangle, cost: 0});

    while (queue.length > 0) {
        const current = queue.pop()!;
        if (Math.abs(current.cost - costs[current.triangle]) > 1e-9) continue;
        if (current.triangle === targetTriangle) {
            const triangles: number[] = [];
            for (let t = targetTriangle; t >= 0; t = previous[t]) {
                triangles.push(t);
                if (t === startTriangle) break;
            }
            triangles.reverse();
            return {triangles, cost: current.cost};
        }

        for (let i = 0; i < 3; i++) {
            const neighbor = input.triangleNeighbors[3*current.triangle + i];
            if (!roadInputPassableTriangle(input, civId, neighbor, endpointTriangles)) continue;
            const nextCost = current.cost + roadInputStepCost(input, civId, current.triangle, neighbor);
            if (nextCost >= costs[neighbor]) continue;
            costs[neighbor] = nextCost;
            previous[neighbor] = current.triangle;
            queue.push({triangle: neighbor, cost: nextCost});
        }
    }

    return undefined;
}

function chooseRoadTargets(settlement: InternalRoadWorkerSettlement, connected: InternalRoadWorkerSettlement[]): InternalRoadWorkerSettlement[] {
    return [...connected].sort((a, b) => {
        const da = Math.hypot(settlement.x - a.x, settlement.y - a.y);
        const db = Math.hypot(settlement.x - b.x, settlement.y - b.y);
        return da - db || a.id - b.id;
    });
}

export function computeInternalRoadsForCivilization(input: InternalRoadWorkerInput, civilizationId: number): InternalRoadWorkerDraft[] {
    const roads: InternalRoadWorkerDraft[] = [];
    const settlements = input.settlements
        .filter(settlement => settlement.civilizationId === civilizationId)
        .filter(settlement => input.year - settlement.controlledSinceYear >= input.roadMinSettlementAge)
        .sort((a, b) => {
            if (a.type !== b.type) return a.type === "capital" ? -1 : 1;
            return a.foundedYear - b.foundedYear || b.population - a.population || a.id - b.id;
        });
    if (settlements.length < 2) return roads;

    const connected: InternalRoadWorkerSettlement[] = [settlements[0]];
    for (let settlement of settlements.slice(1)) {
        const candidates = chooseRoadTargets(settlement, connected);
        let chosen: {settlement: InternalRoadWorkerSettlement; triangles: number[]; cost: number} | undefined;

        for (let target of candidates.slice(0, 4)) {
            const route = findRoadPathFromInput(input, civilizationId, settlement.triangle, target.triangle);
            if (!route) continue;
            if (!chosen || route.cost < chosen.cost) {
                chosen = {settlement: target, triangles: route.triangles, cost: route.cost};
            }
        }

        if (chosen) {
            const rawPoints = chosen.triangles.map(triangle => roadInputTrianglePoint(input, triangle));
            const points = simplifyRoadPoints(rawPoints, 6);
            const openedYear = Math.max(settlement.controlledSinceYear, chosen.settlement.controlledSinceYear) + input.roadMinSettlementAge;
            const strength = clamp((input.year - openedYear) / input.roadMaturationYears, 0.12, 1);
            roads.push({
                civilizationId,
                fromSettlementId: settlement.id,
                toSettlementId: chosen.settlement.id,
                openedYear,
                strength,
                length: roadPathLength(rawPoints),
                cost: chosen.cost,
                triangles: chosen.triangles,
                points,
            });
            connected.push(settlement);
        }
    }

    return roads;
}
