import { cast, type Shape3D } from "replicad";
import type { STEPControl_Reader } from "replicad-opencascadejs";

function stepString(token: string) {
  return token
    .slice(1, -1)
    .replace(/''/g, "'")
    .replace(
      /\\X([24])\\([\da-f]+)\\X0\\/gi,
      (_, mode: string, hex: string) => {
        const width = mode === "2" ? 4 : 8;
        if (hex.length % width) return _;
        let decoded = "";
        for (let i = 0; i < hex.length; i += width) {
          const point = parseInt(hex.slice(i, i + width), 16);
          if (point > 0x10ffff) return _;
          decoded += String.fromCodePoint(point);
        }
        return decoded;
      },
    )
    .replace(/\\X\\([\da-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

// The geometry reader has no XCAF document importer in this distribution. Read
// the product-definition metadata, then ask that same reader which solids each
// definition produced. Entity order and transformed assembly instances can differ.
function leafProducts(text: string) {
  const products = new Map<number, string>(),
    formations = new Map<number, number>();
  const definitions = new Map<number, number>(),
    assemblies = new Set<number>();
  const records =
    /'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|#(\d+)\s*=\s*(PRODUCT|PRODUCT_DEFINITION_FORMATION(?:_WITH_SPECIFIED_SOURCE)?|PRODUCT_DEFINITION|NEXT_ASSEMBLY_USAGE_OCCURRENCE)\s*\(((?:'(?:''|[^'])*'|[^';])*)\)\s*;/gi;
  for (const match of text.matchAll(records)) {
    if (!match[1]) continue;
    const id = Number(match[1]);
    const tokens = match[3].match(/'(?:''|[^'])*'|#\d+/g) ?? [];
    const refs = tokens
      .filter((token) => token.startsWith("#"))
      .map((token) => Number(token.slice(1)));
    switch (match[2].toUpperCase()) {
      case "PRODUCT": {
        const strings = tokens
          .filter((token) => token.startsWith("'"))
          .map(stepString);
        const name = strings[1]?.trim() || strings[0]?.trim();
        if (name) products.set(id, name);
        break;
      }
      case "PRODUCT_DEFINITION":
        definitions.set(id, refs[0]);
        break;
      case "NEXT_ASSEMBLY_USAGE_OCCURRENCE":
        assemblies.add(refs[0]);
        break;
      default:
        formations.set(id, refs[0]);
    }
  }
  const names = new Map<number, string>();
  for (const [id, formation] of definitions) {
    const name = products.get(formations.get(formation) ?? -1);
    if (name && !assemblies.has(id)) names.set(id, name);
  }
  return names;
}

export function componentNames(
  reader: STEPControl_Reader,
  text: string,
  solids: Shape3D[],
) {
  const names = solids.map(() => new Set<string>());
  const wanted = leafProducts(text);
  if (!wanted.size) return names.map(() => undefined);
  const model = reader.StepModel();
  const ranks = new Map<number, number>();
  try {
    // A Part 21 entity label need not equal its rank in the OpenCascade model.
    for (
      let rank = 1, count = model.NbEntities();
      rank <= count && ranks.size < wanted.size;
      rank++
    ) {
      const entity = model.Entity(rank);
      try {
        const id = model.IdentLabel(entity);
        if (wanted.has(id)) ranks.set(id, rank);
      } finally {
        entity.delete();
      }
    }
    for (const [id, rank] of ranks) {
      const count = reader.NbShapes();
      if (!reader.TransferOne(rank) || reader.NbShapes() <= count) continue;
      const raw = reader.Shape(reader.NbShapes());
      try {
        const shape = cast(raw);
        try {
          const members = shape.solids;
          try {
            for (let i = 0; i < solids.length; i++) {
              if (
                members.some((member) =>
                  member.wrapped.IsPartner(solids[i].wrapped),
                )
              )
                names[i].add(wanted.get(id)!);
            }
          } finally {
            members.forEach((member) => member.delete());
          }
        } finally {
          shape.delete();
        }
      } finally {
        raw.delete();
      }
    }
  } finally {
    model.delete();
  }
  return names.map((candidates) =>
    candidates.size === 1 ? [...candidates][0] : undefined,
  );
}
