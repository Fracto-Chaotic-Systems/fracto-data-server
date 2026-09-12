const DEFAULT_MINIMUM_REPETITIONS = 5;
const MAX_MINIMUM_REPETITIONS = 64;
const MINIMUM_RADIUS_GAP_RATIO = 10;

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
    confidence_margin,
    ambiguous: recurrence_quality < 0.5 || confidence_margin < 0.1,
    alternatives: ranked.slice(1, 6).map((candidate) => ({
      cardinality: candidate.gap,
      matching_gaps: candidate.indexes.length,
      recurrence_error: candidate.recurrence_error,
      harmonic: candidate.gap % cardinality === 0,
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
      0.2 * radius_stability +
      0.1 * Math.min(1, recurrence),
  };
};
