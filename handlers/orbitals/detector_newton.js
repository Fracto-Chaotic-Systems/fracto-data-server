import FractoOrbitalPoints from "@fracto/sdk/FractoOrbitalPoints.js";

/** Compatibility adapter; the SDK owns detection and Newton orchestration. */
export const discover_and_newton = (point, options = {}) =>
  FractoOrbitalPoints(point, options);
