/*
 * Node-friendly version of mapgen4's default painting constraint map.
 * It produces the same unpainted island/ocean elevation field the browser
 * painting tool used before any user brush strokes.
 */

import {createNoise2D} from "simplex-noise";
import {makeRandFloat} from "@redblobgames/prng";

export const CONSTRAINT_SIZE = 128;

export type ElevationConstraintParam = {
    seed: number;
    island: number;
};

export type ElevationConstraints = {
    size: number;
    constraints: Float32Array;
};

export function generateElevationConstraints(elevationParam: ElevationConstraintParam): ElevationConstraints {
    const elevation = new Float32Array(CONSTRAINT_SIZE * CONSTRAINT_SIZE);
    const noise2D = createNoise2D(makeRandFloat(elevationParam.seed));
    const persistence = 1/2;
    const amplitudes = Array.from({length: 5}, (_, octave) => Math.pow(persistence, octave));

    function fbmNoise(nx: number, ny: number): number {
        let sum = 0, sumOfAmplitudes = 0;
        for (let octave = 0; octave < amplitudes.length; octave++) {
            let frequency = 1 << octave;
            sum += amplitudes[octave] * noise2D(nx * frequency, ny * frequency);
            sumOfAmplitudes += amplitudes[octave];
        }
        return sum / sumOfAmplitudes;
    }

    for (let y = 0; y < CONSTRAINT_SIZE; y++) {
        for (let x = 0; x < CONSTRAINT_SIZE; x++) {
            let p = y * CONSTRAINT_SIZE + x;
            let nx = 2 * x/CONSTRAINT_SIZE - 1,
                ny = 2 * y/CONSTRAINT_SIZE - 1;
            let distance = Math.max(Math.abs(nx), Math.abs(ny));
            let e = 0.5 * (fbmNoise(nx, ny) + elevationParam.island * (0.75 - 2 * distance * distance));
            if (e < -1.0) { e = -1.0; }
            if (e > +1.0) { e = +1.0; }
            elevation[p] = e;
            if (e > 0.0) {
                let m = (0.5 * noise2D(nx + 30, ny + 50)
                         + 0.5 * noise2D(2*nx + 33, 2*ny + 55));
                let mountain = Math.min(1.0, e * 5.0) * (1 - Math.abs(m) / 0.5);
                if (mountain > 0.0) {
                    elevation[p] = Math.max(e, Math.min(e * 3, mountain));
                }
            }
        }
    }

    return {size: CONSTRAINT_SIZE, constraints: elevation};
}
