/*
 * Console-side mapgen4 orchestration. This keeps the original mesh and
 * terrain algorithms, but removes browser fetch/worker/painting dependencies.
 */

import Delaunator from "delaunator";
import {TriangleMesh, type MeshInitializer} from "../../dependencies/dual-mesh/index.ts";
import {choosePoints} from "./generate-points.ts";
import TerrainMap from "./map.ts";
import {applyControlValues, defaultControlValues, type ControlOverrides, type ControlValues} from "./map-controls.ts";
import {generateElevationConstraints} from "./elevation-constraints.ts";
import type {Mesh} from "./types.d.ts";

export type MapgenBaseParam = {
    spacing: number;
    mountainSpacing: number;
    mesh: {
        seed: number;
    };
    elevation: Record<string, number>;
    biomes: Record<string, number>;
    rivers: Record<string, number>;
    render: Record<string, number>;
};

export type GeneratedWorldMap = {
    mesh: Mesh;
    map: TerrainMap;
    t_peaks: number[];
    controls: ControlValues;
    param: MapgenBaseParam;
};

export function createBaseParam(controls: ControlValues): MapgenBaseParam {
    const param: MapgenBaseParam = {
        spacing: 5.5,
        mountainSpacing: 35,
        mesh: {
            seed: 12345,
        },
        elevation: {},
        biomes: {},
        rivers: {},
        render: {},
    };
    applyControlValues(param, controls);
    return param;
}

export function makeNodeMesh(param: Pick<MapgenBaseParam, "spacing" | "mountainSpacing" | "mesh">): {mesh: Mesh; t_peaks: number[]} {
    const pointsData = choosePoints(param.mesh.seed, param.spacing, param.mountainSpacing);
    const {
        points,
        numExteriorBoundaryPoints,
        numInteriorBoundaryPoints,
        numMountainPoints,
    } = pointsData;

    let meshInit: MeshInitializer = TriangleMesh.addGhostStructure({
        points,
        delaunator: Delaunator.from(points) as any,
        numBoundaryPoints: numExteriorBoundaryPoints,
    });
    let mesh = new TriangleMesh(meshInit) as Mesh;

    mesh.is_boundary_t = new Int8Array(mesh.numTriangles);
    for (let t = 0; t < mesh.numTriangles; t++) {
        mesh.is_boundary_t[t] = mesh.r_around_t(t).some(r => mesh.is_boundary_r(r)) ? 1 : 0;
    }

    mesh.length_s = new Float32Array(mesh.numSides);
    for (let s = 0; s < mesh.numSides; s++) {
        let r1 = mesh.r_begin_s(s),
            r2 = mesh.r_end_s(s);
        let dx = mesh.x_of_r(r1) - mesh.x_of_r(r2),
            dy = mesh.y_of_r(r1) - mesh.y_of_r(r2);
        mesh.length_s[s] = Math.sqrt(dx*dx + dy*dy);
    }

    let r_peaks = Array.from(
        {length: numMountainPoints},
        (_, index) => index + numExteriorBoundaryPoints + numInteriorBoundaryPoints);

    let t_peaks: number[] = [];
    for (let r of r_peaks) {
        t_peaks.push(mesh.t_inner_s(mesh._s_of_r[r]));
    }

    return {mesh, t_peaks};
}

export function generateWorldMap(overrides: ControlOverrides = {}): GeneratedWorldMap {
    const controls = defaultControlValues(overrides);
    const param = createBaseParam(controls);
    const {mesh, t_peaks} = makeNodeMesh(param);
    const map = new TerrainMap(mesh, t_peaks, param);
    const constraints = generateElevationConstraints({
        seed: controls.elevation.seed,
        island: controls.elevation.island,
    });

    map.assignElevation(param.elevation, constraints);
    map.assignRainfall(param.biomes);
    map.assignRivers(param.rivers);

    return {mesh, map, t_peaks, controls, param};
}
