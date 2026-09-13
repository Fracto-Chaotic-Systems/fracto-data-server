/**
 * Radial-sweep interpolation helpers for orbital circuitry.
 *
 * The radial-sweep implementation can be moved here as a focused module
 * while the circuitry endpoint remains responsible for request handling.
 */

import { get_rotation_direction, magnitude, sub } from "./orbitals_utils.js";

const FULL_TURN = 2 * Math.PI;
const DEFAULT_SAMPLES_PER_INTERVAL = 50;

/**
 * Calculate the positive angular sweep from one point to the next in the
 * selected rotation direction. Using modulo of a full turn here preserves
 * every interval instead of collapsing intervals whose shortest-angle delta
 * has the opposite sign.
 *
 * @param {number} from_angle Starting polar angle.
 * @param {number} to_angle Ending polar angle.
 * @param {number} direction Counter-clockwise (`1`) or clockwise (`-1`).
 * @returns {number} Directed angular distance in [0, one full turn).
 */
const directed_sweep_delta = (from_angle, to_angle, direction) => {
  const directed_delta = direction * (to_angle - from_angle);
  return ((directed_delta % FULL_TURN) + FULL_TURN) % FULL_TURN;
};

/**
 * Sample an orbit by sweeping angle around the supplied radial origin and
 * interpolating the distance from that origin between orbital points.
 *
 * @param {Array<{re: number, im: number}>} points Ordered orbital points.
 * @param {{re: number, im: number}} origin Center of the radial sweep.
 * @param {number|{samples_per_interval?:number}} samples_or_options Number of
 *   subdivisions, or stage options containing `samples_per_interval`.
 * @returns {Array<{t: number, C: {re: number, im: number}}>} Sampled path.
 */
export const parameterize_radial_sweep = (
  points,
  origin,
  samples_or_options = {},
) => {
  if (!Array.isArray(points) || points.length < 2 || !origin) {
    return [];
  }
  const samples_per_interval =
    typeof samples_or_options === "number"
      ? samples_or_options
      : samples_or_options?.samples_per_interval ??
        DEFAULT_SAMPLES_PER_INTERVAL;
  const polar_points = points.map((point) => ({
    angle: Math.atan2(point.im - origin.im, point.re - origin.re),
    radius: magnitude(sub(point, origin)),
  }));
  const direction = get_rotation_direction(points, origin);
  const sweep_positions = [0];
  for (let index = 1; index < polar_points.length; index += 1) {
    const delta = directed_sweep_delta(
      polar_points[index - 1].angle,
      polar_points[index].angle,
      direction,
    );
    sweep_positions.push(sweep_positions[index - 1] + Math.max(delta, 1e-9));
  }
  const closing_delta = directed_sweep_delta(
    polar_points[polar_points.length - 1].angle,
    polar_points[0].angle,
    direction,
  );
  const period = sweep_positions.at(-1) + Math.max(closing_delta, 1e-9);
  const interval_count = Math.max(1, Math.floor(samples_per_interval));
  const sample_count = polar_points.length * interval_count + 1;
  return Array.from({ length: sample_count }, (_, index) => {
    if (index === sample_count - 1) {
      return {
        t: polar_points[0].angle,
        C: { re: points[0].re, im: points[0].im },
      };
    }
    const segment = Math.floor(index / interval_count);
    const local_index = index % interval_count;
    const start = sweep_positions[segment];
    const end =
      segment === sweep_positions.length - 1
        ? period
        : sweep_positions[segment + 1];
    const local = local_index / interval_count;
    const sweep = start + (end - start) * local;
    const radius_at = (offset) =>
      polar_points[
        (segment + offset + polar_points.length) % polar_points.length
      ].radius;
    const radius = Math.max(
      0,
      0.5 *
        (2 * radius_at(0) +
          (-radius_at(-1) + radius_at(1)) * local +
          (2 * radius_at(-1) -
            5 * radius_at(0) +
            4 * radius_at(1) -
            radius_at(2)) *
            local ** 2 +
          (-radius_at(-1) +
            3 * radius_at(0) -
            3 * radius_at(1) +
            radius_at(2)) *
            local ** 3),
    );
    const angle = polar_points[0].angle + direction * sweep;
    return {
      t: angle,
      C: {
        re: origin.re + radius * Math.cos(angle),
        im: origin.im + radius * Math.sin(angle),
      },
    };
  });
};

/**
 * Backward-compatible name for the radial-sweep pipeline stage.
 *
 * @param {Array<{re:number,im:number}>} points Ordered orbital points.
 * @param {{re:number,im:number}} origin Radial-sweep origin Q.
 * @param {number|{samples_per_interval?:number}} samples_or_options Sampling
 *   count or options object.
 * @returns {Array<{t:number,C:{re:number,im:number}>}]} Sampled path.
 */
export const sample_radial_sweep = (
  points,
  origin,
  samples_or_options = {},
) => parameterize_radial_sweep(points, origin, samples_or_options);
