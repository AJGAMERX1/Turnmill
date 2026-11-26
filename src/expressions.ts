import type { Parameter } from "./types";

export function isExpression(value: string) {
  return !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
}

type Kind = "length" | "angle" | "scalar";
type Quantity = { n: number; kind: Kind | "bare" };
const units: Record<string, [number, Kind]> = {
  mm: [1, "length"],
  cm: [10, "length"],
  m: [1000, "length"],
  in: [25.4, "length"],
  inch: [25.4, "length"],
  inches: [25.4, "length"],
  ft: [304.8, "length"],
  um: [0.001, "length"],
  deg: [1, "angle"],
  rad: [180 / Math.PI, "angle"],
};
function parse(
  input: string,
  lookup: (name: string) => Quantity,
  expected: Kind,
): number {
  let source = input
    .trim()
    .replace(/["″]/g, " in ")
    .replace(/°/g, " deg ")
    .replace(/[µμ]/g, "u")
    .replace(/×/g, "*")
    .replace(/[−–]/g, "-")
    .trim();
  // A written fraction followed by a unit denotes a single quantity, e.g. 1/2 in.
  source = source.replace(
    /(^|[^\w.])((?:\d+(?:\.\d*)?|\.\d+)\s*\/\s*(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m|inches|inch|in|ft|um|deg|rad)\b/g,
    "$1($2)$3",
  );
  const tokens: string[] = [];
  const pattern =
    /\s*(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[a-zA-Z_]\w*|[()+*/-])/gy;
  let i = 0;
  while (i < source.length) {
    pattern.lastIndex = i;
    const match = pattern.exec(source);
    if (!match)
      throw Error(
        "Use numbers, named parameters, units, parentheses, or + − × /.",
      );
    tokens.push(match[1]);
    i = pattern.lastIndex;
  }
  let pos = 0;
  function atom(): Quantity {
    const token = tokens[pos++];
    let q: Quantity;
    if (token === "+" || token === "-") {
      q = atom();
      return { n: token === "-" ? -q.n : q.n, kind: q.kind };
    }
    if (token === "(") {
      q = sum();
      if (tokens[pos++] !== ")")
        throw Error("Add the missing closing parenthesis.");
    } else if (token && /^(\d|\.)/.test(token))
      q = { n: Number(token), kind: "bare" };
    else if (token && /^[a-zA-Z_]/.test(token)) q = lookup(token);
    else throw Error("Enter a number or parameter name.");
    if (Object.hasOwn(units, tokens[pos])) {
      const [factor, kind] = units[tokens[pos++]];
      if (q.kind !== "bare" && q.kind !== "scalar")
        throw Error("A quantity can only have one unit.");
      q = { n: q.n * factor, kind };
    }
    return q;
  }
  function product(): Quantity {
    let q = atom();
    while (tokens[pos] === "*" || tokens[pos] === "/") {
      const op = tokens[pos++],
        b = atom(),
        aDim = q.kind === "length" || q.kind === "angle",
        bDim = b.kind === "length" || b.kind === "angle";
      if (op === "/" && b.n === 0)
        throw Error("Cannot divide by zero. Change the denominator.");
      if (aDim && bDim && (op === "*" || q.kind !== b.kind))
        throw Error("These units cannot be combined in this field.");
      if (!aDim && bDim && op === "/")
        throw Error("This field cannot use inverse units.");
      q = {
        n: op === "*" ? q.n * b.n : q.n / b.n,
        kind:
          aDim && bDim
            ? "scalar"
            : aDim
              ? q.kind
              : bDim
                ? b.kind
                : q.kind === "bare" && b.kind === "bare"
                  ? "bare"
                  : "scalar",
      };
    }
    return q;
  }
  function sum(): Quantity {
    let q = product();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      const op = tokens[pos++],
        b = product();
      if (q.kind !== "bare" && b.kind !== "bare" && q.kind !== b.kind)
        throw Error("Add values with matching units.");
      q = {
        n: op === "+" ? q.n + b.n : q.n - b.n,
        kind: q.kind === "bare" ? b.kind : q.kind,
      };
    }
    return q;
  }
  const q = sum();
  if (pos !== tokens.length)
    throw Error(
      "Check the expression for a missing operator or an extra parenthesis.",
    );
  if (q.kind !== "bare" && q.kind !== expected)
    throw Error("Expected a " + expected + " value.");
  if (!Number.isFinite(q.n)) throw Error("Enter a finite value.");
  return q.n;
}
const dimensionTables = new WeakMap<
  Record<string, number>,
  Record<string, Kind>
>();
export function evaluate(
  expr: string,
  params: Record<string, number>,
  kind: Kind = "length",
): number {
  return parse(
    expr,
    (name) => {
      if (!Object.hasOwn(params, name))
        throw Error(
          "Unknown parameter “" +
            name +
            "”. Add it in Parameters or correct the name.",
        );
      return {
        n: params[name],
        kind: dimensionTables.get(params)?.[name] || "length",
      };
    },
    kind,
  );
}
export function resolveParameters(
  parameters: Parameter[],
): Record<string, number> {
  const byName = new Map<string, Parameter>(),
    values: Record<string, number> = Object.create(null),
    kinds: Record<string, Kind> = Object.create(null);
  for (const p of parameters) {
    if (!/^[A-Za-z_]\w*$/.test(p.name) || Object.hasOwn(units, p.name))
      throw Error("Use a unique parameter name such as barrel_length.");
    if (byName.has(p.name))
      throw Error(
        "Two parameters are named " + p.name + ". Give each a unique name.",
      );
    byName.set(p.name, p);
    kinds[p.name] = p.kind || "length";
  }
  const visiting = new Set<string>();
  function calculate(name: string): Quantity {
    if (visiting.has(name))
      throw Error(
        "Circular formula at " + name + ". Make one parameter independent.",
      );
    const p = byName.get(name);
    if (!p)
      throw Error(
        "Unknown parameter “" +
          name +
          "”. Correct the name or define it first.",
      );
    if (!Object.hasOwn(values, name)) {
      visiting.add(name);
      try {
        values[name] = parse(p.expression, calculate, kinds[name]);
      } catch (e) {
        throw Error(p.name + " — " + (e as Error).message);
      } finally {
        visiting.delete(name);
      }
    }
    return { n: values[name], kind: kinds[name] };
  }
  for (const k of byName.keys()) calculate(k);
  dimensionTables.set(values, kinds);
  return values;
}
