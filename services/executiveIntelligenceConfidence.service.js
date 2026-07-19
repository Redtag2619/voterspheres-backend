function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

export function scoreExecutiveIntelligenceConfidence({
  evidence = [],
  diagnostics = {},
  context = {},
} = {}) {
  const providerCount = Number(diagnostics.provider_count || 0);
  const successfulProviders = Number(diagnostics.successful_provider_count || 0);
  const providerCoverage = providerCount
    ? successfulProviders / providerCount
    : 0;

  const verifiedCount = evidence.filter((item) => item.verified).length;
  const verificationRatio = evidence.length ? verifiedCount / evidence.length : 0;

  const recencyRatio = evidence.length
    ? evidence.filter((item) => {
        const timestamp = new Date(item.published_at || 0).getTime();
        return Number.isFinite(timestamp) && Date.now() - timestamp <= 30 * 86400000;
      }).length / evidence.length
    : 0;

  const completenessRatio = evidence.length
    ? evidence.filter((item) => item.title && item.content && item.source).length /
      evidence.length
    : 0;

  const contextResolution = [context.candidate_name, context.state, context.office]
    .filter(Boolean).length;
  const contextScore = contextResolution >= 2 ? 1 : contextResolution === 1 ? 0.7 : 0.35;

  const volumeScore = Math.min(1, evidence.length / 8);

  const raw =
    providerCoverage * 22 +
    verificationRatio * 22 +
    recencyRatio * 18 +
    completenessRatio * 14 +
    contextScore * 12 +
    volumeScore * 12;

  const score = Math.round(clamp(raw));
  const label = score >= 80 ? "high" : score >= 60 ? "moderate" : score >= 35 ? "limited" : "low";

  return {
    score,
    label,
    factors: {
      provider_coverage_percentage: Math.round(providerCoverage * 100),
      verified_evidence_percentage: Math.round(verificationRatio * 100),
      recent_evidence_percentage: Math.round(recencyRatio * 100),
      evidence_completeness_percentage: Math.round(completenessRatio * 100),
      context_resolution_percentage: Math.round(contextScore * 100),
      evidence_volume_percentage: Math.round(volumeScore * 100),
    },
    caveats: [
      ...(evidence.length === 0 ? ["No evidence was returned by successful providers."] : []),
      ...(successfulProviders === 0 ? ["No intelligence provider completed successfully."] : []),
      ...(verificationRatio < 0.5 ? ["Less than half of the evidence is explicitly verified."] : []),
      ...(recencyRatio < 0.5 ? ["Much of the evidence is older than 30 days or lacks a date."] : []),
    ],
  };
}
