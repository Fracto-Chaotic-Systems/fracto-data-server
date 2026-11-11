import { REPRESENTATIVE_CONFIRMATION_REVISION } from "@fracto/sdk/orbitals/FractoRepresentativeRaySolver.js";
import {
  ORBITAL_DISCOVERY_STRATEGIES,
  stored_discovery_strategy,
} from "@fracto/sdk/orbitals/FractoOrbitalLifecycle.js";

const compact = (settings) =>
  stored_discovery_strategy(settings) ===
  ORBITAL_DISCOVERY_STRATEGIES.CATALOG_ONLY;
const keys = (details) => [
  ...new Set(
    (details || [])
      .filter((row) => row.reason === "confirmation_depth_limit")
      .map((row) => row.family_key),
  ),
];
export const needs_confirmation_repair = (settings, progress) =>
  compact(settings) &&
  (progress?.catalog_confirmation_revision ?? 1) <
    REPRESENTATIVE_CONFIRMATION_REVISION &&
  keys(progress?.catalog_coverage?.unresolved_details).length > 0;

/** Preserve the forward cursor and verified families; revisit only stale limits. */
export const prepare_confirmation_repair = (checkpoint, settings) => {
  const progress = checkpoint.catalog;
  if (
    !compact(settings) ||
    !progress ||
    (progress.confirmation_revision ?? 1) >=
      REPRESENTATIVE_CONFIRMATION_REVISION
  )
    return false;
  const retry_keys = keys(progress.unresolved_details);
  progress.confirmation_revision = REPRESENTATIVE_CONFIRMATION_REVISION;
  checkpoint.progress.catalog_confirmation_revision =
    REPRESENTATIVE_CONFIRMATION_REVISION;
  if (!retry_keys.length) return false;
  progress.confirmation_retry_keys = retry_keys;
  progress.confirmation_retry_index = 0;
  checkpoint.stage = "catalog";
  return true;
};
