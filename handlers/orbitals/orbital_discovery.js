import BigComplex from "../../../../sdk/math/BigComplex.js";
import { analyze_polar_spectrum } from "./spectral_analysis.js";

const DEFAULT_ITERATIONS = 4096;
// The default warm-up remains fixed for predictable requests. Callers may use
// a bounded override when comparing spectral stability at several horizons.
const DEFAULT_WARMUP_ITERATIONS = 4096;
const MAX_WARMUP_ITERATIONS = 262_144;
const MAX_ITERATIONS = 1_000_000;
const DEFAULT_SAMPLE_LIMIT = 512;
const MAX_SAMPLE_LIMIT = 4096;
const NATIVE_PRECISION_GUARD = 64;
const MIN_HIGH_PRECISION = 80;
const MAX_HIGH_PRECISION = 512;
const HIGH_PRECISION_GUARD_DIGITS = 16;

// TODO: Replace the retry loop with a predictive precision estimate based on
// |2Q|, the last reliable native radius, and the planned spectral window.

/**
 * Calculate the principal square root of a complex value.
 *
 * @param {{re: number, im: number}} point Complex value.
 * @returns {{re: number, im: number}} Principal square root.
 */
const complex_sqrt = (point) => {
  const magnitude = Math.hypot(point.re, point.im);
  const re = Math.sqrt(Math.max(0, (magnitude + point.re) / 2));
  const im = Math.sqrt(Math.max(0, (magnitude - point.re) / 2));
  return { re, im: point.im < 0 ? -im : im };
};

/**
 * Calculate the attracting fixed point Q associated with a Mandelbrot seed.
 *
 * @param {{re: number, im: number}} point Mandelbrot parameter c.
 * @returns {{re: number, im: number}} Q = (1 - sqrt(1 - 4c)) / 2.
 */
export const calculate_fixed_point = (point) => {
  const radical = complex_sqrt({
    re: 1 - 4 * point.re,
    im: -4 * point.im,
  });
  return { re: (1 - radical.re) / 2, im: -radical.im / 2 };
};

/**
 * Convert a critical-orbit point into polar coordinates around Q, preserving
 * a continuously unwrapped angular value for later spectral analysis.
 *
 * @param {{re: number, im: number}} point Orbit point.
 * @param {{re: number, im: number}} origin Fixed point Q.
 * @param {number|null} previous_theta Previously unwrapped angle.
 * @returns {{radius: number, theta: number}} Polar sample.
 */
const to_polar_sample = (point, origin, previous_theta) => {
  const re = point.re - origin.re;
  const im = point.im - origin.im;
  const radius = Math.hypot(re, im);
  let theta = Math.atan2(im, re);
  if (previous_theta !== null) {
    while (theta - previous_theta > Math.PI) theta -= 2 * Math.PI;
    while (theta - previous_theta < -Math.PI) theta += 2 * Math.PI;
  }
  return { radius, theta };
};

/**
 * Determine whether native subtraction has lost meaningful separation from Q.
 *
 * @param {{re: number, im: number}} point Orbit point.
 * @param {{re: number, im: number}} origin Fixed point Q.
 * @returns {{relative_separation: number, needs_high_precision: boolean}}
 *   Relative separation and escalation decision.
 */
const native_precision_status = (point, origin) => {
  const separation = Math.hypot(point.re - origin.re, point.im - origin.im);
  const scale = Math.max(
    1,
    Math.hypot(point.re, point.im),
    Math.hypot(origin.re, origin.im),
  );
  const relative_separation = separation / scale;
  return {
    relative_separation,
    needs_high_precision:
      relative_separation <= Number.EPSILON * NATIVE_PRECISION_GUARD,
  };
};

/**
 * Estimate a useful starting precision from a native separation measurement.
 *
 * @param {number} relative_separation Relative distance from Q.
 * @returns {number} Decimal digits for the first high-precision pass.
 */
const estimate_precision = (relative_separation) => {
  if (!Number.isFinite(relative_separation) || relative_separation <= 0) {
    return MIN_HIGH_PRECISION;
  }
  return Math.min(
    MAX_HIGH_PRECISION,
    Math.max(
      MIN_HIGH_PRECISION,
      Math.ceil(-Math.log10(relative_separation)) + 32,
    ),
  );
};

/**
 * Convert a high-precision displacement into a regular-precision polar sample.
 * Scaling before conversion preserves the angle even when both components are
 * too small to convert directly to native numbers.
 *
 * @param {BigComplex} displacement Point minus Q.
 * @param {number|null} previous_theta Previous unwrapped angle.
 * @returns {{radius: number, radius_decimal: string, theta: number}}
 *   Polar sample with a regular-precision angle.
 */
const to_high_precision_polar_sample = (displacement, previous_theta) => {
  const absolute_re = displacement.re.abs();
  const absolute_im = displacement.im.abs();
  const scale = absolute_re.gt(absolute_im) ? absolute_re : absolute_im;
  const radius_decimal = displacement.magnitude().toString();
  if (scale.isZero()) {
    return { radius: 0, radius_decimal, theta: previous_theta || 0 };
  }
  const normalized_re = displacement.re.div(scale).toNumber();
  const normalized_im = displacement.im.div(scale).toNumber();
  let theta = Math.atan2(normalized_im, normalized_re);
  if (previous_theta !== null) {
    while (theta - previous_theta > Math.PI) theta -= 2 * Math.PI;
    while (theta - previous_theta < -Math.PI) theta += 2 * Math.PI;
  }
  return {
    radius: Number(radius_decimal),
    radius_decimal,
    theta,
  };
};

/**
 * Recompute the scout at a specified Decimal precision.
 *
 * @param {{re: number|string, im: number|string}} point Mandelbrot parameter.
 * @param {number} iterations Number of orbit steps.
 * @param {number} warmup_iterations Steps to run before collecting samples.
 * @param {number} sample_limit Maximum returned samples.
 * @param {number} precision Decimal precision.
 * @returns {object} High-precision samples and escalation metadata.
 */
const discover_high_precision = (
  point,
  iterations,
  sample_limit,
  precision,
  warmup_iterations,
) => {
  const parameter = new BigComplex(point.re, point.im, precision);
  const fixed_point = new BigComplex(1, 0, precision)
    .add(parameter.scale(-4).offset(1, 0).sqrt().scale(-1))
    .scale(0.5);
  const threshold = new parameter.Decimal(10).pow(
    -(precision - HIGH_PRECISION_GUARD_DIGITS),
  );
  const sample_stride = Math.max(1, Math.ceil(iterations / sample_limit));
  const samples = [];
  let orbit_point = new BigComplex(0, 0, precision);
  let previous_theta = null;
  let needs_more_precision = false;
  let minimum_relative_separation = null;

  for (let warmup = 0; warmup < warmup_iterations; warmup += 1) {
    orbit_point = orbit_point.mandelbrot(parameter);
  }

  for (let iteration = 0; iteration <= iterations; iteration += 1) {
    const displacement = orbit_point.add(fixed_point.scale(-1));
    const separation = displacement.magnitude();
    const point_scale = Math.max(
      1,
      orbit_point.magnitude().toNumber(),
      fixed_point.magnitude().toNumber(),
    );
    const relative_separation = separation.div(point_scale);
    if (
      minimum_relative_separation === null ||
      relative_separation.lt(minimum_relative_separation)
    ) {
      minimum_relative_separation = relative_separation;
    }
    if (relative_separation.lte(threshold)) {
      needs_more_precision = true;
    }
    if (iteration % sample_stride === 0 || iteration === iterations) {
      const polar = to_high_precision_polar_sample(
        displacement,
        previous_theta,
      );
      previous_theta = polar.theta;
      samples.push({ iteration: warmup_iterations + iteration, ...polar });
    }
    orbit_point = orbit_point.mandelbrot(parameter);
  }

  return {
    samples,
    sample_stride,
    warmup_iterations,
    precision,
    Q_decimal: {
      re: fixed_point.re.toString(),
      im: fixed_point.im.toString(),
    },
    needs_more_precision,
    minimum_relative_separation: minimum_relative_separation?.toString(),
  };
};

/**
 * Perform the initial orbital-discovery scout with adaptive precision.
 *
 * This deliberately stops short of assigning a cardinality. It samples the
 * critical orbit from z=0, centered on Q, and returns the radial and angular
 * signals that the Fourier candidate stage will consume later. Native
 * evaluation is used first; if the displacement from Q approaches native
 * resolution, the entire orbit is recomputed with BigComplex.
 *
 * @param {{re: number|string, im: number|string}} point Mandelbrot parameter.
 * @param {{iterations?: number, sample_limit?: number, warmup_iterations?: number}} options Scout limits.
 * @returns {object} Discovery metadata and bounded polar-orbit samples.
 */
export const discover_orbital = (point, options = {}) => {
  const native_point = { re: Number(point.re), im: Number(point.im) };
  const iterations = Math.min(
    MAX_ITERATIONS,
    Math.max(1, Math.floor(Number(options.iterations) || DEFAULT_ITERATIONS)),
  );
  const sample_limit = Math.min(
    MAX_SAMPLE_LIMIT,
    Math.max(
      1,
      Math.floor(Number(options.sample_limit) || DEFAULT_SAMPLE_LIMIT),
    ),
  );
  const requested_warmup = Number(options.warmup_iterations);
  const warmup_iterations = Number.isFinite(requested_warmup)
    ? Math.min(MAX_WARMUP_ITERATIONS, Math.max(0, Math.floor(requested_warmup)))
    : DEFAULT_WARMUP_ITERATIONS;
  const Q = calculate_fixed_point(native_point);
  const sample_stride = Math.max(1, Math.ceil(iterations / sample_limit));
  const samples = [];
  let z_re = 0;
  let z_im = 0;
  let previous_theta = null;
  let escaped = false;
  let native_precision_trigger = null;

  for (
    let warmup = 0;
    warmup < warmup_iterations;
    warmup += 1
  ) {
    const precision_status = native_precision_status({ re: z_re, im: z_im }, Q);
    if (precision_status.needs_high_precision) {
      native_precision_trigger = {
        iteration: warmup,
        relative_separation: precision_status.relative_separation,
      };
      break;
    }
    const next_re = z_re * z_re - z_im * z_im + native_point.re;
    z_im = 2 * z_re * z_im + native_point.im;
    z_re = next_re;
  }

  for (
    let iteration = 0;
    iteration <= iterations && !native_precision_trigger;
    iteration += 1
  ) {
    const precision_status = native_precision_status({ re: z_re, im: z_im }, Q);
    if (precision_status.needs_high_precision) {
      native_precision_trigger = {
        iteration,
        relative_separation: precision_status.relative_separation,
      };
      break;
    }
    if (iteration % sample_stride === 0 || iteration === iterations) {
      const polar = to_polar_sample({ re: z_re, im: z_im }, Q, previous_theta);
      previous_theta = polar.theta;
      samples.push({
        iteration: warmup_iterations + iteration,
        ...polar,
      });
    }
    if (!Number.isFinite(z_re) || !Number.isFinite(z_im)) {
      escaped = true;
      break;
    }
    const next_re = z_re * z_re - z_im * z_im + native_point.re;
    z_im = 2 * z_re * z_im + native_point.im;
    z_re = next_re;
  }

  if (native_precision_trigger) {
    let precision = estimate_precision(
      native_precision_trigger.relative_separation,
    );
    let high_precision_result = discover_high_precision(
      point,
      iterations,
      sample_limit,
      precision,
      warmup_iterations,
    );
    // TODO: Keep this retry as a safety net until predictive precision sizing
    // and a final angular-error verification pass are implemented.
    while (
      high_precision_result.needs_more_precision &&
      precision < MAX_HIGH_PRECISION
    ) {
      precision = Math.min(MAX_HIGH_PRECISION, precision * 2);
      high_precision_result = discover_high_precision(
        point,
        iterations,
        sample_limit,
        precision,
        warmup_iterations,
      );
    }
    return {
      point: native_point,
      point_input: { re: String(point.re), im: String(point.im) },
      Q,
      iterations,
      warmup_iterations,
      sample_stride: high_precision_result.sample_stride,
      samples: high_precision_result.samples,
      escaped: false,
      Q_decimal: high_precision_result.Q_decimal,
      candidate_cardinality: null,
      status: "polar_scout_complete",
      precision_mode: "big_complex",
      precision_digits: high_precision_result.precision,
      precision_escalated: true,
      precision_limit_reached:
        high_precision_result.needs_more_precision &&
        high_precision_result.precision >= MAX_HIGH_PRECISION,
      native_precision_trigger,
      minimum_relative_separation:
        high_precision_result.minimum_relative_separation,
      spectrum: analyze_polar_spectrum(
        high_precision_result.samples,
        high_precision_result.sample_stride,
        options,
      ),
    };
  }

  return {
    point: native_point,
    point_input: { re: String(point.re), im: String(point.im) },
    Q,
    iterations,
    warmup_iterations,
    sample_stride,
    samples,
    escaped,
    candidate_cardinality: null,
    status: "polar_scout_complete",
    precision_mode: "native",
    precision_digits: 15,
    precision_escalated: false,
    precision_limit_reached: false,
    native_precision_trigger: null,
    spectrum: analyze_polar_spectrum(samples, sample_stride, options),
  };
};

// TODO: Validate spectral candidates with dynatomic deflation and exact-period
// Newton refinement before presenting them as discovered cardinalities.
