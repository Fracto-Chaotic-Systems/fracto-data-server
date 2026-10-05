/**
 * Shared quality gate for stopping adaptive orbital-cardinality detection.
 * Keeping this common prevents one entry point from treating a short-window
 * candidate as settled while another continues collecting evidence.
 * @param {object|undefined} result Detector result.
 * @param {number} horizon Critical-orbit iterations observed.
 * @returns {boolean} Whether the evidence is sufficient to stop.
 */
export const has_sufficient_detection = (result, horizon) => {
  const detection = result?.detection;
  const cardinality = detection?.candidate_cardinality;
  return (
    detection?.status === "return_pattern_detected" &&
    Number.isInteger(cardinality) &&
    horizon >= cardinality * 10 &&
    detection.pyramid_coherence >= 0.9 &&
    detection.recurrence_quality >= 0.9 &&
    detection.confidence_margin >= 0.25 &&
    detection.ambiguous !== true
  );
};
