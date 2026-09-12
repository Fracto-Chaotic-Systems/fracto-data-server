import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze_multi_polar_spectrum,
  analyze_polar_spectrum,
  DEFAULT_MULTI_ANALYSIS_CONFIGS,
  merge_spectral_candidates,
  normalize_spectral_analysis_config,
  score_consensus_candidates,
} from "../handlers/orbitals/spectral_analysis.js";
import { discover_orbital } from "../handlers/orbitals/orbital_discovery.js";

const make_samples = (count, stride = 1, frequency = 0.03) =>
  Array.from({ length: count }, (_, index) => ({
    iteration: index * stride,
    theta: 2 * Math.PI * frequency * index,
    radius: 1,
  }));

test("normalizes and bounds analysis configuration", () => {
  assert.deepEqual(
    normalize_spectral_analysis_config({
      sample_stride: 0,
      window_length: -2,
      analysis_start: 4,
      minimum_samples: 2,
    }),
    {
      sample_stride: 1,
      window_length: null,
      analysis_start: 0.9,
      minimum_samples: 4,
    },
  );
});

test("returns an explicit insufficient-samples result", () => {
  const result = analyze_polar_spectrum(make_samples(3), 1);
  assert.equal(result.status, "insufficient_samples");
  assert.equal(result.sample_count, 3);
  assert.equal(result.analysis_config.minimum_samples, 4);
});

test("runs every bounded configuration against one shared sample set", () => {
  const runs = analyze_multi_polar_spectrum(
    make_samples(600),
    1,
    DEFAULT_MULTI_ANALYSIS_CONFIGS,
  );
  assert.equal(runs.length, DEFAULT_MULTI_ANALYSIS_CONFIGS.length);
  assert.equal(runs.length, 18);
  assert.deepEqual(
    [...new Set(runs.map((run) => run.sample_stride))],
    [1, 2, 3, 5, 7, 11],
  );
  assert.ok(runs.every((run) => run.spectrum.analysis_config.window_length));
});

test("merges nearby frequency observations and preserves configurations", () => {
  const runs = [
    {
      sample_stride: 1,
      window_length: 251,
      spectrum: {
        sample_count: 251,
        sample_stride: 1,
        peaks: [
          {
            frequency_cycles_per_iteration: 0.1,
            power: 4,
            cardinality: 10,
            cycles: 1,
            rational_error: 0.0001,
            trustworthy: true,
          },
        ],
        maximum_trustworthy_cardinality: 50,
      },
    },
    {
      sample_stride: 2,
      window_length: 257,
      spectrum: {
        sample_count: 257,
        sample_stride: 2,
        peaks: [
          {
            frequency_cycles_per_iteration: 0.1005,
            power: 3,
            cardinality: 10,
            cycles: 1,
            rational_error: 0.0002,
            trustworthy: true,
          },
        ],
        maximum_trustworthy_cardinality: 50,
      },
    },
  ];
  const merged = merge_spectral_candidates(runs, {
    frequency_tolerance: 0.001,
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].occurrence_count, 2);
  assert.equal(merged[0].configurations.length, 2);
  assert.equal(score_consensus_candidates(merged, 2)[0].confidence > 0, true);
});

test("keeps clearly separated alias candidates distinct", () => {
  const runs = [
    {
      sample_stride: 1,
      spectrum: {
        sample_count: 512,
        sample_stride: 1,
        peaks: [
          { frequency_cycles_per_iteration: 0.02, power: 5 },
          { frequency_cycles_per_iteration: 0.2, power: 4 },
        ],
      },
    },
  ];
  assert.equal(merge_spectral_candidates(runs).length, 2);
});

test("prefers a simple cardinality within spectral resolution", () => {
  const result = analyze_polar_spectrum(make_samples(251, 1, 1 / 7), 1, {
    window_length: 251,
    analysis_start: 0,
    peak_count: 4,
  });
  assert.ok(
    result.peaks.some((peak) => peak.cardinality === 7),
    "expected the seven-point candidate despite a non-divisible window",
  );
});

test("preserves multi-cycle cardinality when scouting a short orbital", () => {
  const result = discover_orbital(
    { re: 0.112602264, im: 0.5939821402 },
    { iterations: 4096, warmup_iterations: 0 },
  );
  const candidate = result.spectrum.peaks.find(
    (peak) => peak.cardinality === 7,
  );
  assert.ok(candidate, "expected the seven-point candidate");
  assert.equal(candidate.cycles, 2);
});
