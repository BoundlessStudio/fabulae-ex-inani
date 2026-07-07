import {mapgen4ControlPhaseNames, mapgen4InitialParams, type Mapgen4ControlPhase} from "./mapgen4.ts";

export type ControlPhase = Mapgen4ControlPhase;

export type ControlSpec = {
    name: string;
    initial: number;
    min: number;
    max: number;
    step?: number;
    input?: "range" | "number";
};

export type ControlValues = Record<ControlPhase, Record<string, number>>;
export type ControlOverrides = Partial<Record<ControlPhase, Record<string, number>>>;

export const controlPhaseNames: ControlPhase[] = mapgen4ControlPhaseNames;

export const unlockedControlKeys = [
    "mesh.seed",
    "elevation.seed",
    "elevation.island",
    "biomes.wind_angle_deg",
    "biomes.raininess",
    "biomes.rain_shadow",
    "biomes.evaporation",
    "rivers.flow",
    "render.biome_colors",
] as const;

const unlockedControlKeySet = new Set<string>(unlockedControlKeys);

export const controlGroups: Record<ControlPhase, ControlSpec[]> =
    Object.fromEntries(
        controlPhaseNames.map(phase => [
            phase,
            mapgen4InitialParams[phase].map(([name, initial, min, max]) => ({
                name,
                initial,
                min,
                max,
                step: name === "seed" ? 1 : 0.001,
                input: name === "seed" ? "number" : "range",
            })),
        ]),
    ) as Record<ControlPhase, ControlSpec[]>;

export function controlKey(phase: ControlPhase, name: string): string {
    return `${phase}.${name}`;
}

export function isKnownControl(phase: string, name: string): phase is ControlPhase {
    return controlPhaseNames.includes(phase as ControlPhase)
        && controlGroups[phase as ControlPhase].some(spec => spec.name === name);
}

export function isUnlockedControl(phase: string, name: string): phase is ControlPhase {
    return isKnownControl(phase, name) && unlockedControlKeySet.has(controlKey(phase, name));
}

export function defaultControlValues(overrides: ControlOverrides = {}): ControlValues {
    const values = {} as ControlValues;
    for (let phase of controlPhaseNames) {
        values[phase] = {};
        for (let spec of controlGroups[phase]) {
            values[phase][spec.name] = isUnlockedControl(phase, spec.name)
                ? overrides[phase]?.[spec.name] ?? spec.initial
                : spec.initial;
        }
    }
    return values;
}

export function copyControlValues(values: ControlValues): ControlValues {
    const copy = {} as ControlValues;
    for (let phase of controlPhaseNames) {
        copy[phase] = {};
        for (let spec of controlGroups[phase]) {
            copy[phase][spec.name] = values[phase][spec.name];
        }
    }
    return copy;
}

export function applyControlValues(param: any, values: ControlValues) {
    for (let phase of controlPhaseNames) {
        param[phase] ??= {};
        for (let spec of controlGroups[phase]) {
            param[phase][spec.name] = values[phase][spec.name];
        }
    }
}

export function mergeControlOverrides(...overrides: ControlOverrides[]): ControlOverrides {
    const merged: ControlOverrides = {};
    for (let override of overrides) {
        for (let phase of controlPhaseNames) {
            if (!override[phase]) continue;
            for (let [name, value] of Object.entries(override[phase]!)) {
                if (!isUnlockedControl(phase, name)) continue;
                merged[phase] ??= {};
                merged[phase]![name] = value;
            }
        }
    }
    return merged;
}

export function parseControlOverridesFromSearch(search: string): ControlOverrides {
    const params = new URLSearchParams(search);
    const overrides: ControlOverrides = {};
    const controlsJson = params.get("controls");

    if (controlsJson) {
        try {
            return mergeControlOverrides(JSON.parse(controlsJson) as ControlOverrides, parseDottedControlParams(params));
        } catch (error) {
            console.warn("Ignoring invalid controls query parameter", error);
        }
    }

    return mergeControlOverrides(overrides, parseDottedControlParams(params));
}

function parseDottedControlParams(params: URLSearchParams): ControlOverrides {
    const overrides: ControlOverrides = {};
    for (let [key, value] of params) {
        const separator = key.indexOf(".");
        if (separator < 1) continue;
        const phase = key.slice(0, separator) as ControlPhase;
        const name = key.slice(separator + 1);
        if (!isUnlockedControl(phase, name)) continue;
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) continue;
        overrides[phase] ??= {};
        overrides[phase][name] = numericValue;
    }
    return overrides;
}
