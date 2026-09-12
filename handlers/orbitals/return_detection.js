const DEFAULT_MINIMUM_REPETITIONS = 5;
const MAX_MINIMUM_REPETITIONS = 64;
const MINIMUM_RADIUS_GAP_RATIO = 10;
const DERIVATIVE_PYRAMID_CYCLES = 10;

const greatest_common_divisor = (left, right) => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
};

/**
 * Measure sign coherence in the finite-difference pyramid sampled every N
 * iterations. Alternating signs between layers are expected; a sign change
 * within one layer indicates a wavering candidate progression.
 *
 * @param {Array<object>} samples Critical-orbit samples.
 * @param {number} gap Candidate cardinality.
 * @param {Map<number, object>} sample_by_iteration Samples indexed by iteration.
 * @returns {{coherence:number,layers:number,sign_changes:number,sample_count:number}} Pyramid diagnostics.
 */
const derivative_pyramid = (samples, gap, sample_by_iteration) => {
  const values = [];
  const first_iteration = samples[0]?.iteration;
  if (!Number.isFinite(first_iteration)) {
    return { coherence: 0, layers: 0, sign_changes: 0, sample_count: 0 };
  }
  for (let cycle = 0; cycle <= DERIVATIVE_PYRAMID_CYCLES; cycle += 1) {
    const sample = sample_by_iteration.get(first_iteration + cycle * gap);
    if (!sample) break;
    values.push(sample.radius);
  }
  if (values.length < 3) {
    return { coherence: 0, layers: 0, sign_changes: 0, sample_count: values.length };
  }
  let layer = values;
  let coherent_layers = 0;
  let sign_changes = 0;
  while (layer.length > 1) {
    const differences = layer.slice(1).map((value, index) => value - layer[index]);
    const scale = Math.max(...differences.map((value) => Math.abs(value)), 0);
    const epsilon = Math.max(scale * 1e-12, 1e-30);
    const signs = differences
      .filter((value) => Math.abs(value) > epsilon)
      .map((value) => Math.sign(value));
    if (signs.length > 0) {
      const positive = signs.filter((sign) => sign > 0).length;
      const negative = signs.length - positive;
      if (positive === 0 || negative === 0) coherent_layers += 1;
      sign_changes += Math.min(positive, negative);
    }
    layer = differences;
  }
  const layers = values.length - 1;
  return {
    coherence: coherent_layers / Math.max(1, layers),
    layers,
    sign_changes,
    sample_count: values.length,
  };
};

/**
 * Sieve possible cardinalities by requiring sign consistency at every
 * derivative-pyramid level. This is intentionally separate from the mature
 * recurrence detector so its performance and false-elimination behavior can
 * be measured independently.
 *
 * @param {Array<object>} samples Critical-orbit samples with origin radius.
 * @param {{minimum_cycles?:number,max_cardinality?:number,noise_factor?:number}} [options]
 *   Contender-sieve controls.
 * @returns {object} Surviving contenders, elimination counts, and timing.
 */
export const detect_pyramid_contenders = (samples, options = {}) => {
  const started = performance.now();
  const minimum_cycles = Math.max(2, Math.floor(Number(options.minimum_cycles) || 10));
  const max_cardinality = Math.min(
    Math.floor((samples.length - 1) / minimum_cycles),
    Math.max(3, Math.floor(Number(options.max_cardinality) || 4096)),
  );
  const noise_factor = Math.max(1, Number(options.noise_factor) || 64);
  const sample_by_iteration = new Map(
    samples.map((sample) => [sample.iteration, sample]),
  );
  const first_iteration = samples[0]?.iteration;
  const survivors = [];
  let eliminated = 0;
  let insufficient = 0;
  for (let cardinality = 3; cardinality <= max_cardinality; cardinality += 1) {
    const values = [];
    for (let cycle = 0; cycle <= minimum_cycles; cycle += 1) {
      const sample = sample_by_iteration.get(first_iteration + cycle * cardinality);
      if (!sample) break;
      values.push(sample.radius);
    }
    if (values.length < minimum_cycles + 1) {
      insufficient += 1;
      continue;
    }
    let layer = values;
    let coherent_layers = 0;
    let sign_changes = 0;
    let rejected = false;
    while (layer.length > 1 && !rejected) {
      const differences = layer.slice(1).map((value, index) => value - layer[index]);
      const scale = Math.max(...differences.map((value) => Math.abs(value)), 0);
      const epsilon = Math.max(
        Number.EPSILON * noise_factor * Math.max(1, scale),
        1e-30,
      );
      const signs = differences
        .filter((value) => Math.abs(value) > epsilon)
        .map((value) => Math.sign(value));
      if (signs.length > 0) {
        const positive = signs.filter((sign) => sign > 0).length;
        const negative = signs.length - positive;
        if (positive > 0 && negative > 0) {
          sign_changes += Math.min(positive, negative);
          rejected = true;
        } else {
          coherent_layers += 1;
        }
      }
      layer = differences;
    }
    if (rejected) {
      eliminated += 1;
    } else {
      survivors.push({
        cardinality,
        cycles: values.length - 1,
        pyramid_layers: coherent_layers,
        sign_changes,
      });
    }
  }
  return {
    status: survivors.length ? "pyramid_contenders_found" : "pyramid_inconclusive",
    minimum_cycles,
    max_cardinality,
    noise_factor,
    contender_count: Math.max(0, max_cardinality - 2),
    eliminated_count: eliminated,
    insufficient_count: insufficient,
    survivor_count: survivors.length,
    survivors,
    elapsed_ms: performance.now() - started,
  };
};

/**
 * Detect a cardinality from repeated near-zero returns of a critical orbit.
 *
 * @param {Array<{iteration:number,radius:number}>} samples Critical-orbit samples;
 *   `radius` is the origin-based magnitude `|z|`.
 * @param {{minimum_return_repetitions?:number}} [options] Detection controls.
 * @returns {object} Candidate cardinality, supporting minima, and confidence.
 */
export const detect_return_cardinality = (samples, options = {}) => {
  const requested_repetitions = Number(options.minimum_return_repetitions);
  const minimum_repetitions = Math.min(
    MAX_MINIMUM_REPETITIONS,
    Math.max(
      DEFAULT_MINIMUM_REPETITIONS,
      Math.floor(requested_repetitions) || DEFAULT_MINIMUM_REPETITIONS,
    ),
  );
  const minima = samples.filter(
    (sample, index) =>
      index > 0 &&
      index < samples.length - 1 &&
      sample.radius <= samples[index - 1].radius &&
      sample.radius < samples[index + 1].radius,
  );
  const radius_sorted = [...minima].sort((left, right) => left.radius - right.radius);
  let return_minima = minima;
  let largest_radius_gap = 0;
  let radius_gap_index = -1;
  for (let index = 1; index < radius_sorted.length; index += 1) {
    const ratio = radius_sorted[index].radius / Math.max(radius_sorted[index - 1].radius, 1e-30);
    if (ratio > largest_radius_gap) {
      largest_radius_gap = ratio;
      radius_gap_index = index;
    }
  }
  if (largest_radius_gap >= MINIMUM_RADIUS_GAP_RATIO) {
    const radius_limit = Math.sqrt(
      radius_sorted[radius_gap_index - 1].radius *
        radius_sorted[radius_gap_index].radius,
    );
    return_minima = minima.filter((sample) => sample.radius <= radius_limit);
  }
  const gap_groups = new Map();
  // Radius minima can alternate between sub-gaps (for example 3 and 4) even
  // when the actual orbit returns every 7 iterations. Compare nearby minima
  // pairs so composite periods are not discarded as noise.
  // A 28-cycle can contain nine alternating radius minima before the same
  // phase is revisited; allow enough intervening minima to expose that full
  // composite gap while keeping candidate generation bounded.
  const MAX_MINIMA_PAIR_DISTANCE = 24;
  for (let index = 1; index < return_minima.length; index += 1) {
    for (
      let previous_index = Math.max(0, index - MAX_MINIMA_PAIR_DISTANCE);
      previous_index < index;
      previous_index += 1
    ) {
      const gap =
        return_minima[index].iteration -
        return_minima[previous_index].iteration;
      if (gap > 0) {
        const group = gap_groups.get(gap) || [];
        group.push([previous_index, index]);
        gap_groups.set(gap, group);
      }
    }
  }
  const sample_by_iteration = new Map(
    samples.map((sample) => [sample.iteration, sample]),
  );
  const recurrence_start = Math.floor(samples.length * 0.5);
  const tail_samples = samples.slice(recurrence_start);
  const tail_step_errors = tail_samples
    .slice(1)
    .map((sample, index) => {
      const previous = tail_samples[index];
      return Math.hypot(sample.re - previous.re, sample.im - previous.im);
    })
    .sort((left, right) => left - right);
  const baseline_error =
    tail_step_errors[Math.floor(tail_step_errors.length / 2)] || 1;
  const ranked = [...gap_groups.entries()]
    // Do not spend a tail-wide recurrence pass on gaps that cannot satisfy
    // the repetition requirement in the first place.
    .filter(([, indexes]) => indexes.length >= minimum_repetitions)
    .map(([gap, indexes]) => {
      // Minima identify plausible periods, but their locations can be
      // transient. Validate each gap against every available tail sample so
      // a true return (such as 28 here) outranks a coincidental minima gap.
      const errors = tail_samples
        .map((current) => {
          const previous = sample_by_iteration.get(current.iteration - gap);
          return previous
            ? Math.hypot(current.re - previous.re, current.im - previous.im)
            : null;
        })
        .filter((error) => error !== null)
        .sort((left, right) => left - right);
      return {
        gap,
        indexes,
        recurrence_error: errors[Math.floor(errors.length / 2)] ?? Infinity,
        pyramid: derivative_pyramid(samples, gap, sample_by_iteration),
      };
    })
    .sort(
      (left, right) =>
        left.recurrence_error - right.recurrence_error ||
        right.indexes.length - left.indexes.length,
    );
  const best = ranked[0];
  if (!best) {
    return {
      status: "inconclusive",
      minimum_return_repetitions: minimum_repetitions,
      minima,
      candidate_cardinality: null,
      matching_gaps: 0,
    };
  }
  const cardinality = best.gap;
  // Integer multiples are expected harmonics of the same return period, not
  // independent competing explanations. Exclude them from the ambiguity
  // margin while retaining them in the diagnostics below.
  const competing_candidates = ranked
    .slice(1)
    .filter((candidate) => candidate.gap % cardinality !== 0);
  const next_best = competing_candidates[0];
  const recurrence_quality = Math.max(
    0,
    Math.min(1, 1 - best.recurrence_error / Math.max(baseline_error, 1e-30)),
  );
  const confidence_margin = next_best
    ? Math.max(
        0,
        Math.min(
          1,
          (next_best.recurrence_error - best.recurrence_error) /
            Math.max(next_best.recurrence_error, 1e-30),
        ),
      )
    : 1;
  const matching_minima = [
    return_minima[best.indexes[0][0]],
    ...best.indexes.map((pair) => return_minima[pair[1]]),
  ];
  const radii = matching_minima.map((sample) => sample.radius);
  const minimum_radius = Math.min(...radii);
  const maximum_radius = Math.max(...radii);
  const radius_stability =
    1 -
    Math.min(
      1,
      (maximum_radius - minimum_radius) / Math.max(maximum_radius, 1e-30),
    );
  const recurrence = Math.min(1, best.indexes.length / minimum_repetitions);
  return {
    status: "return_pattern_detected",
    minimum_return_repetitions: minimum_repetitions,
    candidate_cardinality: cardinality,
    matching_gaps: best.indexes.length,
    recurrence_error: best.recurrence_error,
    recurrence_baseline_error: baseline_error,
    recurrence_quality,
    pyramid_coherence: best.pyramid.coherence,
    pyramid_layers: best.pyramid.layers,
    pyramid_sign_changes: best.pyramid.sign_changes,
    confidence_margin,
    ambiguous:
      recurrence_quality < 0.5 ||
      confidence_margin < 0.1 ||
      best.pyramid.coherence < 0.5,
    alternatives: ranked.slice(1, 6).map((candidate) => ({
      cardinality: candidate.gap,
      matching_gaps: candidate.indexes.length,
      recurrence_error: candidate.recurrence_error,
      harmonic: candidate.gap % cardinality === 0,
      pyramid_coherence: candidate.pyramid.coherence,
      pyramid_layers: candidate.pyramid.layers,
      pyramid_sign_changes: candidate.pyramid.sign_changes,
    })),
    gap_gcd: best.indexes.reduce(
      (result, index) =>
        greatest_common_divisor(
          result,
          return_minima[index[1]].iteration - return_minima[index[0]].iteration,
        ),
      0,
    ),
    minima,
    matching_minima,
    minimum_radius,
    maximum_radius,
    radius_stability,
    recurrence,
    confidence:
      0.4 * recurrence_quality +
      0.3 * confidence_margin +
      0.1 * radius_stability +
      0.1 * best.pyramid.coherence +
      0.1 * Math.min(1, recurrence),
  };
};
