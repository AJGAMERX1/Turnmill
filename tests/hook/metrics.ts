import { BoundingBox, getOC, iterTopo, measureShapeVolumeProperties, measureShapeSurfaceProperties } from "replicad";
import type { Body } from "../../src/geometry";
export function inspectBodies(bodies:Body[]){
  return bodies.map(({name,shape})=>{
    const box=new BoundingBox(), analyzer=new (getOC().BRepCheck_Analyzer)(shape.wrapped,true);
    const mass=measureShapeVolumeProperties(shape),surface=measureShapeSurfaceProperties(shape);
    try {
      getOC().BRepBndLib.AddOptimal(shape.wrapped,box.wrapped,false,false);
      const count=(kind:"face"|"edge"|"solid")=>{
        let size=0;
        for(const entry of iterTopo(shape.wrapped,kind)){size++;entry.delete();}
        return size;
      };
      return {name,volume:mass.volume,center:mass.centerOfMass,area:surface.area,bbox:box.bounds,
        faces:count("face"),edges:count("edge"),solids:count("solid"),valid:analyzer.IsValid()};
    } finally {surface.delete();mass.delete();analyzer.delete();box.delete();}
  });
}
