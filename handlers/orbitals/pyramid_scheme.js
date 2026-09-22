const MAX_ITERATION = 1000000

const SMALLEST_DIFFERENCE = 0.000000001

export const pyramid_detect = (re, im) => {
   let z_re = 0
   let z_im = 0
   let z_re_squared = 0
   let z_im_squared = 0
   
   // Phase 1: collect iteration points
   const candidates = []
   const contenders = []
   for (let iteration = 0; iteration < MAX_ITERATION; iteration++) {
      if (iteration % 100 === 0) {
         console.log(iteration)
      }
      const magnitude = z_re_squared + z_im_squared
      if (magnitude > 4) {
         return {pattern: 0, iteration}
      }
      contenders.push([magnitude])
      z_im = 2 * z_re * z_im + im;
      z_re = z_re_squared - z_im_squared + re;
      z_re_squared = z_re * z_re
      z_im_squared = z_im * z_im
      if (iteration < 3) {
         continue
      }
      
      // Process contenders
      for (let pattern = 3; pattern < iteration; pattern++) {
         // previously eliminated
         if (Math.sign(contenders[pattern][0]) === -1) {
            continue
         }
         // pattern is a candidate
         if (candidates.includes(pattern)) {
            continue
         }
         // First derivative is zero when the points are identical
         const test_magnitude = Math.abs(contenders[iteration - pattern][0])
         const first_derivative = test_magnitude - magnitude
         if (Math.abs(first_derivative) < SMALLEST_DIFFERENCE) {
            return {pattern, iteration}
         }
         // Look for sign flips in the pattern derivatives
         let nth_derivative = first_derivative
         for (let n = 1; n < contenders[pattern].length; n++) {
            // console.log(`${iteration} ${pattern} ${n}`)
            nth_derivative = nth_derivative - contenders[pattern][n]
            if (Math.abs(nth_derivative) < SMALLEST_DIFFERENCE) {
               console.log(`${pattern} is a candidate`)
               candidates.push(pattern)
               break
            }
            if (n !== 1 && Math.sign(nth_derivative) !== Math.sign(contenders[pattern][n])) {
               contenders[pattern][0] = -Math.abs(contenders[pattern])
               break
            }
            contenders[pattern][n] = nth_derivative
         }
         if (contenders[pattern][0] > 0) {
            contenders[pattern].push(nth_derivative)
         }
      }
   }
   console.log('candidates', candidates)
}

// 5
// const re = -0.5139976166559961
// const im = 0.5650648896372433

//134
const re = -0.7483415323
const im = 0.0468383163

const result = pyramid_detect(re, im)

console.log('result', result)