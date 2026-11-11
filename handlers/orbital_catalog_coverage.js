/** Coverage counts catalog investigations, never mathematical nonexistence. */
export const catalog_coverage = (catalog, progress, family_budget) => {
  let remaining = progress.family_index;
  let tested_through_denominator = 0;
  const denominators = catalog.denominators.map((entry) => {
    const total = entry.families.length;
    const investigated = Math.min(total, Math.max(0, remaining));
    remaining -= investigated;
    if (investigated === total)
      tested_through_denominator = Number(entry.denominator);
    return {
      denominator: entry.denominator,
      angle_period: entry.angle_period,
      candidate_orbital_periods: entry.candidate_orbital_periods,
      investigated_families: investigated,
      total_families: total,
    };
  });
  return {
    max_denominator: catalog.max_denominator,
    catalog_version: catalog.version,
    family_budget,
    total_families: catalog.family_count,
    investigated_families: progress.family_index,
    validated_families: progress.accepted,
    unresolved_families: progress.unresolved,
    uninvestigated_families: catalog.family_count - progress.family_index,
    cache_hits: progress.cache_hits,
    tested_through_denominator,
    bound_exhausted: progress.family_index === catalog.family_count,
    denominators,
    unresolved_details: progress.unresolved_details || [],
  };
};
