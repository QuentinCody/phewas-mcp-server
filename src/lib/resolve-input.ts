import { type GenomeBuild, lookupRsid, parseVariantString, type ResolvedVariant, resolveVariant, type VariantCoord } from "@bio-mcp/shared/variants/resolve";

async function resolveIdentifier(rsid: string, builds: GenomeBuild[]): Promise<ResolvedVariant> {
  const result: ResolvedVariant = { input: { type: "rsid", value: rsid }, rsid, grch37: null, grch38: null, warnings: [] };
  await Promise.all([...new Set(builds)].map(async build => {
    try {
      const mapping = await lookupRsid(rsid, build);
      if (!mapping?.ref || mapping.alts.length !== 1) throw new Error("Missing or ambiguous alleles; supply explicit chr:pos-ref-alt coordinates and input_build.");
      const coord = { ...mapping, alt: mapping.alts[0], canonical: `${mapping.chr}:${mapping.pos}-${mapping.ref}-${mapping.alts[0]}` };
      if (build === "GRCh37") result.grch37 = coord;
      else result.grch38 = coord;
    } catch (error) {
      result.warnings.push(`${build}: ${String(error)}`);
    }
  }));
  return result;
}

/** Preserve explicit coordinates; cross-build resolution must not change their alleles. */
export async function resolvePhewasInput(variant: string, build: GenomeBuild, targets: GenomeBuild[]): Promise<ResolvedVariant> {
  const input = variant.trim();
  if (/^rs\d+$/i.test(input)) return resolveIdentifier(input.toLowerCase(), targets);
  const parsed = parseVariantString(input);
  const coord: VariantCoord = { ...parsed, canonical: `${parsed.chr}:${parsed.pos}-${parsed.ref}-${parsed.alt}` };
  const result: ResolvedVariant = {
    input: { type: build === "GRCh37" ? "grch37" : "grch38", value: input }, rsid: null,
    grch37: build === "GRCh37" ? coord : null, grch38: build === "GRCh38" ? coord : null, warnings: [],
  };
  if (!targets.some(target => target !== build)) return result;
  try {
    const mapped = await resolveVariant(result.input.type, input);
    const other = build === "GRCh37" ? mapped.grch38 : mapped.grch37;
    if (!other || other.ref !== parsed.ref || other.alt !== parsed.alt) throw new Error("Cross-build mapping would change or omit the requested alleles.");
    if (build === "GRCh37") result.grch38 = other;
    else result.grch37 = other;
    result.rsid = mapped.rsid;
    result.warnings.push(...mapped.warnings);
  } catch (error) {
    result.warnings.push(`Cross-build resolution unavailable: ${String(error)}. Input-build coordinates retained.`);
  }
  return result;
}
