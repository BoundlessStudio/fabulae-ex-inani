import {workerData, type MessagePort} from "node:worker_threads";

type AgentProfession = "child" | "farmer" | "miner" | "artisan" | "merchant" | "guard" | "healer" | "scholar" | "elder";
type AgentTrait = "brave" | "cautious" | "ambitious" | "patient" | "restless" | "generous" | "proud" | "curious" | "stern" | "gregarious" | "melancholy" | "dutiful";
type AgentValue = "family" | "craft" | "wealth" | "faith" | "law" | "knowledge" | "honor" | "comfort" | "power" | "community";
type AgentSpecialty = "farming" | "mining" | "stonework" | "trade" | "warfare" | "medicine" | "lore" | "law" | "ritual" | "leadership" | "crafting";
type AgentMentalState = "inspired" | "steady" | "strained" | "troubled" | "haunted";
type AgentNeedKind = "social" | "rest" | "craft" | "training" | "learning" | "faith" | "family" | "justice" | "wealth" | "comfort" | "legacy" | "health" | "play";

type AgentNeedState = {
    kind: AgentNeedKind;
    name: string;
    urgency: number;
    satisfaction: number;
    description: string;
};

type AgentSeedAgePlan = {
    age: number;
    index: number;
};

type InitialAgentDraft = {
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

type ProfessionCounts = Record<AgentProfession, number>;

type AnnualAgentProfessionInput = {
    agentId: number;
    age: number;
    profession: AgentProfession;
    settlementId: number;
    settlementType: "capital" | "town";
    suitability: number;
};

type AnnualAgentProfessionDraft = {
    agentId: number;
    age: number;
    profession: AgentProfession;
};

type AnnualAgentProfessionTask = {
    type: "annual-agent-profession-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        seed: number;
        agents: AnnualAgentProfessionInput[];
    };
};

type SettlementAgentSeedPlanRequest = {
    settlementId: number;
    targetPopulation: number;
    firstAgentId: number;
    civilizationId: number;
    type: "capital" | "town";
    suitability: number;
    prosperity: number;
    unrest: number;
};

type SettlementAgentSeedPlan = {
    settlementId: number;
    adultPlans: AgentSeedAgePlan[];
    childPlans: AgentSeedAgePlan[];
    adultDrafts: InitialAgentDraft[];
    childDrafts: InitialAgentDraft[];
};

type SettlementAgentSeedPlanTask = {
    type: "settlement-agent-seed-plan-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        seed: number;
        requests: SettlementAgentSeedPlanRequest[];
    };
};

type SettlementSiteWorkerSettlement = {
    civilizationId: number;
    x: number;
    y: number;
};

type SettlementSiteSelectionCommonInput = {
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

type SettlementSiteSelectionTask = {
    type: "settlement-site-selection-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: SettlementSiteSelectionCommonInput & {
        civilizationIds: number[];
    };
};

type TerrainAnalysisWorkerInput = {
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

type TerrainAnalysisWorkerRange = {
    start: number;
    end: number;
};

type TerrainAnalysisWorkerResult = {
    start: number;
    suitability: Float32Array;
    siteBonus: Float32Array;
    candidateTriangles: number[];
};

type TerrainAnalysisTask = {
    type: "terrain-analysis-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: TerrainAnalysisWorkerInput & TerrainAnalysisWorkerRange;
};

type RoadPoint = {
    x: number;
    y: number;
};

type InternalRoadWorkerSettlement = {
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

type InternalRoadWorkerInput = {
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

type InternalRoadDraft = {
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

type TriangleTerritoryWorkerInput = {
    numRegions: number;
    numTriangles: number;
    numSolidTriangles: number;
    triangleRegions: Int32Array;
    isBoundaryTriangle: Int8Array;
    elevation: Float32Array;
    territory: Int16Array;
};

type TriangleTerritoryWorkerRange = {
    start: number;
    end: number;
};

type TriangleTerritoryWorkerResult = {
    start: number;
    territory: Int16Array;
};

type TriangleTerritoryTask = {
    type: "triangle-territory-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: TriangleTerritoryWorkerInput & TriangleTerritoryWorkerRange;
};

type InternalRoadTask = {
    type: "internal-road-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: InternalRoadWorkerInput & {
        civilizationIds: number[];
    };
};

type SettlementEconomyWorkerSettlement = {
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

type SettlementEconomyDraft = {
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

type MigrationWorkerSettlement = {
    id: number;
    civilizationId: number;
    prosperity: number;
    food: number;
    population: number;
    unrest: number;
};

type MigrationWorkerAgent = {
    id: number;
    age: number;
    morale: number;
};

type MigrationWorkerOrigin = {
    settlement: MigrationWorkerSettlement;
    agents: MigrationWorkerAgent[];
};

type MigrationDraft = {
    settlementId: number;
    destinationSettlementId?: number;
    agentIds: number[];
};

type BirthCountWorkerSettlement = {
    id: number;
    type: "capital" | "town";
    population: number;
    suitability: number;
    prosperity: number;
    unrest: number;
    adultCount: number;
};

type BirthCountDraft = {
    settlementId: number;
    count: number;
};

type BirthParentWorkerAgent = {
    id: number;
    civilizationId: number;
    settlementId: number;
    age: number;
    spouseId?: number;
    alive: boolean;
    childCount: number;
};

type BirthParentWorkerSettlement = {
    id: number;
    civilizationId: number;
    count: number;
    agents: BirthParentWorkerAgent[];
};

type BirthParentDraft = {
    settlementId: number;
    parentIds: number[][];
};

type HouseholdPairWorkerAgent = {
    id: number;
    civilizationId: number;
    settlementId: number;
    age: number;
    spouseId?: number;
    alive: boolean;
};

type HouseholdPairWorkerSettlement = {
    id: number;
    civilizationId: number;
    prosperity: number;
    unrest: number;
};

type HouseholdPairWorkerInput = {
    settlement: HouseholdPairWorkerSettlement;
    agents: HouseholdPairWorkerAgent[];
};

type HouseholdPairDraft = {
    settlementId: number;
    pairs: Array<[number, number]>;
};

type SettlementEconomyTask = {
    type: "settlement-economy-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        seed: number;
        year: number;
        settlements: SettlementEconomyWorkerSettlement[];
    };
};

type MigrationTask = {
    type: "migration-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        settlements: MigrationWorkerSettlement[];
        origins: MigrationWorkerOrigin[];
    };
};

type BirthCountTask = {
    type: "birth-count-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        seed: number;
        year: number;
        settlements: BirthCountWorkerSettlement[];
    };
};

type BirthParentTask = {
    type: "birth-parent-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        seed: number;
        year: number;
        settlements: BirthParentWorkerSettlement[];
    };
};

type HouseholdPairTask = {
    type: "household-pair-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        seed: number;
        year: number;
        settlements: HouseholdPairWorkerInput[];
    };
};

type ShutdownTask = {
    type: "shutdown";
    requestId: number;
    signal: SharedArrayBuffer;
};

type WorkerTask = AnnualAgentProfessionTask | SettlementAgentSeedPlanTask | SettlementSiteSelectionTask | TerrainAnalysisTask | InternalRoadTask | TriangleTerritoryTask | SettlementEconomyTask | MigrationTask | BirthCountTask | BirthParentTask | HouseholdPairTask | ShutdownTask;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function hashFloat(seed: number, a: number, b: number, c: number): number {
    let h = seed >>> 0;
    h = Math.imul(h ^ a, 2246822519);
    h = Math.imul(h ^ b, 3266489917);
    h = Math.imul(h ^ c, 668265263);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const NAME_PREFIXES = ["Ar", "Bel", "Cor", "Dor", "El", "Fen", "Gal", "Har", "Il", "Jun", "Kel", "Lor", "Mar", "Nor", "Or", "Pel", "Qua", "Riv", "Sar", "Tor", "Ul", "Val"];
const NAME_SUFFIXES = ["adia", "ara", "drim", "dun", "eria", "helm", "ia", "mere", "ora", "ovar", "port", "reach", "stead", "ton", "vale", "watch"];
const AGENT_GIVEN_NAMES = ["Adan", "Bera", "Corin", "Dala", "Eris", "Fenn", "Garin", "Hara", "Ilan", "Jora", "Kell", "Lysa", "Mara", "Nerin", "Orin", "Pela", "Quin", "Riva", "Saren", "Tovin", "Una", "Vara"];
const AGENT_TRAITS: AgentTrait[] = ["brave", "cautious", "ambitious", "patient", "restless", "generous", "proud", "curious", "stern", "gregarious", "melancholy", "dutiful"];
const AGENT_VALUES: AgentValue[] = ["family", "craft", "wealth", "faith", "law", "knowledge", "honor", "comfort", "power", "community"];
const AGENT_SPECIALTIES: AgentSpecialty[] = ["farming", "mining", "stonework", "trade", "warfare", "medicine", "lore", "law", "ritual", "leadership", "crafting"];

function makeAgentName(seed: number, index: number): string {
    const given = AGENT_GIVEN_NAMES[Math.floor(hashFloat(seed, index, 211, 1) * AGENT_GIVEN_NAMES.length)];
    const family = NAME_PREFIXES[Math.floor(hashFloat(seed, index, 211, 2) * NAME_PREFIXES.length)]
        + NAME_SUFFIXES[Math.floor(hashFloat(seed, index, 211, 3) * NAME_SUFFIXES.length)];
    return `${given} ${family}`;
}

function uniqueChoices<T>(choices: T[], seed: number, id: number, salt: number, count: number): T[] {
    const ranked = choices
        .map((choice, index) => ({choice, score: hashFloat(seed, id, salt, index)}))
        .sort((a, b) => a.score - b.score);
    return ranked.slice(0, Math.min(count, ranked.length)).map(entry => entry.choice);
}

function specialtiesForProfession(profession: AgentProfession): AgentSpecialty[] {
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

function chooseAdultProfession(seed: number, agentId: number, settlement: {id: number; type: "capital" | "town"}, terrainScore: number): AgentProfession {
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

function computeAnnualAgentProfessionDraft(seed: number, input: AnnualAgentProfessionInput): AnnualAgentProfessionDraft {
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

function initialAgentTraits(seed: number, id: number): AgentTrait[] {
    return uniqueChoices(AGENT_TRAITS, seed, id, 227, 2 + Math.floor(hashFloat(seed, id, 227, 99) * 2));
}

function initialAgentValues(seed: number, id: number, profession: AgentProfession): AgentValue[] {
    const values = uniqueChoices(AGENT_VALUES, seed, id, 229, 2);
    if ((profession === "healer" || profession === "scholar") && !values.includes("knowledge")) values[values.length - 1] = "knowledge";
    if (profession === "merchant" && !values.includes("wealth")) values[values.length - 1] = "wealth";
    if (profession === "guard" && !values.includes("honor")) values[values.length - 1] = "honor";
    if (profession === "child" && !values.includes("family")) values[values.length - 1] = "family";
    return values;
}

function initialAgentSpecialties(seed: number, id: number, profession: AgentProfession): AgentSpecialty[] {
    const professionSpecialties = specialtiesForProfession(profession);
    const fallback = uniqueChoices(AGENT_SPECIALTIES, seed, id, 233, 1);
    const combined = [...professionSpecialties, ...fallback];
    return combined.filter((specialty, index) => combined.indexOf(specialty) === index).slice(0, 3);
}

function needName(kind: AgentNeedKind): string {
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

function needKindForValue(value: AgentValue): AgentNeedKind {
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

function needKindForProfession(profession: AgentProfession): AgentNeedKind {
    if (profession === "artisan" || profession === "miner" || profession === "farmer") return "craft";
    if (profession === "merchant") return "wealth";
    if (profession === "guard") return "training";
    if (profession === "healer") return "health";
    if (profession === "scholar") return "learning";
    if (profession === "elder") return "legacy";
    return "play";
}

function initialAgentNeeds(seed: number, id: number, profession: AgentProfession, traits: AgentTrait[], values: AgentValue[]): AgentNeedState[] {
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

function initialAgentResilience(traits: AgentTrait[], values: AgentValue[], seed: number, id: number): number {
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

function mentalStateFor(stress: number, morale: number): AgentMentalState {
    if (stress <= 0.22 && morale >= 0.72) return "inspired";
    if (stress < 0.42) return "steady";
    if (stress < 0.64) return "strained";
    if (stress < 0.82) return "troubled";
    return "haunted";
}

function buildInitialAgentDraft(
    seed: number,
    request: SettlementAgentSeedPlanRequest,
    id: number,
    age: number,
    profession?: AgentProfession,
): InitialAgentDraft {
    const settlement = {id: request.settlementId, type: request.type};
    const assignedProfession = profession
        ?? (age < 15 ? "child" : age >= 65 ? "elder" : chooseAdultProfession(seed, id, settlement, request.suitability));
    const traits = initialAgentTraits(seed, id);
    const values = initialAgentValues(seed, id, assignedProfession);
    const morale = clamp(0.58 + request.suitability * 0.25 + hashFloat(seed, id, 307, 2) * 0.17, 0, 1);
    const stress = clamp(
        0.12
        + (traits.includes("melancholy") ? 0.08 : 0)
        + (traits.includes("restless") ? 0.04 : 0)
        - (traits.includes("patient") ? 0.03 : 0)
        - request.prosperity * 0.04
        + request.unrest * 0.08,
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

function buildSettlementAgentSeedPlan(seed: number, request: SettlementAgentSeedPlanRequest): SettlementAgentSeedPlan {
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
    const adultDrafts = adultPlans.map((plan, index) => buildInitialAgentDraft(seed, request, request.firstAgentId + index, plan.age));
    const firstChildAgentId = request.firstAgentId + adultPlans.length;
    const childDrafts = childPlans.map((plan, index) => buildInitialAgentDraft(
        seed,
        request,
        firstChildAgentId + index,
        plan.age,
        "child",
    ));
    return {settlementId: request.settlementId, adultPlans, childPlans, adultDrafts, childDrafts};
}

function computeSettlementEconomyDraft(seed: number, year: number, input: SettlementEconomyWorkerSettlement): SettlementEconomyDraft {
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

function computeMigrationDraft(settlements: MigrationWorkerSettlement[], origin: MigrationWorkerOrigin): MigrationDraft {
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

function computeBirthCountDraft(seed: number, year: number, input: BirthCountWorkerSettlement): BirthCountDraft {
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

function computeBirthParentDraft(seed: number, year: number, input: BirthParentWorkerSettlement): BirthParentDraft {
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

function computeHouseholdPairDraft(seed: number, year: number, input: HouseholdPairWorkerInput): HouseholdPairDraft {
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

function computeTriangleTerritoryRange(input: TriangleTerritoryWorkerInput & TriangleTerritoryWorkerRange): TriangleTerritoryWorkerResult {
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

class RoadQueue {
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
        const item = this.items[index];
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            const parent = this.items[parentIndex];
            if (item.cost >= parent.cost) break;
            this.items[parentIndex] = item;
            this.items[index] = parent;
            index = parentIndex;
        }
    }

    private sinkDown(index: number) {
        const length = this.items.length;
        const item = this.items[index];
        while (true) {
            const leftIndex = 2*index + 1;
            const rightIndex = leftIndex + 1;
            let swapIndex = -1;

            if (leftIndex < length && this.items[leftIndex].cost < item.cost) {
                swapIndex = leftIndex;
            }
            if (
                rightIndex < length
                && this.items[rightIndex].cost < (swapIndex < 0 ? item.cost : this.items[leftIndex].cost)
            ) {
                swapIndex = rightIndex;
            }
            if (swapIndex < 0) break;

            this.items[index] = this.items[swapIndex];
            this.items[swapIndex] = item;
            index = swapIndex;
        }
    }
}

function insertTopCandidate(top: Array<{triangle: number; score: number}>, candidate: {triangle: number; score: number}, limit: number) {
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

function settlementSiteCandidates(input: SettlementSiteSelectionCommonInput, civilizationId: number): number[] {
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
        insertTopCandidate(top, {triangle, score}, input.topCandidateLimit);
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

function computeTerrainAnalysisRange(input: TerrainAnalysisWorkerInput & TerrainAnalysisWorkerRange): TerrainAnalysisWorkerResult {
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

function pointDistance(a: RoadPoint, b: RoadPoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function trianglePoint(input: InternalRoadWorkerInput, triangle: number): RoadPoint {
    return {
        x: input.triangleX[triangle],
        y: input.triangleY[triangle],
    };
}

function roadPathLength(points: RoadPoint[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        length += pointDistance(points[i - 1], points[i]);
    }
    return length;
}

function pointLineDistance(point: RoadPoint, start: RoadPoint, end: RoadPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length2 = dx*dx + dy*dy;
    if (length2 === 0) return pointDistance(point, start);

    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / length2, 0, 1);
    return pointDistance(point, {x: start.x + dx * t, y: start.y + dy * t});
}

function simplifyRoadPoints(points: RoadPoint[], tolerance: number): RoadPoint[] {
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

function roadPassableTriangle(input: InternalRoadWorkerInput, civId: number, triangle: number, endpointTriangles: Set<number>): boolean {
    if (triangle < 0 || triangle >= input.numSolidTriangles || input.isBoundaryTriangle[triangle] || input.elevation[triangle] < 0) return false;
    const owner = input.territory[triangle] ?? -1;
    return endpointTriangles.has(triangle) || owner < 0 || owner === civId;
}

function roadStepCost(input: InternalRoadWorkerInput, civId: number, from: number, to: number): number {
    const fromPoint = trianglePoint(input, from);
    const toPoint = trianglePoint(input, to);
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

function findRoadPath(
    input: InternalRoadWorkerInput,
    civId: number,
    startTriangle: number,
    targetTriangle: number,
): {triangles: number[]; cost: number} | undefined {
    const endpointTriangles = new Set([startTriangle, targetTriangle]);
    if (
        !roadPassableTriangle(input, civId, startTriangle, endpointTriangles)
        || !roadPassableTriangle(input, civId, targetTriangle, endpointTriangles)
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
            if (!roadPassableTriangle(input, civId, neighbor, endpointTriangles)) continue;
            const nextCost = current.cost + roadStepCost(input, civId, current.triangle, neighbor);
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

function computeInternalRoadsForCivilization(input: InternalRoadWorkerInput, civilizationId: number): InternalRoadDraft[] {
    const roads: InternalRoadDraft[] = [];
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
            const route = findRoadPath(input, civilizationId, settlement.triangle, target.triangle);
            if (!route) continue;
            if (!chosen || route.cost < chosen.cost) {
                chosen = {settlement: target, triangles: route.triangles, cost: route.cost};
            }
        }

        if (chosen) {
            const rawPoints = chosen.triangles.map(triangle => trianglePoint(input, triangle));
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

function notify(signal: SharedArrayBuffer) {
    const view = new Int32Array(signal);
    Atomics.store(view, 0, 1);
    Atomics.notify(view, 0);
}

const port = (workerData as {port?: MessagePort} | undefined)?.port;
if (!port) throw new Error("Civilization worker started without a message port");

port.on("message", (task: WorkerTask) => {
    if (task.type === "shutdown") {
        notify(task.signal);
        port.close();
        process.exit(0);
    }

    try {
        if (task.type === "annual-agent-profession-batch") {
            port.postMessage({
                requestId: task.requestId,
                annualAgentProfessionDrafts: task.input.agents.map(agent => computeAnnualAgentProfessionDraft(task.input.seed, agent)),
            });
        } else if (task.type === "settlement-agent-seed-plan-batch") {
            port.postMessage({
                requestId: task.requestId,
                settlementAgentSeedPlans: task.input.requests.map(request => buildSettlementAgentSeedPlan(task.input.seed, request)),
            });
        } else if (task.type === "settlement-site-selection-batch") {
            port.postMessage({
                requestId: task.requestId,
                settlementSiteResults: task.input.civilizationIds.map(civilizationId => ({
                    civilizationId,
                    candidates: settlementSiteCandidates(task.input, civilizationId),
                })),
            });
        } else if (task.type === "terrain-analysis-batch") {
            port.postMessage({
                requestId: task.requestId,
                terrainAnalysis: computeTerrainAnalysisRange(task.input),
            });
        } else if (task.type === "internal-road-batch") {
            port.postMessage({
                requestId: task.requestId,
                roadResults: task.input.civilizationIds.map(civilizationId => ({
                    civilizationId,
                    roads: computeInternalRoadsForCivilization(task.input, civilizationId),
                })),
            });
        } else if (task.type === "triangle-territory-batch") {
            port.postMessage({
                requestId: task.requestId,
                triangleTerritory: computeTriangleTerritoryRange(task.input),
            });
        } else if (task.type === "migration-batch") {
            port.postMessage({
                requestId: task.requestId,
                migrationDrafts: task.input.origins.map(origin => computeMigrationDraft(task.input.settlements, origin)),
            });
        } else if (task.type === "birth-count-batch") {
            port.postMessage({
                requestId: task.requestId,
                birthCountDrafts: task.input.settlements.map(settlement => computeBirthCountDraft(
                    task.input.seed,
                    task.input.year,
                    settlement,
                )),
            });
        } else if (task.type === "birth-parent-batch") {
            port.postMessage({
                requestId: task.requestId,
                birthParentDrafts: task.input.settlements.map(settlement => computeBirthParentDraft(
                    task.input.seed,
                    task.input.year,
                    settlement,
                )),
            });
        } else if (task.type === "household-pair-batch") {
            port.postMessage({
                requestId: task.requestId,
                householdPairDrafts: task.input.settlements.map(settlement => computeHouseholdPairDraft(
                    task.input.seed,
                    task.input.year,
                    settlement,
                )),
            });
        } else {
            port.postMessage({
                requestId: task.requestId,
                settlementEconomyDrafts: task.input.settlements.map(settlement => computeSettlementEconomyDraft(
                    task.input.seed,
                    task.input.year,
                    settlement,
                )),
            });
        }
    } catch (error) {
        port.postMessage({
            requestId: task.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        notify(task.signal);
    }
});
