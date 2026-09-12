import { performance } from "node:perf_hooks";
import { discover_orbital } from "./orbitals/orbital_discovery.js";
import { sample_critical_orbit } from "./orbitals/orbit_sampling.js";
import {
  DETECTION_MODE_PYRAMID_ONLY,
  detect_pyramid_contenders,
  detect_return_cardinality,
} from "./orbitals/return_detection.js";
import {
  analyze_multi_polar_spectrum,
  ADAPTIVE_MULTI_ANALYSIS_CONFIGS,
  DEFAULT_MULTI_ANALYSIS_CONFIGS,
  merge_spectral_candidates,
  score_consensus_candidates,
} from "./orbitals/spectral_analysis.js";

const WARMUP_STABILITY_ITERATIONS = [4096, 8192, 16384, 65536];
const ADAPTIVE_MAX_ROUNDS = 2;
const ADAPTIVE_TIME_BUDGET_MS = 2000;
const ADAPTIVE_MIN_SCORE = 0.7;

const is_truthy = (value) =>
  ["1", "true", "yes"].includes(String(value).toLowerCase());

/**
 * Return the polar spectrum used by the cardinality discovery scout.
 *
 * This intentionally keeps the discovery calculation in one place while
 * exposing a chart-oriented response for diagnostics. The complete sampled
 * power series is returned in addition to ranked peaks and candidates.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @queryParam warmup_stability When true, include bounded comparisons at
 *   several warm-up horizons in `spectrum.warmup_stability`.
 * @queryParam multi_analysis When true, run the bounded multi-configuration
 *   analysis over one shared orbit sample set.
 * @queryParam adaptive_analysis When true, permit one larger-window retry
 *   when the initial consensus does not meet the confidence gate.
 * @queryParam detection_mode `returns` selects critical-orbit return
 *   detection; the default `spectral` mode retains Fourier analysis.
 *   `pyramid` is a backward-compatible alias for `pyramid_only`, which runs
 *   only the derivative-pyramid contender sieve.
 * @queryParam max_cardinality Upper cardinality contender bound.
 * @queryParam minimum_cycles Required repeated samples per contender.
 * @queryParam max_layers Maximum derivative-pyramid levels to evaluate.
 * @queryParam near_zero_tolerance Absolute floor for near-zero differences.
 * @queryParam precision_digits Initial precision policy, reserved for the
 *   high-precision promotion stage.
 * @queryParam max_precision_digits Maximum precision policy.
 * @queryParam precision_escalation_factor Precision growth multiplier.
 * @queryParam stop_on_confident When true, stop after a contender reaches
 *   the configured evidence threshold; disabled by default for benchmarks.
 * @queryParam confidence_threshold Minimum pyramid-layer fraction required
 *   for early termination.
 * @queryParam harmonic_score_tolerance Score difference allowed when labeling
 *   a surviving multiple as a harmonic of a proper divisor.
 * @queryParam period_validation_tolerance Full-complex recurrence tolerance
 *   used to validate each surviving candidate period.
 * @returns {import('express').Response} JSON spectral response. With
 *   `multi_analysis=true`, `spectrum.multi_analysis` contains each configured
 *   pass and `spectrum.consensus_candidates` contains the ranked merged view.
 */
export const handle_orbital_spectrum = (req, res) => {
  const re = Number(req.query.re);
  const im = Number(req.query.im);
  if (!Number.isFinite(re) || !Number.isFinite(im)) {
    return res.status(400).json({ error: "re and im must be finite numbers" });
  }
  try {
    const point = { re: req.query.re, im: req.query.im };
    if (req.query.detection_mode === "returns") {
      const orbit = sample_critical_orbit(point, {
        iterations: req.query.iterations,
      });
      const detection = detect_return_cardinality(orbit.samples, {
        minimum_return_repetitions: req.query.minimum_return_repetitions,
      });
      return res.status(200).json({
        point: { re: String(req.query.re), im: String(req.query.im) },
        detection_mode: "returns",
        iterations: orbit.iterations,
        escaped: orbit.escaped,
        detection,
      });
    }
    if (
      req.query.detection_mode === "pyramid" ||
      req.query.detection_mode === DETECTION_MODE_PYRAMID_ONLY
    ) {
      const orbit = sample_critical_orbit(point, {
        iterations: req.query.iterations,
      });
      return res.status(200).json({
        point: { re: String(req.query.re), im: String(req.query.im) },
        detection_mode: DETECTION_MODE_PYRAMID_ONLY,
        experimental: true,
        experimental_warning:
          "Derivative-pyramid detection is experimental and must not be used as the production detector.",
        iterations: orbit.iterations,
        escaped: orbit.escaped,
        detection: detect_pyramid_contenders(orbit.samples, {
          minimum_cycles: req.query.minimum_cycles,
          max_cardinality: req.query.max_cardinality,
          max_layers: req.query.max_layers,
          noise_factor: req.query.noise_factor,
          near_zero_tolerance: req.query.near_zero_tolerance,
          precision_digits: req.query.precision_digits,
          max_precision_digits: req.query.max_precision_digits,
          precision_escalation_factor: req.query.precision_escalation_factor,
          stop_on_confident: req.query.stop_on_confident,
          confidence_threshold: req.query.confidence_threshold,
          harmonic_score_tolerance: req.query.harmonic_score_tolerance,
          period_validation_tolerance: req.query.period_validation_tolerance,
        }),
      });
    }
    const include_multi_analysis = is_truthy(req.query.multi_analysis);
    const include_adaptive_analysis = is_truthy(req.query.adaptive_analysis);
    const discovery_options = {
      iterations: req.query.iterations,
      sample_limit: include_multi_analysis
        ? 4096
        : req.query.sample_limit,
      analysis_start: req.query.analysis_start,
      peak_count: req.query.peak_count,
      max_period: req.query.max_period,
      warmup_iterations: WARMUP_STABILITY_ITERATIONS[0],
    };
    const result = discover_orbital(point, discovery_options);
    const include_warmup_stability = is_truthy(req.query.warmup_stability);
    const warmup_stability = include_warmup_stability
      ? WARMUP_STABILITY_ITERATIONS.map((warmup_iterations) => {
          const run =
            warmup_iterations === result.warmup_iterations
              ? result
              : discover_orbital(point, {
                  ...discovery_options,
                  warmup_iterations,
                });
          return {
            warmup_iterations: run.warmup_iterations,
            precision_mode: run.precision_mode,
            precision_digits: run.precision_digits,
            sample_stride: run.sample_stride,
            precision_escalated: run.precision_escalated,
            minimum_relative_separation: run.minimum_relative_separation,
            spectrum: run.spectrum,
          };
        })
      : null;
    const analysis_diagnostics = [];
    let multi_analysis = null;
    let consensus_candidates = null;
    if (include_multi_analysis) {
      const adaptive_started = performance.now();
      const run_round = (configs, round) => {
        const runs = analyze_multi_polar_spectrum(
          result.samples,
          result.sample_stride,
          configs,
          discovery_options,
        );
        const merged = merge_spectral_candidates(runs);
        const scored = score_consensus_candidates(merged, runs.length);
        analysis_diagnostics.push({
          round,
          elapsed_ms: runs.reduce((sum, run) => sum + run.elapsed_ms, 0),
          configurations: configs.length,
          accepted_candidates: scored.length,
          peak_count: runs.reduce(
            (sum, run) => sum + (run.spectrum.peaks?.length || 0),
            0,
          ),
        });
        return { runs, scored };
      };
      let analysis_round = run_round(DEFAULT_MULTI_ANALYSIS_CONFIGS, 1);
      multi_analysis = analysis_round.runs;
      consensus_candidates = analysis_round.scored;
      const confident = consensus_candidates.some(
        (candidate) =>
          candidate.confidence >= ADAPTIVE_MIN_SCORE &&
          candidate.occurrence_count >= 4 &&
          candidate.score_components.cardinality_consistency >= 0.5,
      );
      let stop_reason = confident ? "confidence_threshold_met" : "confidence_below_threshold";
      if (
        include_adaptive_analysis &&
        !confident &&
        analysis_diagnostics.length < ADAPTIVE_MAX_ROUNDS &&
        performance.now() - adaptive_started < ADAPTIVE_TIME_BUDGET_MS
      ) {
        analysis_round = run_round(ADAPTIVE_MULTI_ANALYSIS_CONFIGS, 2);
        multi_analysis = analysis_round.runs;
        consensus_candidates = analysis_round.scored;
        stop_reason = "adaptive_retry_complete";
      } else if (include_adaptive_analysis && !confident) {
        stop_reason = "adaptive_budget_exhausted";
      }
      analysis_diagnostics.push({
        max_rounds: ADAPTIVE_MAX_ROUNDS,
        time_budget_ms: ADAPTIVE_TIME_BUDGET_MS,
        elapsed_ms: performance.now() - adaptive_started,
        adaptive_requested: include_adaptive_analysis,
        stop_reason,
      });
    }
    let spectrum = result.spectrum;
    if (include_warmup_stability || include_multi_analysis) {
      spectrum = {
        ...spectrum,
        ...(include_warmup_stability ? { warmup_stability } : {}),
        ...(include_multi_analysis ? { multi_analysis } : {}),
        ...(include_multi_analysis
          ? {
              consensus_candidates,
              analysis_diagnostics,
            }
          : {}),
      };
    }
    return res.status(200).json({
      point: result.point_input,
      precision_mode: result.precision_mode,
      precision_digits: result.precision_digits,
      iterations: result.iterations,
      warmup_iterations: result.warmup_iterations,
      sample_stride: result.sample_stride,
      spectrum,
    });
  } catch (error) {
    console.error("handle_orbital_spectrum", error.message);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Dedicated derivative-pyramid endpoint. This delegates to the shared
 * spectrum handler with the detector mode fixed, keeping validation and
 * configuration handling identical to `/orbital_spectrum`.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {import('express').Response} Pyramid-only JSON response.
 */
export const handle_orbital_pyramid = (req, res) => {
  const pyramid_request = Object.create(req);
  Object.defineProperty(pyramid_request, "query", {
    value: { ...req.query, detection_mode: "pyramid_only" },
    enumerable: true,
    configurable: true,
  });
  return handle_orbital_spectrum(pyramid_request, res);
};
