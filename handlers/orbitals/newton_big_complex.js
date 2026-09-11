import BigComplex from "../../../../sdk/math/BigComplex.js";
import FractoFastCalc from "../../../../sdk/FractoFastCalc.js";

/**
 * Refine an orbital point with arbitrary-precision Newton iteration.
 *
 * @param {{x:number|string,y:number|string}} point Mandelbrot parameter.
 * @param {number} limit Maximum Newton iterations.
 * @param {number} [known_cardinality] Evaluate only this cardinality when supplied.
 * @returns {object} Newton result and convergence metadata.
 */
export const newton_big_complex = (point, limit, known_cardinality = null) => {
  const P = new BigComplex(point.x, point.y);
  let least_magnitude = 1000;
  let least_magnitude_N = 0;
  let least_magnitude_point_list = [];
  const start = performance.now();
  const requested_cardinality = Number(known_cardinality);
  const cardinality_supplied =
    known_cardinality !== null &&
    known_cardinality !== undefined &&
    Number.isInteger(requested_cardinality);
  const cardinalities = cardinality_supplied
    ? [Math.max(3, requested_cardinality)]
    : Array.from({ length: 2497 }, (_, index) => index + 3);
  for (const N of cardinalities) {
    let z0 = new BigComplex(0, 0);
    for (let i = 1; i <= limit; i++) {
      let current = new BigComplex(z0.re, z0.im);
      let derivative = new BigComplex(1, 0);
      for (let k = 0; k < N; k++) {
        const doubled = current.scale(2);
        derivative = derivative.mul(doubled);
        const current_squared = current.mul(current);
        current = current_squared.add(P);
      }
      const negative_z0 = z0.scale(-1);
      const H = current.add(negative_z0);
      const H_prime = derivative.offset(-1, 0);
      const denom = H_prime.re * H_prime.re + H_prime.im * H_prime.im;
      const step = new BigComplex(
        (H.re * H_prime.re + H.im * H_prime.im) / denom,
        (H.im * H_prime.re - H.re * H_prime.im) / denom,
      );
      const negative_step = step.scale(-1);
      z0 = z0.add(negative_step);

      const step_magnitude = step.magnitude();
      if (step_magnitude > 0 && step_magnitude < least_magnitude) {
        least_magnitude = step_magnitude;
        least_magnitude_N = N;
        least_magnitude_point_list = [];
        let next_current = new BigComplex(current.re, current.im);
        for (let k = 0; k < N; k++) {
          const next_current_squared = next_current.mul(next_current);
          next_current = next_current_squared.add(P);
          least_magnitude_point_list.push(
            new BigComplex(next_current.re, next_current.im),
          );
        }
      }
    }
  }
  const end = performance.now();
  return {
    point_list: least_magnitude_point_list,
    cardinality: least_magnitude_N,
    cycles: limit,
    time: `${end - start}ms`,
    least_magnitude: least_magnitude,
    least_magnitude_N: least_magnitude_N,
    cardinality_supplied,
  };
};

// TEST
// const point = {x: -0.7498264222691475, y: 0.015174810956388776}
//
// const start1 = performance.now();
// const result1 = newton_big_complex(point, 6)
// const end1 = performance.now();
//
// const start2 = performance.now();
// const result2 = FractoFastCalc.calc(point.x, point.y)
// const end2 = performance.now();
//
// const time1 = end1 - start1
// const time2 = end2 - start2
// const iteration_1 = result1.cycles * result1.cardinality
// const iteration_2 = result2.iteration
// console.log(`result1 cardinality: ${result1.cardinality}, cycles: ${result1.cycles} (${iteration_1} iterations), time: ${time1}ms, least_magnitude: ${result1.least_magnitude}, least_magnitude_N:${result1.least_magnitude_N}`);
// console.log(`result2 cardinality: ${result2.pattern}, iteration: ${iteration_2}, time: ${time2}ms`);
// console.log(`time difference: ${time1 / time2}x, cycles difference: ${iteration_1 / iteration_2}x`)
