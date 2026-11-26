import type { FinishBodySnapshot } from "./geometry";
import type { RefillBackingPlan } from "./refillBacking";
import type { EvaluatedFeature, Project } from "./types";
import type { WritingFit } from "./writingFit";
import type { WritingSetup } from "./writingConeSeat";

export type FitStock = { fit: WritingFit; frontSeated: boolean; backing?: RefillBackingPlan; problem?: string };
export type TurnedDiameters = { refill: number; barrel: number; cone: number; caps: number[] };
export type FitProof = { fit: WritingFit; caps: number; barrelEnds: number[]; barrelBores: number[]; diameters: TurnedDiameters; checkedBodies: FinishBodySnapshot[] };
type Common = { project: Project; setup: WritingSetup; features?: EvaluatedFeature[]; slim?: boolean };
export type WritingJob = Common & { action: "measure" | "verify" };
export type WritingAnswers = { measure: FitStock; verify: FitProof };
export type WritingRequest = <K extends keyof WritingAnswers>(job: Common & { action: K }) => Promise<WritingAnswers[K]>;
