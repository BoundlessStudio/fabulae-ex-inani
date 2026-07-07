/*
 * Terminal PNG renderer for generated mapgen4 terrain.
 * This is CPU-only: no DOM, canvas, WebGL, browser, or server.
 */

import {PNG} from "pngjs";
import Geometry, {clamp} from "../mapgen/geometry.ts";
import type {GeneratedWorldMap} from "../mapgen/node-mapgen.ts";
import type {CivilizationSimulation} from "../simulation/civilizations.ts";

type Rgba = [number, number, number, number];
type Rgb = [number, number, number];

export type RenderOptions = {
    width: number;
    height: number;
    civilizations?: CivilizationSimulation;
};

type Point = {
    x: number;
    y: number;
};

type TerrainVertex = Point & {
    elevation: number;
    moisture: number;
    depth: number;
};

type Projector = {
    project(x: number, y: number): Point;
    pixelScale: number;
};

type RenderBuffers = {
    width: number;
    height: number;
    covered: Uint8Array;
    elevation: Float32Array;
    moisture: Float32Array;
    depth: Float32Array;
    landZ: Float32Array;
    lightingZ: Float32Array;
    waterR: Float32Array;
    waterG: Float32Array;
    waterB: Float32Array;
    waterA: Float32Array;
    owner: Int16Array;
};

const COLORMAP_WIDTH = 64;
const COLORMAP_HEIGHT = 64;
const COLORMAP = makeColormap();
const REFERENCE_EXPOSURE = 0.985;

function mix(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
    return [
        mix(a[0], b[0], t),
        mix(a[1], b[1], t),
        mix(a[2], b[2], t),
    ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
}

function makeColormap(): Uint8Array {
    const pixels = new Uint8Array(COLORMAP_WIDTH * COLORMAP_HEIGHT * 3);

    for (let y = 0, p = 0; y < COLORMAP_HEIGHT; y++) {
        for (let x = 0; x < COLORMAP_WIDTH; x++) {
            let e = 2 * x / COLORMAP_WIDTH - 1;
            let m = y / COLORMAP_HEIGHT;
            let r: number, g: number, b: number;

            if (x === COLORMAP_WIDTH/2 - 1) {
                r = 48; g = 120; b = 160;
            } else if (x === COLORMAP_WIDTH/2 - 2) {
                r = 48; g = 100; b = 150;
            } else if (x === COLORMAP_WIDTH/2 - 3) {
                r = 48; g = 80; b = 140;
            } else if (e < 0.0) {
                r = 48 + 48*e;
                g = 64 + 64*e;
                b = 127 + 127*e;
            } else {
                m = m * (1-e);
                r = 210 - 100*m;
                g = 185 - 45*m;
                b = 139 - 45*m;
                r = 255 * e + r * (1-e);
                g = 255 * e + g * (1-e);
                b = 255 * e + b * (1-e);
            }

            pixels[p++] = clamp(Math.round(r), 0, 255);
            pixels[p++] = clamp(Math.round(g), 0, 255);
            pixels[p++] = clamp(Math.round(b), 0, 255);
        }
    }

    return pixels;
}

function colormapColor(z: number, moisture: number): Rgb {
    const x = clamp(Math.floor(clamp(z, 0, 0.999999) * COLORMAP_WIDTH), 0, COLORMAP_WIDTH - 1);
    const y = clamp(Math.floor(clamp(moisture, 0, 0.999999) * COLORMAP_HEIGHT), 0, COLORMAP_HEIGHT - 1);
    const p = (y * COLORMAP_WIDTH + x) * 3;
    return [COLORMAP[p] / 255, COLORMAP[p + 1] / 255, COLORMAP[p + 2] / 255];
}

function makeProjector(world: GeneratedWorldMap, options: RenderOptions): Projector {
    const render = world.controls.render;
    const zoom = render.zoom / 100;
    const angle = render.rotate_deg * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const pixelScale = Math.min(options.width, options.height) * zoom / 2;

    return {
        pixelScale,
        project(x: number, y: number): Point {
            const dx = x - render.x;
            const dy = y - render.y;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            return {
                x: (rx * zoom + 1) * options.width / 2,
                y: (ry * zoom + 1) * options.height / 2,
            };
        },
    };
}

function hexToRgb(color: string): Rgb {
    const value = color.startsWith("#") ? color.slice(1) : color;
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ];
}

function setPixel(image: PNG, x: number, y: number, color: Rgba) {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const p = (y * image.width + x) * 4;
    image.data[p] = color[0];
    image.data[p + 1] = color[1];
    image.data[p + 2] = color[2];
    image.data[p + 3] = color[3];
}

function blendPixel(image: PNG, x: number, y: number, color: Rgb, alpha: number) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const p = (y * image.width + x) * 4;
    const keep = 1 - alpha;
    image.data[p] = Math.round(image.data[p] * keep + color[0] * alpha);
    image.data[p + 1] = Math.round(image.data[p + 1] * keep + color[1] * alpha);
    image.data[p + 2] = Math.round(image.data[p + 2] * keep + color[2] * alpha);
    image.data[p + 3] = 255;
}

function edge(a: Point, b: Point, p: Point): number {
    return (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
}

function rasterTriangle(
    width: number,
    height: number,
    a: Point,
    b: Point,
    c: Point,
    visit: (x: number, y: number, w0: number, w1: number, w2: number) => void,
) {
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const area = edge(a, b, c);
    if (Math.abs(area) < 0.0001) return;

    const sign = area < 0 ? -1 : 1;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const p = {x: x + 0.5, y: y + 0.5};
            const e0 = sign * edge(b, c, p);
            const e1 = sign * edge(c, a, p);
            const e2 = sign * edge(a, b, p);
            if (e0 >= 0 && e1 >= 0 && e2 >= 0) {
                const total = e0 + e1 + e2;
                visit(x, y, e0 / total, e1 / total, e2 / total);
            }
        }
    }
}

function createBuffers(width: number, height: number): RenderBuffers {
    const length = width * height;
    const depth = new Float32Array(length);
    depth.fill(-1);
    return {
        width,
        height,
        covered: new Uint8Array(length),
        elevation: new Float32Array(length),
        moisture: new Float32Array(length),
        depth,
        landZ: new Float32Array(length),
        lightingZ: new Float32Array(length),
        waterR: new Float32Array(length),
        waterG: new Float32Array(length),
        waterB: new Float32Array(length),
        waterA: new Float32Array(length),
        owner: new Int16Array(length).fill(-1),
    };
}

function fillTerrainTriangle(buffers: RenderBuffers, a: TerrainVertex, b: TerrainVertex, c: TerrainVertex) {
    rasterTriangle(buffers.width, buffers.height, a, b, c, (x, y, w0, w1, w2) => {
        const p = y * buffers.width + x;
        buffers.covered[p] = 1;
        buffers.elevation[p] = w0*a.elevation + w1*b.elevation + w2*c.elevation;
        buffers.moisture[p] = w0*a.moisture + w1*b.moisture + w2*c.moisture;
        buffers.depth[p] = w0*a.depth + w1*b.depth + w2*c.depth;
    });
}

function drawTerrainBuffers(buffers: RenderBuffers, world: GeneratedWorldMap, projector: Projector) {
    const {mesh, map, controls} = world;

    function regionVertex(r: number): TerrainVertex {
        const point = projector.project(mesh.x_of_r(r), mesh.y_of_r(r));
        return {
            ...point,
            elevation: map.elevation_r[r],
            moisture: map.rainfall_r[r] || 0,
            depth: map.elevation_r[r],
        };
    }

    function triangleVertex(t: number): TerrainVertex {
        const point = projector.project(mesh.x_of_t(t), mesh.y_of_t(t));
        const s0 = 3 * t;
        const r1 = mesh.r_begin_s(s0),
              r2 = mesh.r_begin_s(s0 + 1),
              r3 = mesh.r_begin_s(s0 + 2);
        const moisture = 1/3 * ((map.rainfall_r[r1] || 0) + (map.rainfall_r[r2] || 0) + (map.rainfall_r[r3] || 0));
        const elevation = (1.0 - controls.elevation.mountain_folds * Math.sqrt(Math.max(0, map.elevation_t[t]))) * map.elevation_t[t];
        return {
            ...point,
            elevation,
            moisture,
            depth: elevation,
        };
    }

    for (let s = 0; s < mesh.numSolidSides; s++) {
        const sOpposite = mesh.s_opposite_s(s),
              r1 = mesh.r_begin_s(s),
              r2 = mesh.r_begin_s(sOpposite),
              t1 = mesh.t_inner_s(s),
              t2 = mesh.t_inner_s(sOpposite);

        if (mesh.is_ghost_r(r1) || mesh.is_ghost_r(r2)) continue;

        let isValley = false;
        if (map.elevation_r[r1] < 0.0 || map.elevation_r[r2] < 0.0) isValley = true;
        if (map.flow_s[s] > 0 || map.flow_s[sOpposite] > 0) isValley = true;
        if (mesh.is_boundary_t[t1] || mesh.is_boundary_t[t2]) isValley = false;

        if (isValley) {
            fillTerrainTriangle(buffers, regionVertex(r1), triangleVertex(t2), triangleVertex(t1));
        } else {
            fillTerrainTriangle(buffers, regionVertex(r1), regionVertex(r2), triangleVertex(t1));
        }
    }
}

function fillOwnerTriangle(buffers: RenderBuffers, a: Point, b: Point, c: Point, owner: number) {
    rasterTriangle(buffers.width, buffers.height, a, b, c, (x, y) => {
        const p = y * buffers.width + x;
        if (buffers.covered[p]) buffers.owner[p] = owner;
    });
}

function drawCivilizationCellOwnership(buffers: RenderBuffers, world: GeneratedWorldMap, projector: Projector, civilizations?: CivilizationSimulation) {
    if (!civilizations) return;

    const {mesh} = world;
    const triangles: number[] = [];

    for (let r = 0; r < mesh.numRegions; r++) {
        const owner = civilizations.territory_r[r];
        if (owner < 0 || mesh.is_ghost_r(r) || mesh.is_boundary_r(r)) continue;

        mesh.t_around_r(r, triangles);
        const center = projector.project(mesh.x_of_r(r), mesh.y_of_r(r));

        for (let i = 0; i < triangles.length; i++) {
            const t0 = triangles[i];
            const t1 = triangles[(i + 1) % triangles.length];
            if (t0 < 0 || t1 < 0 || t0 >= mesh.numSolidTriangles || t1 >= mesh.numSolidTriangles) continue;
            fillOwnerTriangle(
                buffers,
                center,
                projector.project(mesh.x_of_t(t0), mesh.y_of_t(t0)),
                projector.project(mesh.x_of_t(t1), mesh.y_of_t(t1)),
                owner,
            );
        }
    }
}

function blendWater(buffers: RenderBuffers, x: number, y: number, alpha: number) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= buffers.width || y >= buffers.height) return;
    const p = y * buffers.width + x;
    const srcR = 0.2 * alpha;
    const srcG = 0.5 * alpha;
    const srcB = 0.7 * alpha;
    const keep = 1 - alpha;
    buffers.waterR[p] = srcR + buffers.waterR[p] * keep;
    buffers.waterG[p] = srcG + buffers.waterG[p] * keep;
    buffers.waterB[p] = srcB + buffers.waterB[p] * keep;
    buffers.waterA[p] = alpha + buffers.waterA[p] * keep;
}

function drawRiverBuffers(buffers: RenderBuffers, world: GeneratedWorldMap, projector: Projector) {
    const {mesh, map, param} = world;
    const maxRiverVertices = Math.ceil(1.5 * 3 * mesh.numSolidTriangles);
    const riverGeometry = new Float32Array(maxRiverVertices * 4);
    const numRiverTriangles = Geometry.setRiverGeometry(map, param.spacing, param.rivers, riverGeometry);

    for (let i = 0; i < numRiverTriangles; i++) {
        const p = i * 12;
        const a = projector.project(riverGeometry[p], riverGeometry[p + 1]);
        const b = projector.project(riverGeometry[p + 4], riverGeometry[p + 5]);
        const c = projector.project(riverGeometry[p + 8], riverGeometry[p + 9]);
        const width1 = riverGeometry[p + 2];
        const width2 = riverGeometry[p + 3];

        rasterTriangle(buffers.width, buffers.height, a, b, c, (x, y, w0, _w1, w2) => {
            const xt = w0 / Math.max(0.000001, w2 + w0);
            const dist = Math.sqrt(w2*w2 + w0*w0 + w2*w0);
            const width = 0.35 * mix(width2, width1, xt);
            const alpha = smoothstep(width + 0.025, Math.max(0.0, width - 0.05), Math.abs(dist - 0.5));
            blendWater(buffers, x, y, alpha);
        });
    }
}

function computeLandZ(buffers: RenderBuffers, outlineWater: number) {
    const bump = outlineWater / 256.0;
    for (let p = 0; p < buffers.landZ.length; p++) {
        const rawElevation = buffers.covered[p] ? buffers.elevation[p] : -1;
        let z = 0.5 * (1.0 + rawElevation);
        if (z >= 0.5) {
            const river = buffers.waterA[p];
            const l1 = z + bump;
            const l2 = (z - 0.5) * (bump * 100.0) + 0.5;
            z = Math.min(l1, mix(l1, l2, river));
        }
        buffers.landZ[p] = z;
    }
}

function computeLightingZ(buffers: RenderBuffers) {
    const {width, height, landZ, lightingZ} = buffers;
    const temp = new Float32Array(landZ.length);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            const left = landZ[y * width + Math.max(0, x - 1)];
            const center = landZ[p];
            const right = landZ[y * width + Math.min(width - 1, x + 1)];
            temp[p] = 0.25 * left + 0.5 * center + 0.25 * right;
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            const top = temp[Math.max(0, y - 1) * width + x];
            const center = temp[p];
            const bottom = temp[Math.min(height - 1, y + 1) * width + x];
            lightingZ[p] = 0.25 * top + 0.5 * center + 0.25 * bottom;
        }
    }
}

function sampleLinear(buffer: Float32Array, width: number, height: number, x: number, y: number): number {
    const sx = clamp(x, 0, width - 1);
    const sy = clamp(y, 0, height - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const p00 = buffer[y0 * width + x0];
    const p10 = buffer[y0 * width + x1];
    const p01 = buffer[y1 * width + x0];
    const p11 = buffer[y1 * width + x1];
    return mix(mix(p00, p10, tx), mix(p01, p11, tx), ty);
}

function renderFinalImage(image: PNG, buffers: RenderBuffers, world: GeneratedWorldMap, civilizations?: CivilizationSimulation) {
    const render = world.controls.render;
    const lightAngleRad = Math.PI / 180 * (render.light_angle_deg + render.rotate_deg);
    const lightX = Math.cos(lightAngleRad);
    const lightY = Math.sin(lightAngleRad);
    const inverseX = 1.5 / image.width;
    const inverseY = 1.5 / image.height;
    const sampleOffset = 1.5;
    const outlineOffset = Math.max(0.5, render.outline_depth * 5 * render.zoom * 1.5);
    const outlineThreshold = render.outline_threshold / 1000;
    const biomeColors = clamp(render.biome_colors, 0, 1);
    const neutralLand: Rgb = [0.9, 0.8, 0.7];
    const neutralWater: Rgb = [0.72, 0.64, 0.56];
    const bump = render.outline_water / 256.0;
    const civilizationColors = civilizations?.civilizations.map(civ => hexToRgb(civ.color)) ?? [];

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const p = y * image.width + x;
            const rawElevation = buffers.covered[p] ? buffers.elevation[p] : -1;
            let z = buffers.landZ[p];
            let waterA = buffers.waterA[p];
            let waterColor: Rgb = [buffers.waterR[p], buffers.waterG[p], buffers.waterB[p]];
            let neutralBiomeColor = neutralLand;

            if (z >= 0.5 && rawElevation >= 0.0) {
                z -= bump * (1.0 - waterA);
            } else {
                waterA = 0.0;
                waterColor = [0, 0, 0];
                neutralBiomeColor = neutralWater;
            }

            let biomeColor = colormapColor(z, buffers.moisture[p]);
            const neutralWaterColor: Rgb = neutralWater.map(channel => channel * (1.2 - waterA)) as Rgb;
            waterColor = mixRgb(neutralWaterColor, waterColor, biomeColors);
            biomeColor = mixRgb(neutralBiomeColor, biomeColor, biomeColors);

            const zE = sampleLinear(buffers.lightingZ, image.width, image.height, x + sampleOffset, y);
            const zN = sampleLinear(buffers.lightingZ, image.width, image.height, x, y - sampleOffset);
            const zW = sampleLinear(buffers.lightingZ, image.width, image.height, x - sampleOffset, y);
            const zS = sampleLinear(buffers.lightingZ, image.width, image.height, x, y + sampleOffset);
            const slopeVector = normalize3(zS - zN, zE - zW, render.overhead * (inverseX + inverseY));
            const lightVector = normalize3(lightX, lightY, mix(render.slope, render.flat, slopeVector[2]));
            const light = render.ambient + Math.max(0.0, lightVector[0]*slopeVector[0] + lightVector[1]*slopeVector[1] + lightVector[2]*slopeVector[2]);

            const depth0 = buffers.depth[p];
            const depth1 = Math.max(
                sampleLinear(buffers.depth, image.width, image.height, x - outlineOffset, y - outlineOffset),
                sampleLinear(buffers.depth, image.width, image.height, x + outlineOffset, y - outlineOffset),
                sampleLinear(buffers.depth, image.width, image.height, x, y - outlineOffset),
            );
            const depth2 = Math.max(
                sampleLinear(buffers.depth, image.width, image.height, x - outlineOffset, y + outlineOffset),
                sampleLinear(buffers.depth, image.width, image.height, x + outlineOffset, y + outlineOffset),
                sampleLinear(buffers.depth, image.width, image.height, x, y + outlineOffset),
            );
            const outline = Math.max(0.15, 1.0 + render.outline_strength * (Math.max(outlineThreshold, depth1 - depth0) - outlineThreshold));
            let rgb = mixRgb(biomeColor, waterColor, waterA)
                .map(channel => clamp(Math.round(255 * channel * light / outline * REFERENCE_EXPOSURE), 0, 255)) as Rgb;

            const owner = buffers.owner[p];
            if (owner >= 0 && rawElevation >= 0 && civilizationColors[owner]) {
                rgb = mixRgb(rgb, civilizationColors[owner], 0.24).map(channel => Math.round(channel)) as Rgb;
            }
            setPixel(image, x, y, [rgb[0], rgb[1], rgb[2], 255]);
        }
    }
}

function drawCircle(image: PNG, center: Point, radius: number, color: Rgba) {
    const minX = Math.floor(center.x - radius);
    const maxX = Math.ceil(center.x + radius);
    const minY = Math.floor(center.y - radius);
    const maxY = Math.ceil(center.y + radius);
    const radius2 = radius * radius;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const dx = x + 0.5 - center.x;
            const dy = y + 0.5 - center.y;
            if (dx*dx + dy*dy <= radius2) setPixel(image, x, y, color);
        }
    }
}

function drawBlendedCircle(image: PNG, center: Point, radius: number, color: Rgb, alpha: number) {
    const minX = Math.floor(center.x - radius);
    const maxX = Math.ceil(center.x + radius);
    const minY = Math.floor(center.y - radius);
    const maxY = Math.ceil(center.y + radius);
    const radius2 = radius * radius;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const dx = x + 0.5 - center.x;
            const dy = y + 0.5 - center.y;
            if (dx*dx + dy*dy <= radius2) blendPixel(image, x, y, color, alpha);
        }
    }
}

function drawBlendedLine(image: PNG, a: Point, b: Point, color: Rgb, alpha: number, radius: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx*dx + dy*dy) * 1.25));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        drawBlendedCircle(image, {x: a.x + dx * t, y: a.y + dy * t}, radius, color, alpha);
    }
}

function drawCivilizationBorders(image: PNG, world: GeneratedWorldMap, projector: Projector, civilizations?: CivilizationSimulation) {
    if (!civilizations) return;
    const {mesh} = world;
    const color: Rgb = [38, 34, 30];
    const radius = Math.max(0.55, Math.min(image.width, image.height) / 1400);

    for (let s = 0; s < mesh.numSolidSides; s++) {
        const opposite = mesh.s_opposite_s(s);
        if (opposite < 0 || s > opposite) continue;

        const r1 = mesh.r_begin_s(s);
        const r2 = mesh.r_end_s(s);
        const owner1 = civilizations.territory_r[r1] ?? -1;
        const owner2 = civilizations.territory_r[r2] ?? -1;
        if (owner1 < 0 || owner2 < 0 || owner1 === owner2) continue;

        const t1 = mesh.t_inner_s(s);
        const t2 = mesh.t_outer_s(s);
        if (t1 < 0 || t2 < 0 || t1 >= mesh.numSolidTriangles || t2 >= mesh.numSolidTriangles) continue;
        drawBlendedLine(
            image,
            projector.project(mesh.x_of_t(t1), mesh.y_of_t(t1)),
            projector.project(mesh.x_of_t(t2), mesh.y_of_t(t2)),
            color,
            0.36,
            radius,
        );
    }
}

function drawRoads(image: PNG, _world: GeneratedWorldMap, projector: Projector, civilizations?: CivilizationSimulation) {
    if (!civilizations) return;
    const scale = Math.max(0.55, Math.min(image.width, image.height) / 1024);
    const shadow: Rgb = [70, 52, 35];
    const surface: Rgb = [212, 178, 112];

    for (let road of civilizations.roads) {
        if (road.points.length < 2) continue;

        const strength = clamp(road.strength ?? 0.35, 0.12, 1);
        const projected = road.points.map(point => projector.project(point.x, point.y));
        for (let i = 1; i < projected.length; i++) {
            drawBlendedLine(image, projected[i - 1], projected[i], shadow, 0.26 + strength * 0.28, (0.85 + strength * 0.75) * scale);
        }
        for (let i = 1; i < projected.length; i++) {
            drawBlendedLine(image, projected[i - 1], projected[i], surface, 0.34 + strength * 0.44, (0.36 + strength * 0.52) * scale);
        }
    }
}

function drawSettlementMarkers(image: PNG, world: GeneratedWorldMap, projector: Projector, civilizations?: CivilizationSimulation) {
    if (!civilizations) return;
    const scale = Math.max(1, Math.min(image.width, image.height) / 1024);
    for (let settlement of civilizations.settlements) {
        const point = projector.project(settlement.x, settlement.y);
        const color = hexToRgb(civilizations.civilizations[settlement.civilizationId].color);
        const radius = settlement.type === "capital" ? 4.8 * scale : 3.2 * scale;
        drawCircle(image, point, radius + 1.8 * scale, [24, 26, 28, 255]);
        drawCircle(image, point, radius, [color[0], color[1], color[2], 255]);
        if (settlement.type === "capital") {
            drawCircle(image, point, 1.5 * scale, [248, 242, 220, 255]);
        }
    }
}

export function renderWorldMapPng(world: GeneratedWorldMap, options: RenderOptions): PNG {
    const image = new PNG({width: options.width, height: options.height});
    const projector = makeProjector(world, options);
    const buffers = createBuffers(options.width, options.height);

    drawTerrainBuffers(buffers, world, projector);
    drawCivilizationCellOwnership(buffers, world, projector, options.civilizations);
    drawRiverBuffers(buffers, world, projector);
    computeLandZ(buffers, world.controls.render.outline_water);
    computeLightingZ(buffers);
    renderFinalImage(image, buffers, world, options.civilizations);
    drawRoads(image, world, projector, options.civilizations);
    drawCivilizationBorders(image, world, projector, options.civilizations);
    drawSettlementMarkers(image, world, projector, options.civilizations);

    return image;
}
