# Archived orbital experiments

These modules preserve exploratory approaches that are not part of the active
orbital detection, Newton, or circuitry runtime:

- `orbital_two.js` estimates a rational theta denominator and investigates
  candidate Newton periods.
- `newton_coarse_sweep.js` ranks a bounded range of candidate periods using a
  coarse Newton pass before high-precision refinement.
- `newton_big_complex_experimental.js` contains the isolated early-exit
  Newton variant used by those investigations.

The active detector-two fallback lives in the parent directory as
`two_point_calc_newton_fallback.js`. The archived modules remain available in
Git and are referenced by the orbital pipeline stage tests, but root syntax and
format checks skip archive directories and Docker excludes them from the build
context and runtime image. Do not import these archived modules into production
handlers without reviewing and promoting the behavior deliberately.
