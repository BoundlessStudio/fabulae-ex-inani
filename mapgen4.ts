/*
 * Direct mapgen4 control input table.
 *
 * This is intentionally data-only for the console app. It preserves the
 * original mapgen4.ts slider parameter block so terminal generation uses the
 * same initial inputs as the browser version did.
 */

export const mapgen4InitialParams = {
    elevation: [
        ['seed', 187, 1, 1 << 30],
        ['island', 0.5, 0, 1],
        ['noisy_coastlines', 0.01, 0, 0.1],
        ['hill_height', 0.02, 0, 0.1],
        ['mountain_jagged', 0, 0, 1],
        ['mountain_sharpness', 9.8, 9.1, 12.5],
        ['mountain_folds', 0.05, 0.0, 0.5],
        ['ocean_depth', 1.40, 1, 3],
    ],
    biomes: [
        ['wind_angle_deg', 0, 0, 360],
        ['raininess', 0.9, 0, 2],
        ['rain_shadow', 0.5, 0.1, 2],
        ['evaporation', 0.5, 0, 1],
    ],
    rivers: [
        ['lg_min_flow', 2.7, -5, 5],
        ['lg_river_width', -2.4, -5, 5],
        ['flow', 0.2, 0, 1],
    ],
    render: [
        ['zoom', 100/480, 100/1000, 100/50],
        ['x', 500, 0, 1000],
        ['y', 500, 0, 1000],
        ['light_angle_deg', 80, 0, 360],
        ['slope', 2, 0, 5],
        ['flat', 2.5, 0, 5],
        ['ambient', 0.25, 0, 1],
        ['overhead', 30, 0, 60],
        ['tilt_deg', 0, 0, 90],
        ['rotate_deg', 0, -180, 180],
        ['mountain_height', 50, 0, 250],
        ['outline_depth', 1, 0, 2],
        ['outline_strength', 15, 0, 30],
        ['outline_threshold', 0, 0, 100],
        ['outline_coast', 0, 0, 1],
        ['outline_water', 13.0, 0, 20],
        ['biome_colors', 1, 0, 1],
    ],
} as const;

export type Mapgen4ControlPhase = keyof typeof mapgen4InitialParams;
export type Mapgen4InitialParam = readonly [name: string, initial: number, min: number, max: number];

export const mapgen4ControlPhaseNames = Object.keys(mapgen4InitialParams) as Mapgen4ControlPhase[];
