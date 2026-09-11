import { performance } from "node:perf_hooks";

const DEFAULT_ANALYSIS_START = 0.25;
const DEFAULT_PEAK_COUNT = 8;
const DEFAULT_MAX_CANDIDATE_PERIOD = 4096;
const MAX_PEAK_COUNT = 32;
const MIN_ANALYSIS_SAMPLES = 4;
// A candidate must complete this many cycles in the analyzed window before
// it is treated as a trustworthy cardinality. Larger periods remain in the
// raw spectrum for diagnostics but are not promoted as candidates.
const MIN_OBSERVED_CYCLES = 5;

/**
 * Stable configuration contract for one spectral-analysis pass. `null` for
 * window_length means that the complete eligible sample window is used.
 */
export const DEFAULT_SPECTRAL_ANALYSIS_CONFIG = Object.freeze({
  sample_stride: 1,
  window_length: null,
  analysis_start: DEFAULT_ANALYSIS_START,
  minimum_samples: MIN_ANALYSIS_SAMPLES,
});

/**
 * Bounded default passes for multi-configuration spectral analysis. Strides
 * are pairwise coprime and window lengths are nearby primes, reducing the
 * chance that one bin alignment dominates the consensus result. These are
 * configuration records only; orchestration is deliberately added later.
 */
const DEFAULT_MULTI_ANALYSIS_BASE = [
  { sample_stride: 1, window_length: 251 },
  { sample_stride: 2, window_length: 257 },
  { sample_stride: 3, window_length: 263 },
  { sample_stride: 5, window_length: 269 },
  { sample_stride: 7, window_length: 277 },
  { sample_stride: 11, window_length: 283 },
];
const DEFAULT_MULTI_ANALYSIS_STARTS = [0, 0.1, 0.2];

export const DEFAULT_MULTI_ANALYSIS_CONFIGS = Object.freeze(
  DEFAULT_MULTI_ANALYSIS_BASE.flatMap((base) =>
    DEFAULT_MULTI_ANALYSIS_STARTS.map((analysis_start) =>
      Object.freeze({
        ...DEFAULT_SPECTRAL_ANALYSIS_CONFIG,
        ...base,
        analysis_start,
      }),
    ),
  ),
);

/** Larger prime windows used by the first bounded adaptive retry. */
export const ADAPTIVE_MULTI_ANALYSIS_CONFIGS = Object.freeze(
  DEFAULT_MULTI_ANALYSIS_BASE.flatMap((base, index) =>
    DEFAULT_MULTI_ANALYSIS_STARTS.map((analysis_start) =>
      Object.freeze({
        ...DEFAULT_SPECTRAL_ANALYSIS_CONFIG,
        sample_stride: base.sample_stride,
        window_length: [509, 521, 541, 557, 569, 587][index],
        analysis_start,
      }),
    ),
  ),
);

/**
 * Normalize a requested spectral-analysis configuration without applying it.
 * Keeping this step separate allows multi-configuration analysis to validate
 * every pass consistently before sampling or transforming any data.
 *
 * @param {object} [options] Requested configuration values.
 * @returns {{sample_stride:number, window_length:number|null, analysis_start:number, minimum_samples:number}}
 *   Bounded, normalized analysis configuration.
 */
export const normalize_spectral_analysis_config = (options = {}) => {
  const requested_window = Number(options.window_length);
  const requested_start = Number(options.analysis_start);
  const requested_minimum = Number(options.minimum_samples);
  return {
    sample_stride: Math.max(
      1,
      Math.floor(
        Number(options.sample_stride) ||
          DEFAULT_SPECTRAL_ANALYSIS_CONFIG.sample_stride,
      ),
    ),
    window_length:
      Number.isFinite(requested_window) && requested_window > 0
        ? Math.floor(requested_window)
        : DEFAULT_SPECTRAL_ANALYSIS_CONFIG.window_length,
    analysis_start: Number.isFinite(requested_start)
      ? Math.max(0, Math.min(0.9, requested_start))
      : DEFAULT_SPECTRAL_ANALYSIS_CONFIG.analysis_start,
    minimum_samples:
      Number.isFinite(requested_minimum) &&
      requested_minimum >= MIN_ANALYSIS_SAMPLES
        ? Math.floor(requested_minimum)
        : DEFAULT_SPECTRAL_ANALYSIS_CONFIG.minimum_samples,
  };
};

/**
 * Analyze one shared sample set with several configurations. The input samples
 * must be dense enough for the requested strides; passes that cannot be formed
 * exactly from the available cadence are still returned with their natural
 * reduced sample set so callers can inspect the limitation.
 *
 * @param {Array<object>} samples Polar orbit samples from one discovery run.
 * @param {number} base_sample_stride Iterations represented by adjacent input samples.
 * @param {Array<object>} [configs] Configurations to evaluate.
 * @param {object} [options] Shared peak and candidate options.
 * @returns {Array<object>} One result record for each configuration.
 */
export const analyze_multi_polar_spectrum = (
  samples,
  base_sample_stride,
  configs = DEFAULT_MULTI_ANALYSIS_CONFIGS,
  options = {},
) =>
  configs.map((requested_config) => {
    const started = performance.now();
    const config = normalize_spectral_analysis_config(requested_config);
    const stride_ratio = config.sample_stride / Math.max(1, base_sample_stride);
    const selected_samples =
      Number.isInteger(stride_ratio) && stride_ratio >= 1
        ? samples.filter((_, index) => index % stride_ratio === 0)
        : samples.filter(
            (sample, index) =>
              index === 0 ||
              (sample.iteration - samples[0].iteration) %
                config.sample_stride ===
                0,
          );
    const spectrum = analyze_polar_spectrum(
      selected_samples,
      config.sample_stride,
      { ...options, ...config },
    );
    return {
      ...config,
      sample_count: selected_samples.length,
      elapsed_ms: performance.now() - started,
      spectrum,
    };
  });

/**
 * Merge peak observations from independent spectral passes by normalized
 * frequency. This deliberately does not rank or validate candidates; it only
 * consolidates observations that are indistinguishable at their pass's
 * frequency resolution.
 *
 * @param {Array<object>} runs Results returned by analyze_multi_polar_spectrum.
 * @param {{frequency_tolerance?: number}} [options] Merge options.
 * @returns {Array<object>} Frequency clusters with their source observations.
 */
export const merge_spectral_candidates = (runs, options = {}) => {
  const requested_tolerance = Number(options.frequency_tolerance);
  const observations = runs.flatMap((run) => {
    const spectrum = run.spectrum || run;
    const resolution =
      1 / Math.max(1, (spectrum.sample_count || 0) * (spectrum.sample_stride || 1));
    return (spectrum.peaks || [])
      .filter((peak) => Number.isFinite(peak.frequency_cycles_per_iteration))
      .map((peak) => ({
        frequency_cycles_per_iteration: peak.frequency_cycles_per_iteration,
        power: Number.isFinite(peak.power) ? peak.power : 0,
        cardinality: peak.cardinality ?? null,
        cycles: peak.cycles ?? null,
        rational_error: peak.rational_error ?? null,
        trustworthy: peak.trustworthy === true,
        maximum_trustworthy_cardinality:
          spectrum.maximum_trustworthy_cardinality ?? null,
        configuration: {
          sample_stride: run.sample_stride ?? spectrum.sample_stride,
          window_length: run.window_length ?? null,
          analysis_start:
            run.analysis_start ?? spectrum.analysis_config?.analysis_start,
        },
        resolution,
      }));
  });
  observations.sort(
    (left, right) =>
      left.frequency_cycles_per_iteration -
      right.frequency_cycles_per_iteration,
  );
  const clusters = [];
  observations.forEach((observation) => {
    const previous = clusters.at(-1);
    const tolerance =
      requested_tolerance > 0
        ? requested_tolerance
        : Math.max(observation.resolution, previous?.resolution || 0);
    if (
      previous &&
      Math.abs(
        observation.frequency_cycles_per_iteration -
          previous.frequency_cycles_per_iteration,
      ) <= tolerance
    ) {
      previous.observations.push(observation);
      previous.frequency_cycles_per_iteration =
        previous.observations.reduce(
          (sum, item) => sum + item.frequency_cycles_per_iteration,
          0,
        ) / previous.observations.length;
      previous.resolution = Math.max(previous.resolution, observation.resolution);
      return;
    }
    clusters.push({
      frequency_cycles_per_iteration:
        observation.frequency_cycles_per_iteration,
      resolution: observation.resolution,
      observations: [observation],
    });
  });
  return clusters.map((cluster) => ({
    frequency_cycles_per_iteration: cluster.frequency_cycles_per_iteration,
    resolution: cluster.resolution,
    occurrence_count: cluster.observations.length,
    configurations: cluster.observations.map((item) => item.configuration),
    cardinalities: cluster.observations
      .map((item) => item.cardinality)
      .filter((value) => Number.isInteger(value)),
    cycles: cluster.observations
      .map((item) => item.cycles)
      .filter((value) => Number.isInteger(value)),
    powers: cluster.observations.map((item) => item.power),
    rational_errors: cluster.observations
      .map((item) => item.rational_error)
      .filter((value) => Number.isFinite(value)),
    trustworthy_count: cluster.observations.filter((item) => item.trustworthy)
      .length,
    maximum_trustworthy_cardinality: Math.max(
      ...cluster.observations
        .map((item) => item.maximum_trustworthy_cardinality)
        .filter((value) => Number.isFinite(value)),
      0,
    ),
  }));
};

/**
 * Rank consensus candidates using recurrence and evidence quality. This is a
 * screening score, not proof of an exact orbital period.
 *
 * @param {Array<object>} candidates Merged frequency candidates.
 * @param {number} total_runs Number of independent analysis passes.
 * @returns {Array<object>} Candidates sorted by descending composite score.
 */
export const score_consensus_candidates = (candidates, total_runs) => {
  const run_count = Math.max(1, Number(total_runs) || 1);
  const maximum_power = Math.max(
    ...candidates.flatMap((candidate) => candidate.powers || []),
    0,
  );
  return candidates
    // A singleton observation is not accepted as a consensus candidate. It
    // remains visible in each run's spectrum for diagnostic inspection.
    .filter((candidate) => candidate.occurrence_count >= 2)
    .map((candidate) => {
      const recurrence = Math.min(1, candidate.occurrence_count / run_count);
      const peak_power = Math.max(...(candidate.powers || []), 0);
      const power = maximum_power > 0 ? peak_power / maximum_power : 0;
      const cardinality_values = candidate.cardinalities || [];
      const cardinality_counts = new Map();
      cardinality_values.forEach((value) =>
        cardinality_counts.set(value, (cardinality_counts.get(value) || 0) + 1),
      );
      const cardinality_consistency = cardinality_values.length
        ? Math.max(...cardinality_counts.values()) / cardinality_values.length
        : 0;
      const mean_error = candidate.rational_errors?.length
        ? candidate.rational_errors.reduce((sum, value) => sum + value, 0) /
          candidate.rational_errors.length
        : null;
      const error_quality =
        mean_error === null
          ? 0
          : Math.max(0, 1 - mean_error / Math.max(candidate.resolution, 1e-12));
      const trustworthy =
        candidate.occurrence_count > 0
          ? candidate.trustworthy_count / candidate.occurrence_count
          : 0;
      const score =
        0.35 * recurrence +
        0.25 * power +
        0.2 * cardinality_consistency +
        0.1 * error_quality +
        0.1 * trustworthy;
      return {
        ...candidate,
        score,
        confidence: score,
        score_components: {
          recurrence,
          power,
          cardinality_consistency,
          error_quality,
          trustworthy,
        },
      };
    })
    .sort((left, right) => right.score - left.score);
};

/** @param {number} left @param {number} right @returns {number} Greatest common divisor. */
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
 * Estimate the slope of an unwrapped phase sequence using least squares.
 *
 * @param {Array<{iteration: number, theta: number}>} samples Polar samples.
 * @returns {number} Radians per iteration.
 */
const estimate_phase_slope = (samples) => {
  const count = samples.length;
  const sum_x = samples.reduce((sum, sample) => sum + sample.iteration, 0);
  const sum_y = samples.reduce((sum, sample) => sum + sample.theta, 0);
  const sum_xx = samples.reduce(
    (sum, sample) => sum + sample.iteration * sample.iteration,
    0,
  );
  const sum_xy = samples.reduce(
    (sum, sample) => sum + sample.iteration * sample.theta,
    0,
  );
  const denominator = count * sum_xx - sum_x * sum_x;
  return denominator === 0 ? 0 : (count * sum_xy - sum_x * sum_y) / denominator;
};

/**
 * Calculate windowed DFT power for the complex unit phase signal e^(i theta).
 *
 * @param {Array<{theta: number}>} samples Polar samples.
 * @param {number} bin Frequency bin.
 * @returns {number} Normalized power.
 */
const dft_power = (samples, bin) => {
  const count = samples.length;
  let real = 0;
  let imaginary = 0;
  let window_power = 0;
  for (let index = 0; index < count; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (count - 1));
    const phase = samples[index].theta - (samples[0].theta || 0);
    const signal_re = Math.cos(phase);
    const signal_im = Math.sin(phase);
    const angle = (2 * Math.PI * bin * index) / count;
    real +=
      window * (signal_re * Math.cos(angle) + signal_im * Math.sin(angle));
    imaginary +=
      window * (signal_im * Math.cos(angle) - signal_re * Math.sin(angle));
    window_power += window * window;
  }
  return (real * real + imaginary * imaginary) / Math.max(window_power, 1);
};

/**
 * Rank reduced rational approximations to a frequency. Denominators are
 * candidate orbital cardinalities, not yet validated periods.
 *
 * @param {number} frequency Cycles per iteration in [0, 1).
 * @param {number} max_period Largest candidate denominator.
 * @param {number} resolution Frequency resolution of the sample window.
 * @returns {Array<{period: number, cardinality: number, cycles: number, error: number, confidence: number}>}
 *   Ranked rational frequency candidates. `cardinality` is the denominator
 *   and `cycles` is the reduced cycle count.
 */
const rational_candidates = (frequency, max_period, resolution) => {
  const candidates = [];
  for (let denominator = 2; denominator <= max_period; denominator += 1) {
    const cycles = Math.round(frequency * denominator);
    const error = Math.abs(frequency - cycles / denominator);
    if (cycles === 0 || cycles >= denominator) continue;
    const divisor = greatest_common_divisor(cycles, denominator);
    const reduced_cycles = cycles / divisor;
    const reduced_period = denominator / divisor;
    candidates.push({
      period: reduced_period,
      cardinality: reduced_period,
      cycles: reduced_cycles,
      error,
      confidence: 1 / (1 + error / Math.max(resolution, 1e-12)),
    });
  }
  const resolution_matches = candidates.filter(
    (candidate) => candidate.error <= resolution * 2,
  );
  const ranked = (resolution_matches.length ? resolution_matches : candidates)
    .sort((left, right) =>
      resolution_matches.length
        ? left.period - right.period || left.error - right.error
        : left.error - right.error,
    );
  return ranked
    .filter(
      (candidate, index, values) =>
        values.findIndex((value) => value.period === candidate.period) ===
        index,
    )
    .slice(0, DEFAULT_PEAK_COUNT);
};

/**
 * Analyze polar samples for angular spectral peaks and candidate periods.
 *
 * @param {Array<{iteration: number, theta: number}>} samples Polar samples.
 * @param {number} sample_stride Iterations represented by each sample step.
 * @param {{sample_stride?: number, window_length?: number, analysis_start?: number, minimum_samples?: number, peak_count?: number, max_period?: number}} options Analysis options.
 * @returns {object} Spectral summary and unvalidated period candidates.
 */
export const analyze_polar_spectrum = (
  samples,
  sample_stride,
  options = {},
) => {
  const analysis_config = normalize_spectral_analysis_config({
    ...options,
    sample_stride: options.sample_stride ?? sample_stride,
  });
  const valid_samples = samples.filter(
    (sample) =>
      Number.isFinite(sample.iteration) && Number.isFinite(sample.theta),
  );
  const windowed_samples = analysis_config.window_length
    ? valid_samples.slice(-analysis_config.window_length)
    : valid_samples;
  const start_index = Math.min(
    Math.max(0, windowed_samples.length - 2),
    Math.floor(windowed_samples.length * analysis_config.analysis_start),
  );
  const analysis_samples = windowed_samples.slice(start_index);
  if (analysis_samples.length < analysis_config.minimum_samples) {
    return {
      sample_count: analysis_samples.length,
      analysis_config,
      status: "insufficient_samples",
      phase_slope_radians_per_iteration: null,
      frequency_cycles_per_iteration: null,
      peaks: [],
      candidate_periods: [],
    };
  }

  const phase_slope = estimate_phase_slope(analysis_samples);
  const analysis_span_iterations = Math.max(
    1,
    analysis_samples.at(-1).iteration - analysis_samples[0].iteration,
  );
  const maximum_trustworthy_cardinality =
    analysis_span_iterations / MIN_OBSERVED_CYCLES;
  const frequency = (((phase_slope / (2 * Math.PI)) % 1) + 1) % 1;
  const bin_count = Math.floor(analysis_samples.length / 2);
  const powers = Array.from({ length: bin_count }, (_, bin) => ({
    bin: bin + 1,
    power: dft_power(analysis_samples, bin + 1),
  }));
  const peaks = powers
    .filter(
      (value, index, values) =>
        index === 0 ||
        index === values.length - 1 ||
        (value.power >= values[index - 1].power &&
          value.power >= values[index + 1].power),
    )
    .sort((left, right) => right.power - left.power)
    .slice(
      0,
      Math.min(
        MAX_PEAK_COUNT,
        Number(options.peak_count) || DEFAULT_PEAK_COUNT,
      ),
    )
    .map((peak) => {
      const frequency_per_sample = peak.bin / analysis_samples.length;
      const frequency_per_iteration =
        frequency_per_sample / analysis_config.sample_stride;
      const rational_candidate = rational_candidates(
        frequency_per_iteration,
        DEFAULT_MAX_CANDIDATE_PERIOD,
        1 / Math.max(analysis_samples.length * analysis_config.sample_stride, 1),
      )[0];
      return {
        ...peak,
        frequency_cycles_per_sample: frequency_per_sample,
        frequency_cycles_per_iteration: frequency_per_iteration,
        period_iterations:
          frequency_per_iteration > 0 ? 1 / frequency_per_iteration : null,
        cycles: rational_candidate?.cycles || null,
        cardinality: rational_candidate?.cardinality || null,
        rational_error: rational_candidate?.error ?? null,
        rational_confidence: rational_candidate?.confidence ?? null,
        trustworthy:
          frequency_per_iteration > 0 &&
          1 / frequency_per_iteration <= maximum_trustworthy_cardinality,
      };
    });
  const candidate_periods = rational_candidates(
    frequency,
    Math.min(
      DEFAULT_MAX_CANDIDATE_PERIOD,
      Math.max(2, Number(options.max_period) || DEFAULT_MAX_CANDIDATE_PERIOD),
    ),
    1 / Math.max(analysis_samples.length * analysis_config.sample_stride, 1),
  ).filter(
    (candidate) => candidate.period <= maximum_trustworthy_cardinality,
  );

  return {
    sample_count: analysis_samples.length,
    analysis_config,
    analysis_start_index: start_index,
    sample_stride: analysis_config.sample_stride,
    analysis_span_iterations,
    minimum_observed_cycles: MIN_OBSERVED_CYCLES,
    maximum_trustworthy_cardinality,
    phase_slope_radians_per_iteration: phase_slope,
    frequency_cycles_per_iteration: frequency,
    peaks,
    // Preserve the complete spectrum for diagnostics and visualization. The
    // ranked peaks above are useful for discovery, while this series shows
    // the surrounding energy and makes aliasing/noise visible to callers.
    power_spectrum: powers.map((value) => ({
      bin: value.bin,
      frequency_cycles_per_sample: value.bin / analysis_samples.length,
      frequency_cycles_per_iteration:
        value.bin / (analysis_samples.length * analysis_config.sample_stride),
      power: value.power,
    })),
    candidate_periods,
    status: "spectral_analysis_complete",
  };
};
