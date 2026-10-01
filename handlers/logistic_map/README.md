# Logistic map handlers

This folder is the design and implementation home for the logistic-map study feature in the Fracto data server. It will contain calculation, persistence, and request-handler modules. The current code implements only request/result contract validation; orbit iteration, classification, persistence, and HTTP routes remain future work. This document records the mathematical context and tentative direction so future work starts from the same assumptions.

## Mathematical model and scope

The map under consideration is

```text
x[n + 1] = f_r(x[n]) = r * x[n] * (1 - x[n])
```

with `3 <= r < 4` and initial state `x[0]` in `[0, 1]`. For a fixed exact pair `(r, x[0])`, the real-valued map is deterministic: every finite iterate is uniquely defined. Determinism does not imply that the orbit eventually repeats or that its complete long-term behavior can always be summarized by a finite cycle.

The intended feature is a one-dimensional analogue of Fracto's hierarchical tile/index storage. The horizontal coordinate is the real parameter `r`; each parameter record should describe the long-term orbit behavior at the requested parameter resolution and computation confidence. The initial broad scan should cover at least the first two hierarchy levels completely, while deeper subdivision can focus on intervals selected for closer inspection.

## Parameter hierarchy and packet addressing

The full parameter span has width `1`. The proposed radix is `256`:

- Level 1 divides `[3, 4)` into 256 equal bins.
- Level 2 divides each level-1 bin into 256 children, for 65,536 bins total.
- Each later level divides a selected parent interval into another 256 equal child intervals.

A level packet should hold the 256 parameter values belonging to one parent interval. Its address must uniquely identify the level and parent path (or an equivalent exact interval representation), so that a packet can be regenerated and located without relying on rounded decimal labels. The precise convention—integer path indices, rational endpoints, or both—remains to be specified. Boundary ownership must be unambiguous; the global interval is half-open, `[3, 4)`, so adjacent bins do not overlap and `r = 4` is excluded.

The initial complete scan should generate every value at levels 1 and 2. Selective deeper work should add child packets without changing the identity of already stored parents. Parameter precision and serialization must preserve exact bin identity even when floating-point display values look identical.

## What one parameter result represents

A result is not simply “the orbit” until its classification is known. The same `r` can be classified into one of these practical result forms:

- **Attracting periodic cycle:** a finite ordered set of distinct orbit points, with its period and numerical validation information.
- **Bounded orbit sample, unresolved:** a finite segment retained because the iteration budget ended before a reliable cycle or other requested classification was established.
- **Needs refinement:** a marker that the current result is provisional and should be revisited with higher precision, a longer run, or an improved algorithm.
- **Failed/invalid computation:** an explicit error outcome, not an empty or apparently valid orbit.

A record should carry enough provenance to interpret and reproduce its status: exact parameter-bin identity and represented `r`; initial-state policy and actual `x[0]`; arithmetic type and precision; transient length and iteration cap; points or samples retained; cycle-detection/convergence method and tolerances; classification status; and algorithm/schema version. Iteration counts can be useful diagnostics, but should not be treated as the defining description of an orbit. The eventual schema may store a digest or compact encoding for large samples, but that choice is open.

## Stable cycles, chaotic parameters, and numerical limits

For the standard logistic map, the negative-Schwarzian/Singer theory implies at most one attracting periodic orbit for a given parameter. In the range being studied, the endpoint fixed point at zero is repelling. There can still be many unstable periodic orbits; they are not alternative stable long-term patterns for a typical nearby initial state. At boundary parameters, marginal behavior needs care, so implementation should report what was numerically established rather than force every result into “stable cycle” or “chaos.” [Singer's theorem](https://epubs.siam.org/doi/10.1137/0135020); see also the discussion of stable logistic-map orbits in [this dynamical-systems study](https://pmc.ncbi.nlm.nih.gov/articles/PMC3988007/).

The range is not uniformly chaotic above the period-doubling accumulation point. Periodic windows occur within parameter ranges commonly described as chaotic, and each such window can contain its own stable cycle and period-doubling structure. Classification therefore has to be per parameter interval/value, not inferred from the fact that `r` is “above the onset of chaos.” [Logistic-map periodic-window study](https://www.sciencedirect.com/science/article/pii/S0960077922009468).

“Chaotic” means that typical exact real-valued orbits do not settle onto a finite attracting cycle and are sensitive to initial conditions; it does not mean that the recurrence is random. Any finite prefix can be calculated in finite time. What may not be available is a finite stopping test proving that a finite sample captures the complete infinite attractor. A finite-precision machine has only finitely many states, so its computed orbit must eventually repeat. That machine cycle can be an artifact of the chosen precision and arithmetic implementation, and must not automatically be labeled the exact real-map cycle. [Finite-precision logistic-map study](https://www.nature.com/articles/s41598-023-37004-4).

Accordingly, cycle detection is evidence about the selected numerical computation, not by itself proof about the real-valued system. A final cycle candidate should require explicit checks: repeated state within a documented error criterion, primitive-period validation (no smaller divisor), and stability of the candidate under increased precision or an independent refinement. For a sample that reaches its cap without these checks, store the sample as partial/unresolved and make it eligible for later refinement.

The earlier preference for “5-sigma accuracy” expresses a desire for very high confidence, but a deterministic calculation has no statistical sigma unless an uncertainty model is introduced. The implementation should instead define arithmetic precision, residual/tolerance criteria, and preferably error or stability checks. A statistical confidence field can be added only if its interpretation and model are specified.

## Initial conditions and candidate refinement

The critical point `x[0] = 1/2` is the reproducible default seed for investigating attracting behavior: for this map, an attracting cycle's basin is tied to the critical point under Singer's result. It is not a guarantee that every finite run classifies every parameter, especially at exceptional or marginal parameters.

A deterministic alternative seed can be used for repeatability. Random seeds may be useful for exploration but must be recorded to reproduce a result. Starting from a neighboring parameter's orbit may accelerate a scan where behavior varies smoothly, but it is an optimization only: the result must be validated for the requested `r`, and the canonical seed or another independent check should be available to detect inherited/missed behavior. Neighbor reuse must never cause one parameter's result to be silently copied to another.

If an approximate cycle and its period `p` are found, a possible refinement is to solve `f_r^p(x) - x = 0` with Newton-Raphson or another root solver. This can sharpen a candidate point when direct iteration converges slowly. It does not independently prove that the cycle attracts typical states, that the period is primitive, or that the candidate is the relevant attractor; the multiplier and return residual must also be checked, and the method can be ill-conditioned near bifurcations. This is a possible refinement stage, not a settled algorithm.

## Step 1: calculation request and result contract

`calculation_contract.js` implements request normalization and result provenance. `calculator.js` performs bounded numeric iteration and cautious candidate-cycle detection. These modules do not access a database or serve HTTP requests.

`normalize_logistic_map_request(r, options)` accepts `r` as a number or decimal string and validates its represented JavaScript `Number` value against `3 <= r < 4`. The normalized parameter records both submitted decimal text and the effective value/text that the initial number backend will calculate with. This distinction matters when a decimal string has more precision than binary64 can represent; a later arithmetic backend can use the original text.

The normalized settings include:

- `precision`: initially `{ backend: "number", significant_digits: 16 }`. Other backends are rejected until implemented.
- `iteration_cap`: provisional default `1,000,000`.
- `transient_limit`: provisional default `10,000`, required to be less than the cap.
- `cycle_tolerance`: provisional default `1e-12`, constrained to at least `Number.EPSILON` and less than `1`.
- `cycle_confirmation_returns`: provisional default `2` additional returns after the first repeated-state match.
- `seed_policy`: defaults to `{ type: "critical_point", x0: 0.5 }`; an explicit reproducible seed in `[0, 1]` is also accepted.

The cap and transient defaults are initial guesses, not settled scientific thresholds. They are options on every request and are copied into the normalized contract so tests can tune them and persisted results can record the actual values used. `create_logistic_map_result(request, calculation_result)` creates a versioned envelope that preserves the normalized parameter and settings alongside calculation fields; calculation payloads cannot overwrite this provenance.

`calculate_logistic_orbit(r, options)` normalizes the request, starts at the resolved seed, and applies the recurrence no more than `iteration_cap` times. The returned sample contains `x_transient_limit` through the last computed state, inclusive. Consequently a zero transient includes `x_0`; otherwise the sample begins at the state reached after the configured number of transient iterations. The sample is bounded by the iteration cap, and `iterations_completed` reports the number of map evaluations.

After the transient, the calculator uses a tolerance-sized value bucket index to find a prior state within `cycle_tolerance`. A match is only a candidate. The calculator checks the return residual by replaying the proposed period, waits for the configured number of additional matching returns, and tests primitive period by checking reduced periods for each prime factor of the proposed period. Only then does it return `status: "cycle_candidate"`, the candidate period and points, return residual, and confirmation count. The cycle explicitly reports `validation_scope: "finite_precision"` and `mathematical_proof: false`; detection diagnostics report `evidence_scope: "finite_precision_only"`. A cap reached without an accepted candidate returns `status: "sampled_unresolved"` and preserves the bounded sample. This unresolved result includes `reason.code: "iteration_cap_reached"`. The tolerance and confirmation count are recorded in `settings` and diagnostics.

The result states are:

- `cycle_candidate`: a repeated state passed the current finite-precision residual, repeat-confirmation, and primitive-period checks. `cycle` contains its period, ordered points, return residual, and confirmation count. The `sample` and iteration counts remain available as computation context.
- `sampled_unresolved`: the cap was reached without an accepted candidate. The result includes the retained sample, explicit reason, and attempted/completed/transient/sample counts.
- `invalid_input`: request validation failed before computation. `reason` explains the validation error; no normalized settings or seed are claimed.
- `numerical_failure`: iteration produced a non-finite or out-of-domain state. The partial sample and provenance are returned, along with attempted and completed counts and the failure reason.

Valid calculation results always expose `r`, normalized `settings`, resolved `seed`, `iteration_counts`, `sample`, `cycle` (or `null`), and `reason` (or `null`). Settings record precision, cap, transient, cycle tolerance, repeat-confirmation count, and seed policy. `iterations_attempted` includes a failing update; `iterations_completed` counts successful map updates. Counts and samples stop at candidate confirmation if a candidate is found before the cap.

This is a finite-precision candidate, not proof of an exact real-valued cycle. Repeated floating-point states can be artificial periodic orbits; candidates need higher-precision or independent validation before a later stage can promote them to a stronger status. [Finite-precision study](https://pmc.ncbi.nlm.nih.gov/articles/PMC10349059/). The numerical tolerance and confirmation defaults are provisional and should be refined through tests against known periodic and chaotic cases.

## Step 6: keep numerical refinement separate

The current calculator remains the fast 16-digit discovery pass. Higher-precision reruns and Newton solving belong in a separate refinement module and must return supplemental evidence; they must not mutate or erase the original candidate and its provenance.

### Higher-precision rerun

A rerun should use the original `r.input` decimal text and the same seed policy, transient limit, and iteration budget unless the refinement request explicitly changes them. The critical seed `0.5` is exactly representable as a decimal. The current explicit-seed contract accepts only a JavaScript number, so before high-precision explicit-seed reruns are supported, extend it to preserve a decimal seed string as well. Never construct a purported high-precision input from `represented_value`, since that value has already been rounded to binary64.

The current runtime has `decimal.js` through `@fracto/sdk`, which already uses it; a new data-server module should declare `decimal.js` as a direct dependency instead of relying on that transitive availability. Use an isolated `Decimal.clone({ precision })` constructor for each refinement so precision settings do not mutate process-global arithmetic or affect concurrent work. A local feasibility experiment confirmed that a 50-digit clone leaves the base constructor at its default 20 digits.

For a periodic candidate, rerun from the original seed at the requested precision to see whether the same attracting period is found. Compare period, residual, and the set of cycle points (allowing cyclic rotation); do not compare every orbit iterate point-for-point because chaotic trajectories can separate rapidly under tiny rounding changes. A higher-precision rerun that cannot reconfirm the candidate should downgrade the refinement assessment to unresolved/inconclusive while leaving the original 16-digit result intact. Higher precision improves arithmetic evidence but is not, by itself, a proof of exact real-valued dynamics.

### Optional Newton refinement

Newton may sharpen an already detected period-`p` cycle point by solving

```text
g(x) = f_r^p(x) - x = 0
g'(x) = product(k=0..p-1, r * (1 - 2 * x_k)) - 1
```

where `x_(k+1) = f_r(x_k)`. Start from a point in the detected candidate and compute all `p` refined points from the root. Stop when the high-precision return residual meets its configured tolerance, or return an explicit non-convergence/ill-conditioning result at the iteration cap. Near a bifurcation, `g'(x)` may be close to zero, so Newton can be unstable or fail; that should preserve the unrefined candidate and report refinement failure.

Newton convergence only establishes a root candidate for `f_r^p(x)-x`; it can converge to an unstable orbit or a point whose true primitive period divides `p`. After Newton, independently recheck the return residual, primitive period, and cycle multiplier `product(k=0..p-1, r * (1 - 2 * x_k))`. An attracting candidate requires multiplier magnitude below one, with a documented margin/tolerance near the neutral boundary. Newton must never replace these checks or independently promote a result to a proven cycle.

A local feasibility calculation used the period-4 candidate at `r = 3.5`: a 50-digit Decimal clone reduced the four-step return residual from about `6.1e-17` to `1e-50` in two Newton updates; the resulting cycle multiplier was about `-0.0305`, consistent with attraction. This demonstrates that the arithmetic and refinement formula are practical for a well-conditioned candidate. It does not constitute a reusable implementation or generalize to slow/ill-conditioned cycles.

### Refinement result and validation

Store refinement as a separate child/result section keyed to the source candidate, including arithmetic backend and precision, exact parameter and seed text, rerun limits, Newton iterations if used, residual, primitive-period outcome, multiplier, and an outcome such as `confirmed_at_higher_precision`, `newton_refined_candidate`, `inconclusive`, or `refinement_failed`. Keep the initial candidate's `validation_scope: "finite_precision"` unchanged. Do not call residual tolerances “sigma” unless a statistical error model is explicitly introduced.

The first refinement implementation should test a known period-2/4/3 cycle at 16 digits and a higher precision, compare point sets up to rotation, show Newton reducing residual on a slow-converging candidate, reject/downgrade a deliberately unsuitable or unstable root, and preserve the original result on all refinement failures. Chaotic samples should not be required to match point-for-point after rerun; they should remain samples or unresolved classifications.

The tests are in `tests/logistic_map_contract.test.js`, `tests/logistic_map_calculator.test.js`, and `tests/logistic_map_behaviors.test.js`. They cover request validation, numeric representation, defaults, explicit settings/seeds, provenance, transient boundaries, sample bounds, candidate confirmation, primitive period checks, structured invalid input, fixed and period-2/period-4/period-3 cycles, a chaotic sample, parameter boundaries, short-cap behavior, and refinement by increasing the cap. A higher-precision arithmetic backend does not exist yet; requests for it are rejected as `invalid_input` rather than simulated with ordinary `Number` arithmetic.

## Initial calculation policy

The first implementation pass uses standard 16-digit floating-point arithmetic for setup speed. Treat this as a replaceable arithmetic backend, not part of the mathematical identity of a result. Keep numeric operations behind a small interface so higher precision can later run the same calculation contract and compare or refine earlier results. Every result must record the arithmetic backend and effective precision; a 16-digit finite-precision cycle is evidence for a candidate, not by itself proof of the exact real-valued orbit.

Iteration cap, transient length, cycle tolerances, and retained sample size are provisional guesses. Expose them as options rather than scattering constants through the algorithm, and adjust them using runtime, memory, and validation results. Record effective settings on every result so runs remain interpretable after defaults change.

The goal is to make as many parameter calculations as practical return a **final candidate** during the initial pass, while preserving honest unresolved outcomes for difficult cases. “Final candidate” means a result that passes the selected version's documented checks at its recorded precision; it does not claim mathematical certainty beyond those checks. Use staged checks and available budget to avoid prematurely marking a value unresolved. Still stop at the configured resource cap and mark the result partial when it cannot validate a candidate. Do not convert a capped orbit or a numerical repeat directly into a final cycle merely to increase completion counts.

## Tentative implementation plan

1. **Function contract — implemented.** Normalize `r`, precision, iteration cap, transient limit, and seed policy; return represented parameter and settings with every result.
2. **Bounded standalone iteration — implemented.** Calculate through the configured cap, return post-transient samples, and keep the module independent of HTTP and persistence.
3. **Cautious cycle candidates — implemented.** Repeated states require tolerance, return-residual, repeated-return confirmation, and primitive-period checks. Results remain numerical candidates pending higher-precision validation.
4. **Explicit result states — implemented.** Return `cycle_candidate`, `sampled_unresolved`, `invalid_input`, or `numerical_failure`; include provenance, counts, candidate/sample data, and an explanatory reason where appropriate.
5. **Known-behavior tests — implemented.** Cover fixed, period-doubled, and periodic-window cycles; chaotic and boundary cases; low caps; and refinement by increasing the cap. Precision escalation remains blocked until a higher-precision backend is implemented.
6. **Refinement strategy — evaluated.** Keep high-precision reruns and Newton in a separate, provenance-preserving stage. Decimal precision cloning and Newton sharpening were prototyped on a period-4 cycle. Rerun from original decimal inputs; compare cycle sets rather than chaotic trajectories; use Newton only to sharpen candidates, followed by residual, primitive-period, and multiplier checks.
7. **Implement higher-precision candidate validation.** Add a direct arithmetic dependency and precision-isolated rerun backend, then test confirmation/downgrade behavior against known cycles.
8. **Implement optional Newton refinement.** Add Newton only after the high-precision recurrence and validation checks are in place.
9. **Represent partial work and refinement.** Persist capped samples as provisional, record why they remain unresolved, and define upgrades that preserve provenance and avoid stale-result races.
10. **Add hierarchical packet generation.** Generate all 256 values for a packet, support complete level-1 and level-2 scans, and allow selected intervals to be subdivided deeper. Make generation resumable and idempotent.
11. **Add persistence and service interfaces.** Once schema and calculator are stable, define storage and data-server endpoints or background-job workflow. Keep CPU-bound work off the request event loop if workloads justify it.
12. **Test integrated operations.** Include repeatable packet generation, refinement upgrades, and storage recovery. Track candidate completion alongside runtime and memory so increased completion does not silently reduce quality.

This is a tentative sequence, not a commitment to a database layout, endpoint, or numerical library. Update this document when decisions are made, and document each implementation file here and in the parent `handlers/README.md` as responsibilities are added.
