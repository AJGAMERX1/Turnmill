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
  points: Point[];
  constraints: Constraint[];
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
  kind: "revolve" | "extrude" | "import";
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
  id: string;
  name: string;
  kind: "revolve" | "extrude" | "import";
  points: [number, number][];
  operations?: EvaluatedAdvanced[];
  advanced?: EvaluatedAdvanced;
  brep?: string;
  ruler?: {
    ticks: [number, number][][];
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
export type Project = {
  version: 1;
  id: string;
  name: string;
  parameters: Parameter[];
  sketches: Sketch[];
  features: Feature[];
  importedFiles?: ImportedFile[];
  workspaces?: Record<string, any>;
};
