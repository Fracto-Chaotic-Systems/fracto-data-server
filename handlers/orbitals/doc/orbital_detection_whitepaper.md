# Orbital Cardinality Detection in the Mandelbrot Core

## Abstract

This paper presents a method for detecting the cardinality of stable orbitals
within the main cardioid of the Mandelbrot set. Earlier numerical evidence
suggested that orbitals in the core region invariably approach a fixed point,
apparently reducing the dynamics to a one-point orbital. The analysis presented
here shows that this result is a consequence of iterating from the critical
initial state $z_0=0$, rather than an inherent property of the parameter $c$.
The method studies the critical orbit of the quadratic map

$$
z_{n+1}=z_n^2+c, \qquad z_0=0,
$$

where $c$ is a requested Mandelbrot-plane location. Candidate cardinalities
are inferred from repeated returns, recurrence residuals, and the finite
difference structure of origin-based magnitudes. A separate spectral scout
provides an angular screening method around the attracting fixed point $Q$.
The detector reports measurable evidence and confidence diagnostics; exact
periodicity is established only by an independent validation procedure.

## 1. Scope and objectives

The primary objective is to estimate the cardinality $N$ of a stable or nearly
stable orbital pattern without an unbounded brute-force search, particularly
in regions where conventional iteration requires a very large number of steps.

The method has three primary responsibilities:

1. Sample the critical orbit from the origin.
2. Identify and rank plausible return gaps.
3. Quantify evidence quality and ambiguity.

## 2. Terminology and coordinate conventions

Two different magnitudes are used and must not be conflated.

### 2.1 Origin-based detector magnitude

The return detector uses

$$
r_n=|z_n|,
$$

the actual magnitude of the orbit vector from zero. Local minima of $r_n$ are
possible near-returns to the critical point. All return gaps, recurrence
errors, and derivative-pyramid calculations use the origin-based orbit values
and do not depend on $Q$.

### 2.2 Fixed-point-centered spectral magnitude

The spectral scout computes the attracting fixed point

$$
Q=\frac{1-\sqrt{1-4c}}{2}
$$

and represents displacement from that point as $z_n-Q$. This coordinate system
is used only for polar and Fourier analysis. It is not used by the
origin-based return detector.

## 3. Critical-orbit sampling

The data server samples $z_0, z_1, \ldots,z_I$ up to a bounded iteration
horizon $I$. Each sample records its iteration number, real and imaginary
components, and origin-based radius. The normal discovery scout uses native
numbers and a contiguous default sampling cadence for the standard 4,096-step
horizon. An explicit sample limit may be supplied when a bounded sample set is
required.

When the displacement from $Q$ approaches native precision in the spectral
path, the scout recomputes the orbit with `BigComplex`. Precision is increased
adaptively up to the configured ceiling when the high-precision guard still
indicates unresolved separation.

## 4. Return-gap detection

The return detector first identifies strict local minima in the sequence
$r_n$. A large separation in the sorted minimum radii can be used to suppress
ordinary within-orbit minima and retain only the near-zero return family.

Because a true orbital return may contain alternating sub-minima, candidate
gaps are formed from pairs of nearby minima rather than only adjacent minima.
This permits composite gaps such as $3+4=7$ or longer combinations to expose a
cardinality that would otherwise be hidden by local structure.

Only gaps supported by at least five repeated minima pairs proceed to the
expensive validation stage.

## 5. Tail recurrence validation

For every surviving gap $N$, the detector compares the actual complex orbit
values separated by $N$:

$$
e_N(n)=|z_n-z_{n-N}|.
$$

The median of $e_N(n)$ over the latter half of the sampled orbit is the
candidate recurrence error. Evaluating the tail reduces the influence of the
initial transient while retaining the orbit’s actual origin-based geometry.

The detector also computes a one-step baseline error from adjacent tail samples.
The normalized recurrence quality is approximately

$$
q_N=\max\left(0,1-\frac{\operatorname{median}(e_N)}
 {\operatorname{median}(|z_n-z_{n-1}|)}\right).
$$

This is a comparative diagnostic, not a proof that $N$ is an exact period.

## 6. Derivative-pyramid coherence

The detector constructs a bounded ten-cycle sequence for each candidate:

$$
R_N=(r_0,r_N,r_{2N},\ldots,r_{10N}).
$$

Repeated finite differences produce a triangular derivative pyramid. At each
level, values whose magnitude is below a precision-scaled deadband are treated
as indeterminate. A level is coherent when all remaining values have the same
sign. Signs may alternate between successive levels; the requirement is
within-level sign consistency.

The reported pyramid coherence is

$$
\text{coherence}_N=
\frac{\text{coherent levels}}{\text{levels with meaningful values}}.
$$

The detector also reports the number of within-level sign conflicts. A conflict
is evidence against a contender’s steady progression, but the pyramid is
treated as a confidence signal rather than an absolute theorem. Harmonic
multiples of a true period can have equally coherent pyramids and are reported
as related alternatives.

## 7. Candidate confidence and ambiguity

The current confidence combines recurrence quality, separation from the best
non-harmonic alternative, supporting-minimum stability, derivative-pyramid
coherence, and repetition count. Integer multiples of the selected cardinality
are classified as harmonics and excluded from the non-harmonic confidence
margin. The response includes leading alternatives, recurrence errors, and
harmonic classification.

A candidate is marked `ambiguous` when recurrence quality, confidence
separation, or pyramid coherence is insufficient. These values are screening
diagnostics, not statistical probabilities of correctness.

## 8. Adaptive horizon policy

Adaptive detection means adapting the observation horizon used to evaluate the
critical orbit. The process begins with a bounded initial horizon and increases
it geometrically only when the evidence is insufficient. Expansion serves two
purposes: it provides enough repeated cycles for a candidate’s recurrence and
derivative pyramid to be meaningful, and it allows transient behavior to decay
before the candidate is judged.

Expansion stops when ten candidate cycles fit in the horizon, recurrence
quality and pyramid coherence reach 0.90, confidence margin reaches 0.25, and
the result is not ambiguous. The horizon remains bounded by a configured
maximum. If the evidence never reaches the stopping criteria, the result is
reported together with the maximum horizon reached rather than being treated
as an exact-period proof.

## 9. Spectral screening path

The separate `/orbital_spectrum` path converts displacement from $Q$ to an
unwrapped polar angle and evaluates windowed Fourier power. Spectral peaks are
converted to reduced rational estimates:

$$
f\approx\frac{\text{cycles}}{\text{cardinality}}.
$$

The denominator is the proposed cardinality and the numerator is the number of
angular revolutions represented by the sampled interval. Finite windows,
sampling stride, leakage, and harmonics can produce aliases, so spectral
results are suggestions only. Optional multi-analysis runs compare coprime
sampling strides, prime window lengths, and staggered starts.

## 10. Future work: orbital-point refinement

Once a cardinality has been detected and independently validated, a subsequent
stage may use it as the input to a Newton-based orbital-point refinement. That
stage is outside the scope of this paper. Newton residuals must not be
interpreted as evidence that the cardinality detector itself is correct.

## 11. Complexity and performance

For horizon $I$, orbit sampling is $O(I)$. Return-minimum discovery and the
bounded contender-gap construction are approximately linear in $I$ for the
normal bounded neighborhood. Tail recurrence validation is the principal
cost: if $K$ candidate gaps pass the repetition filter, the implementation
performs approximately $O(KI)$ comparisons and sorts each candidate’s error
list to obtain a median. The ten-cycle derivative pyramid is bounded and
small by comparison.

The experimental `detection_mode=pyramid` endpoint measures the contender sieve
independently. It reports eliminated and surviving contenders and is not yet a
replacement for return-gap ranking.

## 12. Limitations and future validation

The detector is evidence-based rather than a formal periodicity proof. Near a
fixed point, numerical convergence can make several candidate gaps look equally
recurrent. Harmonics can remain coherent, and transient geometry can produce
plausible sub-gaps. Higher precision reduces arithmetic noise but does not
remove genuine dynamical ambiguity.

The next validation stage should test each proposed cardinality against the
iteration map, reject proper divisors, verify angular progression when
applicable, and repeat near the numerical precision boundary with increased
precision. Evaluation against known orbital parameters should report accuracy,
ambiguity, selected horizon, and elapsed time together.
