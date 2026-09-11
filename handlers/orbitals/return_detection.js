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
 * @param {Array<{iteration:number,radius:number}>} samples Critical-orbit samples.
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
  for (let index = 1; index < return_minima.length; index += 1) {
    const gap =
      return_minima[index].iteration - return_minima[index - 1].iteration;
    if (gap > 0) {
      const group = gap_groups.get(gap) || [];
      group.push(index);
      gap_groups.set(gap, group);
    }
  }
  const ranked = [...gap_groups.entries()].sort(
    (left, right) => right[1].length - left[1].length,
  );
  const best = ranked[0];
  if (!best || best[1].length < minimum_repetitions) {
    return {
      status: "inconclusive",
      minimum_return_repetitions: minimum_repetitions,
      minima,
      candidate_cardinality: null,
      matching_gaps: best?.[1].length || 0,
    };
  }
  const cardinality = best[0];
  const matching_minima = [
      return_minima[best[1][0] - 1],
    ...best[1].map((index) => return_minima[index]),
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
  const recurrence = Math.min(1, best[1].length / minimum_repetitions);
  return {
    status: "return_pattern_detected",
    minimum_return_repetitions: minimum_repetitions,
    candidate_cardinality: cardinality,
    matching_gaps: best[1].length,
    gap_gcd: best[1].reduce(
      (result, index) => greatest_common_divisor(result, minima[index].iteration - minima[index - 1].iteration),
      0,
    ),
    minima,
    matching_minima,
    minimum_radius,
    maximum_radius,
    radius_stability,
    recurrence,
    confidence: 0.5 * Math.min(1, recurrence) + 0.5 * radius_stability,
  };
};
