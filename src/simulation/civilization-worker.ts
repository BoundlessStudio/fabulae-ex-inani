import {workerData, type MessagePort} from "node:worker_threads";
import {
    buildSettlementAgentSeedPlan,
    computeAnnualAgentProfessionDraft,
    computeBirthCountDraft,
    computeBirthParentDraft,
    computeHouseholdPairDraft,
    computeInternalRoadsForCivilization,
    computeMigrationDraft,
    computeSettlementEconomyDraft,
    computeTerrainAnalysisRange,
    computeTriangleTerritoryRange,
    settlementSiteCandidatesFromInput,
    type AnnualAgentProfessionInput,
    type BirthCountWorkerSettlement,
    type BirthParentWorkerSettlement,
    type HouseholdPairWorkerInput,
    type InternalRoadWorkerInput,
    type MigrationWorkerOrigin,
    type MigrationWorkerSettlement,
    type SettlementAgentSeedPlanRequest,
    type SettlementEconomyWorkerSettlement,
    type SettlementSiteSelectionCommonInput,
    type TerrainAnalysisWorkerInput,
    type TerrainAnalysisWorkerRange,
    type TriangleTerritoryWorkerInput,
    type TriangleTerritoryWorkerRange,
} from "./drafts.ts";

// This file is intentionally thin: every draft computation lives in
// src/simulation/drafts.ts and is shared with the main thread so parallel
// and single-worker runs cannot drift apart. Only the worker message
// plumbing and task envelopes belong here.

type AnnualAgentProfessionTask = {
    type: "annual-agent-profession-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: {
        seed: number;
        agents: AnnualAgentProfessionInput[];
    };
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

type SettlementSiteSelectionTask = {
    type: "settlement-site-selection-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: SettlementSiteSelectionCommonInput & {
        civilizationIds: number[];
    };
};

type TerrainAnalysisTask = {
    type: "terrain-analysis-batch";
    requestId: number;
    signal: SharedArrayBuffer;
    input: TerrainAnalysisWorkerInput & TerrainAnalysisWorkerRange;
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
                    candidates: settlementSiteCandidatesFromInput(task.input, civilizationId),
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
