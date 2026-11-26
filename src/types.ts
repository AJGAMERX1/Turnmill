import type { Advanced, EvaluatedAdvanced } from "./advancedTypes";
import type { ImportedFile } from "./exchangeTypes";
import type { Finish, EvaluatedFinish } from "./finishingTypes";
export type Point = { x: string; y: string };
export type Constraint = {
  id: string;
  type: string;
  indices: number[];
  value?: string;
};
export type Sketch = {
  id: string;
  name: string;
  partId?: string;
  points: Point[];
  constraints: Constraint[];
  sizing?: Partial<Record<"x" | "y", {
    radial: boolean;
    lower: string;
    size: string;
    coordinates: string[];
  }>>;
};
export type OperationEntry = {
  id: string;
  name: string;
  suppressed: boolean;
  operation: Advanced;
};
export type Feature = {
  id: string;
  name: string;
  kind: "revolve" | "extrude" | "import" | "merge";
  /** Consumed part history in its own coordinate frame, with its pose relative to this body. */
  merge?: {
    features: Feature[];
    transform: number[];
    targetRefill?: import("./refills").RefillComponent;
    toolRefill?: import("./refills").RefillComponent;
  };
  sourceId?: string;
  sourceIndex?: number;
  sketchId: string;
  operations?: OperationEntry[];
  advanced?: Advanced;
  finishes?: Finish[];
  bodyId?: string;
  amount: string;
  operation: "new" | "add" | "cut";
  suppressed: boolean;
};
export type EvaluatedFeature = {
  /** Applied after the last operation in an installed cartridge’s body history. */
  reverseRefillLength?: number;
  id: string;
  name: string;
  kind: "revolve" | "extrude" | "import" | "merge";
  points: [number, number][];
  operations?: EvaluatedAdvanced[];
  advanced?: EvaluatedAdvanced;
  merge?: { features: EvaluatedFeature[]; transform: number[] };
  brep?: string;
  ruler?: {
    ticks: [number, number][][];
    support?: Record<number, [number, number][]>;
    depth: number;
    placement?: import("./secondaryEngraving").ScalePlacement;
    labels?: import("./markArtwork").Artwork["outlines"];
  };
  finishes?: EvaluatedFinish[];
  edges?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    through?: { x: number; y: number };
  }[];
  amount: number;
  operation: "new" | "add" | "cut";
};
export type Parameter = {
  name: string;
  expression: string;
  label?: string;
  kind?: "length" | "angle" | "scalar";
};
export type PartTab = { id: string; name: string };
export type Project = {
  version: 1;
  id: string;
  name: string;
  parameters: Parameter[];
  sketches: Sketch[];
  features: Feature[];
  emptyParts?: PartTab[];
  importedFiles?: ImportedFile[];
  workspaces?: Record<string, any>;
};
