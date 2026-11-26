import { useState } from "react";
import { evaluate } from "./expressions";
import type { Point, Sketch } from "./types";

/** Use coordinate expressions so each face remains on its datum when dimensions change. */
export function stockProfile(sketch: Sketch, start: Point, length: string, outside: string,
  bore: string, turned: boolean, parameters: Record<string, number>): Sketch {
  evaluate(start.x, parameters);
  const span = evaluate(length, parameters);
  const height = evaluate(outside, parameters);
  const lower = turned ? bore : start.y;
  const low = evaluate(lower, parameters);
  if (span <= 0 || height <= 0) throw Error("Enter a positive length and " + (turned ? "outside diameter." : "height."));
  if (turned && (low < 0 || low >= height)) throw Error("Set the bore to zero for solid stock, or to a diameter smaller than the outside.");
  const left = `(${start.x})`, right = `${left} + (${length})`;
  const bottom = turned ? `(${lower}) / 2` : `(${lower})`;
  const top = turned ? `(${outside}) / 2` : `${bottom} + (${outside})`;
  const points = [{ x: left, y: bottom }, { x: right, y: bottom },
    { x: right, y: top }, { x: left, y: top }];
  return {
    ...sketch, points, constraints: [], capProfile: undefined,
    sizing: {
      x: { radial: false, lower: start.x, size: length, coordinates: points.map(p => p.x) },
      y: { radial: turned, lower, size: outside, coordinates: points.map(p => p.y) },
    },
  };
}

export default function SketchStock({ sketch, parameters, turned, start, onCreate, onError }: {
  sketch: Sketch; parameters: Record<string, number>; turned: boolean; start: Point;
  onCreate: (next: Sketch) => void; onError: (message: string) => void;
}) {
  const [length, setLength] = useState(turned ? "90 mm" : "24 mm");
  const [outside, setOutside] = useState(turned ? "12 mm" : "8 mm");
  const [bore, setBore] = useState("0 mm");
  return <form className="sk-size-form" aria-label={turned ? "Turned blank dimensions" : "Rectangle dimensions"}
    onSubmit={event => {
      event.preventDefault();
      try { onCreate(stockProfile(sketch, start, length.trim(), outside.trim(), bore.trim(), turned, parameters)); }
      catch (error) { onError((error as Error).message); }
    }}>
    <h3>{turned ? "Turned blank" : "Size the rectangle"}</h3>
    <p>{turned ? "Enter finished diameters. The sketch shows the section from the X axis to the outside wall." : "Build from the first corner using width and height."}</p>
    <label>{turned ? "Axial length" : "Width"}<input value={length} onChange={e => setLength(e.target.value)} /></label>
    <label>{turned ? "Outside diameter" : "Height"}<input value={outside} onChange={e => setOutside(e.target.value)} /></label>
    {turned && <label>Bore diameter<input value={bore} onChange={e => setBore(e.target.value)} /></label>}
    <button type="submit" className="sk-size-apply">{turned ? "Create blank profile" : "Create rectangle"}</button>
  </form>;
}
