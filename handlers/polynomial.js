import Complex from "../../../sdk/math/Complex.js";

const Z = new Complex(0.121191, 0.61058)
// const Z = new Complex(-0.122561057,0.744860052)

const f = (z) => {
   return z.mul(z).add(Z); // Original function: f(z) = z^2 + z
}

export const d = (z) => {
   return z.scale(2).offset(1, 0); // Derivative of f(z)
}

export const recursive_derivative = (z, n) => {
   if (n === 1) {
      return Z; // Base case: return the function value
   }
   const g = recursive_evaluation(Z, n - 1)
   return g.mul(recursive_derivative(d(z), n - 1)); // Recursive call with the derivative
}

export const recursive_evaluation = (z, n) => {
   if (n === 1) {
      return z; // Base case: return the function value
   }
   return recursive_evaluation(f(z), n - 1); // Recursive call with the derivative
}

const evaluation = recursive_evaluation(Z, 7)
const derivative = recursive_derivative(Z, 7)

const quotient = evaluation.divide(derivative)
const closer = quotient.scale(-1).add(Z)

console.log('evaluation', evaluation.toString())
console.log('derivative', derivative.toString())
console.log('closer', closer.toString())

