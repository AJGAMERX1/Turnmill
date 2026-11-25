import {
  buildBodies,
  cloneBody,
  displayBodies,
  releaseBodies,
  type Body,
  type RenderBody,
} from "./geometry";
import type { BodyProps } from "./materials";
import type { EvaluatedFeature } from "./types";

interface CachedBody {
  signature: string;
  key: number;
  body: Body;
  prefix?: { signature: string; body: Body };
  properties: BodyProps;
  area: number;
}
export interface MeshChange {
  key: number;
  mesh: RenderBody;
}

/**
 * A New feature begins a separate solid. All following Add, Cut, and finishing
 * operations belong to it up to the next New. The last successful build owns
 * one OCCT shape per active solid. A failed edit never partly replaces it.
 */
export class ModelBodies {
  private entries = new Map<string, CachedBody>();
  private serial = 0;

  get bodies() {
    return Array.from(this.entries.values(), (entry) => entry.body);
  }

  clear() {
    releaseBodies(this.bodies);
    for (const entry of this.entries.values())
      entry.prefix?.body.shape.delete();
    this.entries.clear();
  }

  build(features: EvaluatedFeature[], retainedMeshes: number[] = []) {
    const histories: EvaluatedFeature[][] = [];
    for (const feature of features) {
      if (feature.operation === "new") histories.push([]);
      const history = histories.at(-1);
      if (!history)
        throw Error(
          feature.name +
            " — Add a New body earlier in the timeline, or set this operation to New body.",
        );
      history.push(feature);
    }

    const known = new Set(retainedMeshes);
    const next = new Map<string, CachedBody>();
    const created: Body[] = [],
      changes: MeshChange[] = [];
    try {
      for (const history of histories) {
        const { id, name } = history[0];
        if (next.has(id))
          throw Error(
            "Two bodies share an identifier. Open a valid project before rebuilding.",
          );
        // Feature names label STEP products and rebuild errors. Every evaluated
        // geometry input, including embedded B-reps and feature order, remains in the key.
        const signatures = history.map(({ name: _name, ...input }) =>
          JSON.stringify(input),
        );
        const signature = signatures.join(",");
        const previous = this.entries.get(id);
        if (previous && previous.signature === signature) {
          const body =
            previous.body.name === name
              ? previous.body
              : { ...previous.body, name };
          const entry =
            body === previous.body ? previous : { ...previous, body };
          next.set(id, entry);
          if (!known.has(entry.key))
            changes.push({
              key: entry.key,
              mesh: displayBodies([body]).meshes[0],
            });
          continue;
        }
        // Keep one immutable state immediately before the final feature. Repeated
        // edits to that feature can start there without replaying earlier booleans.
        let prefix: CachedBody["prefix"];
        if (history.length > 1) {
          const prefixSignature = signatures.slice(0, -1).join(",");
          if (previous?.prefix?.signature === prefixSignature) {
            prefix = previous.prefix;
          } else {
            const prefixBody =
              previous?.signature === prefixSignature
                ? cloneBody(previous.body)
                : buildBodies(history.slice(0, -1))[0];
            prefix = { signature: prefixSignature, body: prefixBody };
            created.push(prefixBody);
          }
        }
        const [body] = prefix
          ? buildBodies(history.slice(-1), { id, body: prefix.body })
          : buildBodies(history);
        body.name = name;
        created.push(body);
        const { meshes, bodyProperties, area } = displayBodies([body]);
        const key = ++this.serial;
        next.set(id, {
          key,
          signature,
          prefix,
          body,
          properties: bodyProperties[0],
          area,
        });
        changes.push({ key, mesh: meshes[0] });
      }
    } catch (error) {
      releaseBodies(created);
      throw error;
    }

    for (const [id, old] of this.entries) {
      const replacement = next.get(id);
      if (replacement?.key !== old.key) old.body.shape.delete();
      if (old.prefix && replacement?.prefix !== old.prefix)
        old.prefix.body.shape.delete();
    }
    this.entries = next;

    const keys: number[] = [],
      bodyProperties: BodyProps[] = [];
    const moment: [number, number, number] = [0, 0, 0];
    let volume = 0,
      area = 0;
    for (const entry of next.values()) {
      keys.push(entry.key);
      bodyProperties.push(entry.properties);
      area += entry.area;
      volume += entry.properties.volume;
      for (let i = 0; i < 3; i++)
        moment[i] += entry.properties.center[i] * entry.properties.volume;
    }
    const center: [number, number, number] | undefined =
      volume > 0
        ? [moment[0] / volume, moment[1] / volume, moment[2] / volume]
        : undefined;
    return { keys, changes, bodyProperties, volume, area, center };
  }
}
