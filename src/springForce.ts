import { evaluate } from "./expressions";
import { camValueOf } from "./camLaw";

export type CompressionSpring = {
  zero: string;
  preload: string;
  stiffness: string;
  maxCompression: string;
  direction: 1 | -1;
};

export function springReading(
  spring: CompressionSpring,
  position: number,
  values: Record<string, number>,
) {
  const stiffness = camValueOf(spring.stiffness, "rate", values);
  const preload = camValueOf(spring.preload, "force", values);
  const zero = evaluate(spring.zero, values);
  const maxCompression = evaluate(spring.maxCompression, values);
  if (
    ![stiffness, preload, zero, maxCompression, position].every(Number.isFinite)
  )
    throw Error("Use finite spring and slider dimensions.");
  if (stiffness <= 0 || preload < 0 || maxCompression <= 0)
    throw Error(
      "Use a positive spring stiffness and compression limit, and a nonnegative preload.",
    );
  if (spring.direction !== 1 && spring.direction !== -1)
    throw Error("Choose the direction that compresses the spring.");
  const compression = Math.max(
    0,
    preload / stiffness + spring.direction * (position - zero),
  );
  const force = compression * stiffness;
  const error =
    compression > maxCompression + 1e-9
      ? `The spring requires ${Number(compression.toFixed(4))} mm of compression, past its ${Number(maxCompression.toFixed(4))} mm limit. Reduce the slider travel or preload, or change the spring.`
      : "";
  return {
    compression,
    maxCompression,
    force,
    restoringForce: force ? -spring.direction * force : 0,
    error,
  };
}
