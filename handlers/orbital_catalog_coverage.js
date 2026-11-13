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
    ...(catalog.angle_period_scope ? {
      angle_period_scope: catalog.angle_period_scope,
      allowed_angle_periods: catalog.allowed_angle_periods,
      unfiltered_families: catalog.unfiltered_family_count,
    } : {}),
    ...(progress.allowed_orbital_periods ? {
      source_pattern: progress.source_pattern,
      allowed_orbital_periods: progress.allowed_orbital_periods,
    } : {}),
    ...(catalog.max_angle_period === undefined
      ? {}
      : { max_angle_period: catalog.max_angle_period }),
    ...(catalog.numerator_limit === undefined
      ? {}
      : { numerator_limit: catalog.numerator_limit }),
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
