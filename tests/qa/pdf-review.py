"""Validate A4 drawing content and render a contact sheet for human review."""
import json,subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image,ImageOps,ImageDraw
import pdfplumber
out=Path('test-evidence/drawings')
tiles=[]
results={}
for stem,number in [('barrel','TM-BRL-01'),('assembly','TM-ASM-01')]:
    pdf=out/(stem+'.pdf')
    with pdfplumber.open(pdf) as doc:
        assert len(doc.pages)==4
        entries=[]
        for i,page in enumerate(doc.pages,1):
            assert abs(page.width*25.4/72-297)<0.01 and abs(page.height*25.4/72-210)<0.01
            text=page.extract_text() or ''
            assert number in text
            chars=page.chars
            assert all(-.05<=c['x0']<=c['x1']<=page.width+.05 and -.05<=c['top']<=c['bottom']<=page.height+.05 for c in chars),'Off-page printed text'
            entries.append({'page':i,'characters':len(chars),'minGlyphPt':min(c['size'] for c in chars),'text':text})
        if stem=='barrel':
            assert '0.75 pitch' in entries[0]['text'] and 'Detail of far end' in entries[1]['text']
        else:
            assert any('Bill of materials' in e['text'] for e in entries)
        results[stem]=entries
    with TemporaryDirectory() as tmp:
        subprocess.run(['pdftoppm','-r','72','-png',str(pdf),str(Path(tmp)/stem)],check=True)
        for p in sorted(Path(tmp).glob('*.png')):
            image=Image.open(p).convert('RGB');image.thumbnail((596,422))
            tile=Image.new('RGB',(608,447),'#dadada');tile.paste(image,((608-image.width)//2,3))
            ImageDraw.Draw(tile).text((8,428),p.stem,fill='black'); tiles.append(tile)
contact=Image.new('RGB',(1216,1788),'#dadada')
for i,tile in enumerate(tiles):contact.paste(tile,((i%2)*608,(i//2)*447))
contact.save(out/'rendered-review.jpg',quality=91)
(out/'pdf-measurements.json').write_text(json.dumps(results,indent=2)+'\n')
print('Eight PDF pages checked for A4 size, title blocks, content, and off-page glyphs.')
