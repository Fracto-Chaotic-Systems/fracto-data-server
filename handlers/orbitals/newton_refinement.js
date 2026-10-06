import FractoOrbitalPoints from "@fracto/sdk/FractoOrbitalPoints.js";

export const refine_orbital_points = (point, cardinality, options = {}) =>
  FractoOrbitalPoints(point, {
    ...options,
    cardinality,
    cardinality_source: options.cardinality_source || "caller_supplied",
  });
