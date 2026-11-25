"""Create numbered contact sheets from the actual browser captures for visual review."""
from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
import sys
root=Path('test-evidence/projects')
for d in sorted(root.iterdir()):
 if not d.is_dir():continue
 pics=[p for p in sorted(d.glob('*.png')) if p.stem not in {'contact','failure'}]
 if not pics:continue
 dw=540;dh=380
 for start in range(0,len(pics),8):
  subset=pics[start:start+8]
  out=Image.new('RGB',(dw*2,dh*((len(subset)+1)//2)), '#fff')
  for j,p in enumerate(subset):
   m=Image.open(p).convert('RGB');m.thumbnail((dw-12,dh-29)); xx=j%2*dw;yy=j//2*dh;out.paste(m,(xx,yy+20));ImageDraw.Draw(out).text((xx+4,yy+2),p.stem,fill='black')
  out.save(d/('review-'+str(start//8+1)+'.jpg'),quality=90)
