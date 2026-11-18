# Portret bestii PixelLab (generate-image-v2): opis popiersia + sprite south jako wzór postaci + portret stylu.
# portrait-character-pro rysuje dla części zwierząt ludzką twarz, stąd osobna ścieżka.
# Użycie: python3 tools/pixellab_beast_portrait.py src/assets <id> <portret_stylu.png> <katalog_wyjścia> "<opis bestii>"
# Zapisuje 16 wariantów <id>_N.png i podgląd <id>_sheet.png; wybrany kopiuje się do src/assets/portraits/<id>.png.
import json,subprocess,base64,io,time,sys
from PIL import Image
root,uid,style,out,desc=sys.argv[1:6]
def api(path,body=None):
  cmd=['curl','-sS','https://api.pixellab.ai/v2'+path]
  if body is not None: cmd+=['-X','POST','-H','Content-Type: application/json','-d','@-']
  return json.loads(subprocess.run(cmd,input=json.dumps(body) if body else None,capture_output=True,text=True).stdout)
b64=lambda p: base64.b64encode(open(p,'rb').read()).decode()
body={'description':'close-up bust portrait of the head and shoulders of a '+desc+', facing the viewer, head fills the frame, menacing, pixel art character portrait, post-apocalyptic',
 'image_size':{'width':64,'height':64},'no_background':True,
 'reference_images':[{'image':{'type':'base64','base64':b64(f'{root}/units/{uid}/south.png')},'size':{'width':64,'height':64},'usage_description':'the exact creature to portray (same colors, features, mutations)'}],
 'style_image':{'image':{'type':'base64','base64':b64(style)},'size':{'width':64,'height':64}}}
r=api('/generate-image-v2',body)
j=r.get('background_job_id') or r.get('job_id')
if not j: raise SystemExit(str(r)[:500])
while True:
  s=api('/background-jobs/'+j)
  if s.get('status')=='completed': break
  if s.get('status') not in ('processing','pending','queued'): raise SystemExit(str(s)[:500])
  time.sleep(8)
ims=s['last_response'].get('images') or [s['last_response'].get('image')]
sheet=Image.new('RGBA',(64*4*3,64*4*3),(40,32,26,255))
for i,im in enumerate(ims):
  img=Image.open(io.BytesIO(base64.b64decode(im['base64']))).convert('RGBA'); img.save(f'{out}/{uid}_{i}.png')
  big=img.resize((192,192),0); sheet.paste(big,((i%4)*192,(i//4)*192),big)
sheet.save(f'{out}/{uid}_sheet.png'); print('ok',uid,len(ims))
