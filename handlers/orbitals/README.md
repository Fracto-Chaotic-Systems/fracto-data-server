# Orbital analysis

This folder contains two related but distinct paths: the active detector →
Newton → optional circuitry pipeline, and a spectral-inspection endpoint used
for diagnostics and research. The spectral scout is not the source of
cardinality for normal `/circuitry` or `/orbital_newton` requests.

## Active detection, refinement, and circuitry flow

The production critical-orbit detector lives in the main repository's
`@fracto/sdk` `FractoCardinality` function. The data-server
`cardinality_detection.js`, `orbit_sampling.js`, and `return_detection.js`
modules re-export SDK code. The SDK's `FractoOrbitalPoints` function is the
shared detector-to-Newton interface; data-server `detector_newton.js` and
`newton_refinement.js` are compatibility adapters. The solver implementations
also live in the SDK and their old data-server module paths re-export them.
The shared interface performs bounded adaptive detection by default, carries
the best-known candidate into Newton, and records whether cardinality came
from the SDK detector or another named source. It still reports numerical
candidates, not mathematical proofs.

Several separate cardinality-like values remain and need an explicit policy
before they can be merged into the best-known result:

- `/orbitals` returns the established zero-seed `FractoFastCalc.calc()` result
  for the **legacy iterative** chart and starts the same asynchronous
  `FractoCardinality` seed survey used by the Assets page. The Assets page
  starts that survey directly and does not request the legacy series. See
  “Seed-plane survey contract and imagery” below; the previous description of
  a 64-digit `calc_big_complex_from_seed()` sweep over `[-2, 2]` does not
  describe this active survey.
- `/orbital` uses the older inverse-square-root `retro_derivation()` and
  detects a repeated BigComplex text state. It is a separate legacy method;
  its response now labels `cardinality_source: "legacy_retro_derivation"`.
- If `/circuitry` cannot use detector/Newton points, it may fall back to
  `FractoFastCalc.calc()` in the main cardioid. That fallback is labeled in
  `point_source`; it is not the SDK-selected cardinality.
- When the critical-orbit detector returns 2, `/orbital_newton` and
  `/circuitry` run a narrow FractoFastCalc fallback and may use its count as
  Newton's supplied period. The detector's original candidate stays in the
  response. This is a competing period estimate, not a replacement for the
  SDK's `FractoCardinality` result.
- `/orbital_spectrum?detection_mode=pyramid` and the spectral scout produce
  experimental contenders or frequency-derived candidates. They are
  diagnostic evidence and do not set the production cardinality.

These paths are intentionally called out rather than silently blended. Any
future reconciliation should define how alternative evidence is ranked and
how disagreements appear in the result before changing the central function's
selected candidate.

`detect_cardinality()` samples the critical orbit beginning at `z=0` and
`detect_return_cardinality()` looks for repeated near-origin return gaps. This
is a finite-precision heuristic: it reports a *candidate* cardinality, not a
proof that the parameter has a unique or attracting orbit of that period.
The five-gap default, recurrence comparisons, radius-gap filtering, and
derivative-pyramid checks are evidence thresholds; they can miss periods,
accept a misleading finite-window pattern, or depend on the iteration horizon.
The origin-based detector is therefore one input to the pipeline, not a
general solution to discovering every stable orbital in the main cardioid.

`discover_and_newton()` is the reusable detector-plus-refinement adapter. It
returns the detection evidence and, when a candidate exists, passes that
candidate to `refine_orbital_points()`. It does not run `FractoFastCalc` or
the special two-point fallback. Callers that need only detection can use
`detect_cardinality()`; callers with a candidate from another source can call
`refine_orbital_points()` directly. There is not yet one shared
`resolve_cardinality()` stage that produces a selected cardinality for every
consumer, so the two-point fallback is currently orchestrated separately by
the HTTP handler and circuitry pipeline. Consolidating that policy is a
future modularity improvement.

The HTTP `/orbital_newton` route returns HTTP 200 for an inconclusive detector
result, with a diagnostic status; invalid coordinates return HTTP 400. Its
default detector horizon is 4,096 iterations. `adaptive_detection=true` may
repeat detection at increasing horizons, up to 262,144 by default (or a
smaller configured maximum), and stops when its evidence gate passes or the
cap is reached. This is bounded retry, not precision escalation: detector
sampling and its evidence remain ordinary numeric calculations. Each retry
starts the detector from `z=0` again and also runs Newton for a detected
candidate, so the option repeats work rather than incrementally extending one
orbit sample. It is intended for diagnostic use and can cost substantially
more than a single request.

## Seed-plane survey contract and imagery

The survey holds the navigator focal point fixed as the Mandelbrot parameter
`c` and varies the initial orbit value `z0` over the image plane. Each seed is
passed to `FractoCardinality(c, { seed, iterations: 4096,
maximum_detection_iterations: 4096, adaptive_detection: false,
seed_level: 0.00625 })`. Inside the main cardioid this means one ordinary-
precision 4,096-step horizon per seed; `seed_level` applies only if the focal
parameter takes the SDK's outside-cardioid seeded compatibility path, where
the calculation uses `FractoFastCalc.calc_from_seed()`. The SDK guide
`sdk/FractoCardinality.md` defines input handling, escape counts, return
evidence, and the limits of these numerical candidates. In that in-cardioid
path, the fixed parameter and each seed are converted to JavaScript numbers;
passing coordinate strings does not provide arbitrary precision.

The preview has 121×121 samples spaced 0.025 apart, including the bounds
`[-1.5, 1.5]`. Render has 1024×1024 pixel-center samples spaced `3/1024` over
the same bounds. The imaginary coordinate is laid out top-to-bottom in the
image. Preview returns arrays of stable, unresolved, and escaped point
records. Render returns one compact record per sample in each streamed row,
without a million-object result array. The 13-byte little-endian record is:

| Byte offset | Type | Meaning |
| --- | --- | --- |
| 0 | `uint8` | Status: 0 blank/other, 1 non-singleton candidate, 2 unresolved, 3 escaped |
| 1 | `uint32` | Candidate pattern/cardinality |
| 5 | `float32` | Detection confidence; `-1` when unavailable |
| 9 | `uint32` | Iteration count reported by the calculation |

The render loop precomputes its fixed-12-decimal coordinate strings once per
axis and reuses one `DataView` per row. These changes remove repeated
formatting and per-pixel view allocations without changing seed coordinates or
detector settings. The dominant cost remains per-seed orbit sampling and return
analysis: up to 4,097 orbit samples are processed for each of the 1,048,576
render pixels.

Status 1 is assigned only if the detector reports an integer period greater
than one and at least that many orbit samples are available to take the final
pattern-sized suffix. The suffix is used to display one candidate's points;
this length check does not independently verify recurrence or distinctness.
Period-one candidates remain blank. Escaped seeds are status 3; an orbit with
no candidate that did not escape is status 2. Invalid and other outcomes are
status 0. Detection and escape are separate facts in `FractoCardinality`, but
the survey classifies a detected integer candidate before considering its
escape flag. The output is a diagnostic visualization, not proof of stability
or of a primitive orbit.

Preview responses also report `orbital_magnitude_range`. For each accepted
non-singleton candidate, the worker takes the last `pattern` samples from the
bounded orbit, measures each sample's distance from the cardioid fixed point
`Q`, and retains the maximum as that seed's orbital magnitude. The returned
range is the minimum and maximum of those per-seed maximum distances across
the preview's accepted candidates. It is `null` when there are none. Render
mode omits this calculation to avoid retaining a million orbit point sets.

The Assets page maps status 1 pixels to the existing pattern hue and maps their
finite confidence scores by empirical rank. The lowest 1% maps to HSL
lightness 18%, the highest 1% to 88%, and intermediate ranks are spread
evenly. Confidence is not a probability. Status 2 is grey (`#888888`), status
3 is currently white (`#ffffff`), and status 0 remains the `#eeeeee` canvas
background. A separate escape-iteration percentile scale exists in the UI but
is disabled for now; see the UI assets README for the flag and details.

Both modes run in the bounded worker pool. Preview tasks have a five-minute
timeout and render tasks a one-hour timeout. Job state and the full render
buffer are process-local; completed jobs expire after 15 minutes. Starting a
different active focal-point/resolution job cancels the earlier active survey.
The render job endpoint accepts an `after_row` cursor and returns at most 16
rows per poll. Restarting the service discards all job state. The data-server
route is `GET /orbitals/seed-survey?re=...&im=...&resolution=...`; resolution
may be omitted for the 121 preview or set to 1024 for render. Poll
`GET /orbitals/seed-survey/:job_id` for progress and row batches. The top-level
`GET /orbitals` route also starts the 121 preview alongside its legacy
iterative result.

Both `/orbital_newton` and `/circuitry` invoke the active
`two_point_calc_newton_fallback` only when the detector candidate is exactly
2 and the parameter is in the main cardioid. It runs `FractoFastCalc.calc()`
to obtain a replacement candidate count, then runs BigComplex Newton with
that count. The calculator's orbit points are not used as the Newton orbit;
they contribute only count and extent diagnostics. A result is accepted when
Newton reports the requested count, returns the same number of finite points,
and supplies no count mismatch. This is a deliberately narrow experimental
fallback, and even an accepted result is a numerical candidate rather than a
verified mathematical period.

The fallback does not replace a candidate when it fails its count/finite-point
checks. In `/circuitry`, the normal detector/Newton points remain in that
case. In `/orbital_newton`, the original detector evidence remains and the
fallback result is reported under `two_point_calc_newton_fallback`; when
accepted, the route replaces `newton_big_complex` with the fallback result
and marks `used_for_newton`. Note that the detector's top-level candidate
remains 2, while the accepted Newton cardinality can be different; consumers
must inspect the fallback diagnostic and the Newton result rather than assume
those fields always agree.

Within the main cardioid, circuitry gives an escaped critical orbit precedence
over finite-window recurrence and returns the outside-set response. For
parameters outside the main cardioid, it uses `FractoFastCalc.calc()` directly.
For an in-cardioid detector/Newton result with at least two refined points,
normal Newton points are used unless the two-point fallback succeeds. If that
path cannot provide a usable multi-point result, a separate legacy
`FractoFastCalc` fallback remains in place (marked for future removal in the
source); thus `FractoFastCalc` can still be called for other in-cardioid
inconclusive/short-result cases. A one-point result is rendered as a single
point without curve interpolation.

For multi-point circuitry, the default path constructs a Hermite curve; the
`radial_sweep` option uses radial parameterization. `build_circuitry_from_points()`
is a direct curve-stage entry for already-ordered points and currently performs
radial-sweep parameterization only. These curve stages do not independently
validate that their input points form a primitive periodic orbit.

### Numerical and verification limits

The Newton output is refinement evidence, not proof. The current acceptance
checks do not verify that each returned point maps to the next, that the final
point closes to the first, that the period is primitive, or that the cycle is
stable. `least_newton_step` is a step-size proxy, not a return residual or
periodicity certificate. The SDK BigComplex path defaults to 64 significant
digits, preserves string coordinates, and performs the Newton quotient with
Decimal arithmetic. This preserves arithmetic resolution through the
refinement calculation; it does not certify that a returned cycle is accurate
to that many digits. The native path intentionally uses JavaScript `Number`
arithmetic. The shared interface defaults to a maximum of 10 Newton cycles.
Either
solver returns early when its computed Newton step is exactly zero, including
the current orbital point list and the number of cycles run; this zero-step
condition is not by itself a cycle-closure or convergence certificate.

The calculator fallback also uses ordinary numeric arithmetic and its
`pattern` is an SDK estimate at its current implementation precision. Its
result may change with coordinate rounding, SDK behavior, or iteration limits.
The present pipeline does not compare the candidate across increasing
precision or horizons, calculate a stability multiplier, or certify uniqueness
of an attracting orbit. Future work should centralize candidate selection,
preserve coordinate precision through the solver, and add independent closure,
primitive-period, stability, and precision-stability checks before using the
word “confirmed.”

The later sections document the spectral-inspection subsystem. Its frequency
and rational-period estimates are diagnostic evidence only and are separate
from the active detector/Newton flow described above.

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

`FractoOrbitalPoints` provides the shared detector-to-Newton interface. It
accepts `newton_mode` values `native`, `big_complex`, or `both`, passes the
SDK-detected candidate to the selected solver, and returns
`cardinality_inconclusive` when detection does not produce an integer
candidate. A caller may instead provide an explicit positive cardinality
with `cardinality_source` provenance. The detector's default requires five
repeated gaps, but the threshold is configurable and the broader evidence also includes
recurrence and derivative-pyramid diagnostics; meeting it does not prove the
candidate period.

The data-server's `newton_refinement.js` adapter accepts a focal point and a
caller-supplied cardinality, then delegates to the SDK interface. This keeps
experimental or imported candidates usable without letting them silently
replace the SDK detector's result. `detector_newton.js` delegates directly to
the same SDK interface while retaining the existing HTTP response fields.

The Newton solvers preserve supplied cardinalities 1 and 2; they do not raise
them to 3. An exact zero-step root is returned with the requested period rather
than being discarded. These are candidate results and still require closure
and primitive-period validation before they are treated as confirmed orbits.

`orbitals_utils.js` exposes `get_cardioid_root(focal_point)` as the independent
Q calculation. Radial-sweep, Hermite, and waveform consumers may use a
caller-supplied Q or calculate it once at their boundary; none needs to invoke
cardinality detection to obtain it.

`radial_sweep.js` exposes `parameterize_radial_sweep(points, Q, options)` as an
independent curve stage. It requires only ordered canonical orbital points and
the radial origin Q; `options.samples_per_interval` controls sampling density.
The established `sample_radial_sweep(points, Q, count)` name remains as a
compatibility alias for existing callers.

`circuitry_pipeline.js` contains the complete orchestration stage used by
`/circuitry`. `build_circuitry_pipeline(focal_point, options)` coordinates
detection, Newton refinement, fallback point acquisition, Q calculation, and
Hermite or radial-sweep interpolation without depending on Express. The HTTP
handler validates request coordinates, supplies query options, and maps the
pipeline result to an HTTP status and JSON response.
Within the closed main cardioid, if the critical-orbit detector reports escape,
the pipeline returns the outside-set response before accepting any finite-
window recurrence candidate. The specialized detector/Newton path is limited
to the closed main cardioid.
For points outside it, the pipeline uses `FractoUtil.point_in_main_cardioid`
to select the established `FractoFastCalc.calc()` result directly, including
its period-zero escape result.

The retired theta-derived orbital-2 investigation, coarse Newton sweep, and
early-exit Newton variant are preserved under `archive/`. They are not imported
by runtime routes and are excluded from the root syntax/format checks and Docker
build context. The active two-point cardinality fallback is implemented in
`two_point_calc_newton_fallback.js`.

When the main-cardioid detector's candidate cardinality is 2, both `/circuitry`
and `/orbital_newton` automatically use `FractoFastCalc.calc().pattern` as the
supplied cardinality for BigComplex Newton. Any positive integer calculator
cardinality, including 1 or 2, is eligible; it is accepted only when Newton
reports the same cardinality and returns that number of finite points. The
critical-orbit points from `calc()` are used only for count and extent
diagnostics. A missing or mismatched Newton result leaves the normal
detector/Newton points in place. The response field
`two_point_calc_newton_fallback` reports the status, calculator cardinality and
iteration, Newton cardinality, and whether the fallback supplied the returned
points. Detailed point-extent and timing data remain internal. This fallback
is not evaluated outside the main cardioid. The calculator receives numeric
real and imaginary coordinates even when HTTP request values are strings;
passing strings directly can change JavaScript arithmetic coercion and produce
a spurious cardinality.

The retired coarse Newton sweep and its theta-derived candidate seed are kept
under `archive/` for reference. They are not available as circuitry query
options and do not affect runtime requests.

The same module exposes `build_circuitry_from_points(points, Q, options)` for
direct entry after detection or refinement has already happened. This path
performs only radial-sweep parameterization and reports `point_source:
"caller_supplied"`; a client can then pass the returned curve samples and Q to
the independent waveform stage without repeating earlier work.

Radial-sweep results also include `cycles`, the unwrapped angular revolution
count. Consumers should use this explicit metadata rather than inferring turns
from the wrapped sample-angle endpoints.

The data-server test suite includes stage tests and a handler-level integration
test for `/circuitry`. The integration test checks the stable response contract
for a successful radial result, an outside-set result, and invalid coordinates.

The `/orbital_newton` response is intentionally compact: it keeps the detector
status, candidate and ambiguity flag, iteration count, returned Newton points,
and cycle count. Large minima arrays, alternative candidates, derivative
pyramid details, and solver diagnostics are omitted from HTTP responses. They
remain available to direct SDK callers for focused analysis. Newton's least
step is a residual proxy, not an exact periodicity proof.

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
