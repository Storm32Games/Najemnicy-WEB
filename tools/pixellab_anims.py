# Generowanie animacji szkieletowych PixelLab (mode skeleton-v3 = szkielet postaci, nie manekin 'template').
# Użycie: python3 tools/pixellab_anims.py run <id rekruta> [...]   (ANIMS=walk,shoot ... - wybrane animacje)
# Wynik: src/assets/units/<id>/anims/<animacja>_<kierunek>.png (pasek klatek). Pomija istniejące pliki.
import json,sys,os,base64,io,subprocess,time
from PIL import Image
CH={'zgrzyt':'c11c7eb6-508d-4e38-afad-d2fcc19e13f7','szept':'edd81d76-1094-4786-a008-2f11a5ab5d79','iskra':'33ad4274-57fb-4cf0-9f19-df7228bfd66f',
'lut':'ef6b6fd6-d50e-4219-9c3c-a3f91ffb4073','zero':'723b7ae4-be0b-4011-b95d-3cfa0f0f6f5a','grzmot':'270389f8-d7c9-45a0-9414-86f05ac77b17',
'aksamit':'8dc2cc7d-b33f-437e-960d-d878862fa6da','retorta':'5046ad43-aaab-4093-978c-901841ca4c92','mur':'76cfdb9c-d3d9-4d3c-b5af-fd2946c85e07',
'kruk':'dc73d50b-4df9-44c3-9104-69960914a639','bizon':'5cc3213b-9b4a-4ead-a117-b19c7f6171fb','szczurek':'b572bcbc-7453-410b-a0f6-0f78d3dc8af6',
'igla':'bd785f0d-3c25-4b02-8dff-2e90f0cecd94','sowa':'0b0a27d6-274a-49ba-a69e-3f2879d65b89','hak':'78e6a020-648e-48cb-8b3c-da7f88dba7f7',
'plesn':'f1094a30-9592-41b6-b476-944d0425110d',
# nomadzi (tools/pixellab_chars.py) - chód w bok do planszy karawany w intro (ANIMS=walk DIRS=east)
'nomad_trader':'ef271baa-f929-4cf5-970f-e0aa107c03b8','nomad_scout':'1405da7d-bb52-4e95-91e4-0b8a5bcc9664',
'nomad_elder':'928d7972-c4cc-479c-a025-d51d59b4458d','nomad_hunter':'1f6e4d2a-445a-4641-870c-db933316e2bf'}
ALL8=['south','south-east','east','north-east','north','north-west','west','south-west']
FB=['south-east','north-east','south-west','north-west']
SPEC={
 'walk':dict(template_animation_id='walking-8-frames',dirs=ALL8),
 'sneak':dict(template_animation_id='crouched-walking',dirs=FB),
 'crouch':dict(template_animation_id='crouching',dirs=FB),
 'shoot':dict(action_description='raises the firearm to the shoulder, aims forward and fires one shot with recoil, then holds aim',frame_count=6,dirs=FB),
 'hack':dict(action_description='kneels on one knee holding a small handheld computer terminal and types on it with fingers',frame_count=6,dirs=FB),
 'pick':dict(action_description='kneels on one knee in front of a door lock and picks the lock with two thin lockpicks, wrists twisting',frame_count=6,dirs=FB),
}
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets', 'units')
DB=os.environ.get('PL_JOBS', '/tmp/pixellab_jobs.json')
db=json.load(open(DB)) if os.path.exists(DB) else {}
def save(): json.dump(db,open(DB,'w'),indent=1)
def api(path,body=None):
  cmd=['curl','-sS','https://api.pixellab.ai/v2'+path]
  if body is not None: cmd+=['-X','POST','-H','Content-Type: application/json','-d',json.dumps(body)]
  return json.loads(subprocess.check_output(cmd))
def out(uid,anim,d): return f'{ROOT}/{uid}/anims/{anim}_{d}.png'
if sys.argv[1]=='submit':
  anims=os.environ.get('ANIMS','walk,sneak,crouch,shoot,hack,pick').split(',')
  for uid in sys.argv[2:]:
    for anim in anims:
      sp=dict(SPEC[anim]); dirs=sp.pop('dirs')
      todo=[d for d in dirs if not os.path.exists(out(uid,anim,d)) and f'{uid}/{anim}/{d}' not in db]
      if not todo: continue
      body={'character_id':CH[uid],'mode':'skeleton-v3','directions':todo,'animation_name':anim,**sp}
      r=api('/characters/animations',body)
      if 'background_job_ids' not in r: print('ERR',uid,anim,str(r)[:300]); continue
      for d,j in zip(r['directions'],r['background_job_ids']): db[f'{uid}/{anim}/{d}']=j
      save(); print('submitted',uid,anim,len(todo))
elif sys.argv[1] in ('poll','run'):
  anims=os.environ.get('ANIMS','walk,sneak,crouch,shoot,hack,pick').split(',')
  only=os.environ.get('DIRS','').split(',') if os.environ.get('DIRS') else None
  queue=[(u,a,d) for u in sys.argv[2:] for a in anims for d in SPEC[a]['dirs'] if not only or d in only] if sys.argv[1]=='run' else []
  groups={}
  while True:
    left=0
    while queue:
      uid,anim,d=queue[0]
      if os.path.exists(out(uid,anim,d)) or f'{uid}/{anim}/{d}' in db: queue.pop(0); continue
      sp=dict(SPEC[anim]); sp.pop('dirs')
      body={'character_id':CH[uid],'mode':'skeleton-v3','directions':[d],'animation_name':anim,**sp}
      if (uid,anim) in groups: body['animation_group_id']=groups[(uid,anim)]
      r=api('/characters/animations',body)
      if 'background_job_ids' not in r:
        if 'slots' in str(r): break
        print('ERR',uid,anim,d,str(r)[:300]); queue.pop(0); continue
      groups[(uid,anim)]=r.get('animation_group_id'); db[f'{uid}/{anim}/{d}']=r['background_job_ids'][0]; save(); queue.pop(0); print('submitted',uid,anim,d,flush=True)
    for key,j in list(db.items()):
      uid,anim,d=key.split('/')
      if os.path.exists(out(uid,anim,d)): continue
      r=api('/background-jobs/'+j)
      if r.get('status')=='processing' or r.get('status')=='pending' or r.get('status')=='queued': left+=1; continue
      if r.get('status')!='completed': print('FAIL',key,r.get('status'),str(r.get('last_response'))[:200]); del db[key]; save(); continue
      ims=[Image.open(io.BytesIO(base64.b64decode(i['base64']))).convert('RGBA') for i in r['last_response']['images']]
      w,h=ims[0].size; s=Image.new('RGBA',(w*len(ims),h))
      for k,im in enumerate(ims): s.paste(im,(k*w,0))
      os.makedirs(os.path.dirname(out(uid,anim,d)),exist_ok=True); s.save(out(uid,anim,d),optimize=True); print('saved',key,len(ims),w)
    print('left',left,flush=True)
    if not left and not queue: break
    time.sleep(20)
