# Orbital analysis

The orbital discovery pipeline currently performs a polar scout around the
fixed point `Q`, optionally recomputes the samples with adaptive
`BigComplex` precision, and applies a first windowed Fourier analysis. The
reported candidate periods are suggestions only and must be validated by a
later exact-period solver.

## Future spectral confidence improvements

The current candidate confidence is based only on rational-frequency error
relative to the available frequency resolution:

```text
confidence = 1 / (1 + approximation_error / frequency_resolution)
```

Future confidence metrics should combine that heuristic with:

- DFT peak power relative to the surrounding spectral floor.
- Peak-to-noise or peak-to-neighbor power ratios.
- Phase-fit residual after projecting the samples onto the candidate rational
  frequency.
- Stability of the candidate across multiple analysis-window positions and
  lengths.
- Agreement between native and high-precision spectral passes.
- Harmonic consistency, including whether related peaks reduce to the same
  fundamental period.
- Sensitivity to the analysis start point and discarded transient samples.
- The estimated angular error caused by the remaining radius from `Q`.
- Candidate ranking that penalizes alias ambiguity when the sampling stride is
  too large to distinguish nearby frequencies.

These measures should produce a composite score or confidence interval rather
than treating the current rational-approximation score as statistical
confidence. No candidate should be reported as a discovered cardinality until
dynatomic deflation, Newton refinement, and exact-period validation agree.

## Spectral inspection endpoint

### Analysis configuration contract

Each future multi-analysis pass uses the same normalized configuration shape:

- `sample_stride`: positive integer number of orbit iterations between samples.
- `window_length`: optional positive sample count; `null` means the full eligible
  window.
- `analysis_start`: fractional offset from the beginning of the eligible window,
  bounded to `0..0.9`.
- `minimum_samples`: minimum number of samples required before analysis, with a
  floor of four.

The data server exposes the defaults and normalization helper in
`spectral_analysis.js`. The analyzer now accepts this contract and reports the
effective `analysis_config` in every result. When `window_length` is supplied,
the most recent eligible samples are analyzed; the default `null` value keeps
the established full-window behavior. Multi-configuration orchestration is
still deferred to the later stages.

The same module defines `DEFAULT_MULTI_ANALYSIS_CONFIGS`: eighteen bounded
passes using pairwise-coprime strides (`1, 2, 3, 5, 7, 11`), nearby prime
window lengths (`251` through `283`), and staggered analysis starts (`0`,
`0.1`, and `0.2`). These values are intentionally stored as configuration
records rather than multiplied into one large stride. The staggered windows
help expose transient and bin-alignment artifacts while retaining one shared
orbit sample set.

The first orchestration helper, `analyze_multi_polar_spectrum`, now evaluates
those configurations against one shared sample set. It is opt-in through
`GET /orbital_spectrum?...&multi_analysis=true`; results are returned under
`spectrum.multi_analysis`. The normal endpoint remains a single pass, and no
second orbit calculation is performed for the multi-analysis runs.

Adding `adaptive_analysis=true` permits one bounded retry with larger prime
windows when the initial consensus fails its confidence gate. Each pass
reports `elapsed_ms`, and `spectrum.analysis_diagnostics` records round timing,
configuration count, accepted candidates, and the stop reason. The controller
is capped at two rounds and a 2,000 ms analysis budget; it is intended to
measure scaling behavior before any broader adaptive policy is enabled.

The endpoint also returns `spectrum.consensus_candidates` for multi-analysis
requests. These are frequency-normalized clusters of peak observations, with
their contributing configurations, powers, and cardinality/cycle readings.
They are ranked by a screening score combining recurrence, relative power,
cardinality consistency, rational-fit error, and the trustworthy-cardinality
limit. Each result includes component scores and a composite `confidence`
value. Candidates must occur in at least two configurations before they are
accepted into this ranked list; singleton observations remain visible inside
the individual run spectra. This is evidence for prioritization;
exact-period validation remains a separate later stage.

The spectral-analysis regression tests run with `npm test` in the data server.
They cover configuration bounds, insufficient windows, shared multi-pass
sampling, nearby-frequency merging, and separated alias candidates.

This keeps the response backward-compatible: without `multi_analysis=true`,
the extra arrays are omitted and only the original single-pass spectrum is
returned. With the flag enabled, consumers can inspect both the complete
per-configuration runs and the ranked consensus without making additional
requests.

`GET /orbital_spectrum?re=<real>&im=<imaginary>` runs the same adaptive
discovery scout and returns the complete `spectrum.power_spectrum` series,
including frequency in cycles per iteration and normalized power. The
orbital-circuitry UI plots this series beside the parameterized path so that
peak shape, noise, and aliasing can be inspected directly. Optional discovery
parameters such as `iterations`, `sample_limit`, `analysis_start`,
`peak_count`, and `max_period` are forwarded to the scout.

The scout defaults to a 4,096-iteration warm-up before collecting the
configured analysis window. A bounded override (`warmup_iterations`, capped at
262,144) is available for controlled comparisons; it adds linear orbit work
but does not increase the DFT sample count. The spectral endpoint accepts
`warmup_stability=true` for detector diagnostics. In that mode it repeats the
scout at 4,096, 8,192, 16,384, and 65,536 warm-up iterations and places the
complete per-run metadata and spectrum under `spectrum.warmup_stability`.
Comparing candidate peaks across these runs helps identify artifacts such as
periods that appear only after a particular transient length, without making
the more common circuitry requests pay that cost.

The analyzer currently requires at least five complete cycles in the analyzed
window before treating a period as a trustworthy cardinality. The response
reports `minimum_observed_cycles` and the calculated
`maximum_trustworthy_cardinality`. Raw spectral bins remain available for
diagnostics, but candidates beyond that ceiling are excluded. This five-cycle
factor is deliberately explicit: detecting much larger cardinalities will
eventually require longer runs, more samples, or a confidence model that can
justify fewer observed cycles.

## Critical-orbit return detection

`GET /orbital_spectrum?re=<real>&im=<imaginary>&detection_mode=returns` selects
the independent return detector. It iterates directly from `z=0`, identifies
local minima in `|z|`, and accepts a cardinality only when the same gap occurs
at least five times. A large radius separation is used to ignore ordinary
within-orbit minima in favor of near-zero returns. The response reports the
candidate, matching minima, gap count, radius stability, and confidence. The
mode does not call `FractoFastCalc`; that routine remains a reference oracle
for known test fixtures only.

This return-detector phase is intentionally origin-based: its `radius`,
recurrence errors, and derivative-like comparisons all use the actual vector
`z` and never use the cardioid fixed point `Q`. The separate spectral scout
uses polar distance from `Q`; those two magnitudes must not be conflated.

The experimental `detection_mode=pyramid` route runs a separate contender
sieve. It samples `|z|` every contender cardinality, eliminates a contender
when a meaningful derivative-pyramid layer changes sign, and reports the
survivor list together with `elapsed_ms`, `eliminated_count`, and
`insufficient_count`. `minimum_cycles`, `max_cardinality`, and `noise_factor`
are query controls. This mode is for performance and accuracy experiments;
it does not replace the recurrence detector or establish exact periodicity.

`detector_newton.js` provides the detector-to-Newton adapter for the next
workflow stage. It accepts `newton_mode` values `native`, `big_complex`, or
`both`, passes the detected cardinality directly to the selected solver, and
returns `cardinality_inconclusive` without invoking Newton when five matching
returns have not been established.

Each Newton result includes diagnostics identifying the arithmetic mode,
supplied cardinality, nominal precision, least observed Newton-step magnitude,
and whether the best result used the requested cardinality. The step magnitude
is reported explicitly as a residual proxy; it is not an exact periodicity
proof.

The `/orbital_newton` endpoint exposes that adapter without changing the
existing `/orbital` or `/orbital_spectrum` routes. It returns HTTP 200 for an
inconclusive detector result so clients can display the diagnostic status;
invalid coordinates return HTTP 400.

## Peak rational decomposition

Each ranked entry in `spectrum.peaks` contains a raw `bin` and a frequency
estimate. The analyzer also approximates that frequency as a reduced rational
value:

```text
frequency_cycles_per_iteration ~= cycles / cardinality
```

Here `cycles` is the number of angular revolutions represented by one proposed
orbital cycle, and `cardinality` is the proposed whole-number point count.
`period_iterations` is the reciprocal frequency and is therefore not itself
the cardinality when more than one revolution occurs per orbital cycle. The
`rational_error` and `rational_confidence` fields describe the fit to the
measured frequency; they are screening signals, not proof of an orbit.

## Exact-period validation

Spectral decomposition can only suggest a cardinality because finite windows,
sampling stride, leakage, and noise can produce convincing rational ratios.
Exact-period validation must independently test each proposed pair `(cycles,
cardinality)` against the iteration map. Starting from the candidate orbital
state, the validator should:

1. Iterate the map for exactly `cardinality` steps and measure the residual
   between the final state and the starting state.
2. Confirm that the angular progression accounts for `cycles` complete turns
   within the same tolerance.
3. Test every proper divisor of `cardinality` so a smaller repeating orbit is
   not mislabeled as a larger one.
4. Reject escaped or numerically unstable candidates and repeat the test with
   adaptive `BigComplex` precision when the residual approaches the current
   numeric tolerance.

Only a candidate that returns after the proposed cardinality, does not return
earlier, and remains stable under increased precision should be promoted to a
discovered orbital.
