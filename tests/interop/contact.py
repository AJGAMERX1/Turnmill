"""Compare real application and FreeCAD renders without altering geometry or contrast."""
from PIL import Image,ImageDraw,ImageOps
from pathlib import Path
import os,json
out=Path(os.getenv('QA_INTEROP_OUT',Path(__file__).resolve().parents[2]/'test-evidence/interop'))
cases=[p.name.removesuffix('.native.json') for p in sorted(out.glob('*.native.json'))]
cases+=sorted(json.loads((out/'freecad-sources.json').read_text()))
for group in range((len(cases)+4)//5):
    names=cases[group*5:group*5+5];sheet=Image.new('RGB',(1080,30+len(names)*170),'white');draw=ImageDraw.Draw(sheet)
    for k,t in enumerate(['Turnmill isometric','FreeCAD isometric','FreeCAD front','FreeCAD zoom']):draw.text((k*270+8,5),t,fill='black')
    for i,n in enumerate(names):
        row=30+170*i;draw.text((8,row),n,fill='black')
        for k,key in enumerate(['app-iso','freecad-iso','freecad-front','freecad-detail']):
            f=out/(n+'.'+key+'.png')
            if not f.is_file():continue
            image=Image.open(f).convert('RGB');image.thumbnail((262,145));sheet.paste(image,(270*k+(270-image.width)//2,row+17+(145-image.height)//2))
    sheet.save(out/('visual-review-'+str(group+1)+'.jpg'),quality=88)
