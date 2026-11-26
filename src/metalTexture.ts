import {
  BufferGeometry, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  RepeatWrapping, Vector3,
} from "three";
import type { DisplayAppearance } from "./metalAppearance";

// One repeatable, mipmapped grain tile per renderer. Linear filtering and mipmaps
// blend marks that are smaller than a screen pixel during orbit and PNG capture.
export function metalGrainTile(anisotropy: number) {
  const size = 128, data = new Uint8Array(size * size * 4);
  let seed = 17;
  for (let i = 0; i < data.length; i += 4) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    data[i] = data[i + 1] = data[i + 2] = seed >>> 24;
    data[i + 3] = 255;
  }
  const tile = new DataTexture(data, size, size);
  tile.wrapS = tile.wrapT = RepeatWrapping;
  tile.magFilter = LinearFilter;
  tile.minFilter = LinearMipmapLinearFilter;
  tile.anisotropy = Math.max(1, Math.min(4, anisotropy));
  tile.generateMipmaps = true;
  tile.needsUpdate = true;
  return tile;
}

const grainFunctions = /* glsl */ `
  uniform sampler2D tmGrain;
  uniform int tmFinish;
  varying vec3 tmPoint;
  varying vec3 tmSurfaceNormal;
  float tmSample(vec2 p) { return texture2D(tmGrain, p).r - 0.5; }
  // Smooth away turning marks once the pixel footprint exceeds their spacing.
  float tmRings(float distanceMM) {
    float t = distanceMM / 0.32;
    return sin(6.2831853 * t) * (1.0 - smoothstep(0.18, 0.52, fwidth(t)));
  }
  float tmGrainAtSurface() {
    vec3 p = tmPoint;
    vec3 w = pow(abs(normalize(tmSurfaceNormal)), vec3(4.0));
    w /= max(dot(w, vec3(1.0)), 0.0001);
    if (tmFinish == 1) {
      // Axial brushing on the sides; linear lay continues across the end face.
      vec2 scale = vec2(360.0, 15.0);
      return dot(w, vec3(tmSample(p.yz/scale), tmSample(p.xz/scale), tmSample(p.xy/scale)));
    }
    if (tmFinish == 2) {
      // Turning leaves circumferential marks down the body and rings on end faces.
      return 0.45 * mix(tmRings(p.x), tmRings(length(p.yz)), w.x)
        + 0.10 * tmSample(vec2(p.x, length(p.yz)) / 9.0);
    }
    // Triplanar bead blasting has the same grain size in every direction.
    return dot(w, vec3(tmSample(p.yz/15.0), tmSample(p.xz/15.0), tmSample(p.xy/15.0)));
  }
`;

/** Local millimetre coordinates keep the lay on the metal as a part moves. A
 * cylinder's two similar transverse dimensions identify its axis, even on a short cap. */
function textureFrame(geometry: BufferGeometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new Vector3());
  const center = geometry.boundingBox!.getCenter(new Vector3());
  const transverseDifference = [Math.abs(size.y-size.z), Math.abs(size.z-size.x), Math.abs(size.x-size.y)];
  const i = transverseDifference.indexOf(Math.min(...transverseDifference));
  return { center, swizzle: ["xyz","yzx","zxy"][i] };
}

export function makeDisplayMaterial(appearance: DisplayAppearance, geometry: BufferGeometry, grain?: DataTexture) {
  const material = new MeshStandardMaterial({ color: appearance.color, metalness: appearance.metalness, roughness: appearance.roughness,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  if (!grain || appearance.finish === "polished") return material;
  const { center, swizzle } = textureFrame(geometry);
  const finish = { brushed: 1, turned: 2, "bead-blasted": 3 }[appearance.finish];
  material.customProgramCacheKey = () => "turnmill-grain-" + swizzle;
  material.onBeforeCompile = shader => {
    shader.uniforms.tmCenter = { value: center };
    shader.uniforms.tmGrain = { value: grain };
    shader.uniforms.tmFinish = { value: finish };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec3 tmCenter;\nvarying vec3 tmPoint;\nvarying vec3 tmSurfaceNormal;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        tmPoint = (position - tmCenter).${swizzle};
        tmSurfaceNormal = normal.${swizzle};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + grainFunctions)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        float tmPattern = tmGrainAtSurface();
        roughnessFactor = clamp(roughnessFactor + 0.26 * tmPattern, 0.06, 0.95);
        diffuseColor.rgb *= 1.0 + 0.10 * tmPattern;`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec3 tmDX = dFdx(-vViewPosition), tmDY = dFdy(-vViewPosition);
        vec3 tmT = cross(tmDY, normal), tmB = cross(normal, tmDX);
        float tmDet = dot(tmDX, tmT);
        vec3 tmGradient = dFdx(tmPattern)*tmT + dFdy(tmPattern)*tmB;
        normal = normalize(normal - 0.013 * sign(tmDet)*tmGradient/max(abs(tmDet), 1.0e-8));`);
  };
  return material;
}
