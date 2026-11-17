# Fauna PixelLab: zmutowane bestie (create-character-v3, 64x64, 8 obrotów, szkielet czworonoga do animacji).
# Użycie: python3 tools/pixellab_fauna.py create <id> ...         - wysyła postacie (VAR=b - drugi kandydat, SEED=n)
#         python3 tools/pixellab_fauna.py fetch <id>[:<klucz db>] - obroty do src/assets/units/<id>/
#         python3 tools/pixellab_fauna.py anim <id> ...           - paski animacji (ANIMS=walk,bite,die) do .../anims/
# Id = szablon wroga (src/core/data/enemies.ts), więc UnitLooks.enemySpriteId podpina sprite bez mapowania.
import json,sys,os,re,io,subprocess,time,zipfile,base64
from PIL import Image
STYLE=(', post-apocalyptic wasteland mutant beast, overgrown by radiation mutations, grim realistic proportions, '
       'AAA quality detailed pixel art, dramatic shading, muted desaturated dust-brown palette with sickly accents, '
       'menacing, full body, no text')
SPEC={
 'rat_mutant':('cat','giant mutated sewer rat as big as a dog, hunched heavy body, hairless scabbed grey-pink skin with torn patches '
   'of matted dark fur, bulging tumorous growths and exposed ribs on its back, long yellow chisel incisors, small glowing red eyes, '
   'long thick scaly tail, oversized clawed paws'),
 'dog_mutant':('dog','feral mutated wasteland hound, gaunt but muscular body, mangy patchy fur over raw scarred hide, '
   'jagged bone spikes erupting along the spine, oversized split jaw full of crooked fangs, drooling, one milky blind eye and '
   'one toxic green glowing eye, rusted chain collar'),
 'kretowij':('bear','colossal mutated mole beast, hulking hunched body, thick leathery hide with cracked armor-like plates, '
   'huge digging forelimbs with long hooked bone claws, eyeless snout crowned with fleshy pink star-shaped tendrils, '
   'gaping maw with rows of teeth, fur caked with dirt and rubble, pale scars'),
 # tylko mapa regionu (events.FAUNA_KINDS, bez szablonu wroga): wystarczy chód (ANIMS=walk)
 'wolf_beast':('dog','huge mutated wasteland wolf, shaggy grey-brown fur matted with dried blood, two-headed with a second '
   'smaller withered head growing from its neck, bony plates on shoulders, long bared fangs, glowing yellow eyes'),
 'boar_beast':('bear','monstrous irradiated wild boar, massive humped back covered in bristles and bony spikes, '
   'four huge curved yellowed tusks, raw tumorous patches of bare skin, small furious red eyes, muddy hooves'),
 'spider':('custom','giant mutated wasteland spider as big as a dog, eight long hairy segmented legs, bloated pale '
   'abdomen with glowing green veins and pustules, cluster of shiny red eyes, dripping fangs, seen from above at an angle'),
 'beetle':('custom','giant mutated carrion beetle as big as a dog, thick cracked iridescent dark green and rust carapace, '
   'six spiky legs, huge serrated mandibles, horn on its head, oily sheen, seen from above at an angle'),
 'scorpion':('custom','giant mutated desert scorpion as big as a car tire, eight segmented legs, cracked sun-bleached amber chitin '
   'armor plates, massive serrated pincers, high arched segmented tail with a swollen stinger dripping glowing orange venom, '
   'cluster of black eyes, rusted scrap metal embedded in its shell, seen from above at an angle'),
}
# akcje (v3: ruch z opisu, pierwsza klatka = obrót postaci)
ACT={
 'walk':'walks forward with a steady predatory gait, legs stepping in a loop',
 'bite':'lunges forward and attacks with a vicious bite / strike, then recoils back to its stance',
 'die':'is mortally wounded, staggers and collapses to the ground on its side, lies still',
}
# śmierć szczura i skorpiona: model v3 zostawiał ich stojących (3 z 4 kierunków), pixminimax kładzie je na ziemi
ACT_DIE={
 'rat_mutant':'dies: collapses and falls over onto its side, ending lying flat and motionless on the ground',
 'scorpion':'dies: collapses and falls over onto its side, ending lying flat and motionless on the ground',
}
FB=['south-east','north-east','south-west','north-west']
ALL8=['south','south-east','east','north-east','north','north-west','west','south-west']
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','src','assets','units')
DB=os.environ.get('PL_FAUNA','/tmp/pixellab_fauna.json')
db=json.load(open(DB)) if os.path.exists(DB) else {}
def save(): json.dump(db,open(DB,'w'),indent=1)
def api(path,body=None):
  cmd=['curl','-sS','https://api.pixellab.ai/v2'+path]
  if body is not None: cmd+=['-X','POST','-H','Content-Type: application/json','-d',json.dumps(body)]
  return json.loads(subprocess.check_output(cmd))
def wait(job):
  while True:
    r=api('/background-jobs/'+job)
    if r.get('status')=='completed': return r
    if r.get('status') not in ('processing','pending','queued'): raise SystemExit(f'job {job}: {str(r)[:300]}')
    time.sleep(10)
cmd,ids=sys.argv[1],sys.argv[2:]
VAR=os.environ.get('VAR','')
if cmd=='create':
  for uid in ids:
    tpl,desc=SPEC[uid]
    body={'description':desc+STYLE,'name':'fauna_'+uid+VAR,'image_size':{'width':64,'height':64},'view':'high top-down',
          'template_id':tpl,'outline':'single color black outline','detail':'high detail'}
    if os.environ.get('SEED'): body['seed']=int(os.environ['SEED'])
    r=api('/create-character-v3',body); print(uid,json.dumps(r)[:300])
    db[uid+VAR]={'character_id':r.get('character_id'),'job':r.get('background_job_id')}; save()
elif cmd=='fetch':
  for arg in ids:
    uid,key=(arg.split(':')+[arg])[:2]
    c=db[key]
    if c.get('job'): wait(c['job'])
    while True:
      ch=api('/characters/'+c['character_id'])
      if ch.get('status')=='completed' and ch.get('rotation_urls'): break
      time.sleep(10)
    d=os.environ.get('OUT',f'{ROOT}/{uid}'); os.makedirs(d,exist_ok=True)
    z=zipfile.ZipFile(io.BytesIO(subprocess.check_output(['curl','-sS','https://api.pixellab.ai/v2/characters/'+c['character_id']+'/zip'])))
    for n in z.namelist():
      m=re.match(r'[^/]+/rotations/([a-z-]+)\.png$',n)
      if m: Image.open(io.BytesIO(z.read(n))).convert('RGBA').save(f'{d}/{m.group(1)}.png',optimize=True)
    print('saved',uid,key,c['character_id'],d)
elif cmd=='anim':
  # kolejka: PixelLab ma limit równoczesnych zadań, więc zlecenia idą w miarę zwalniania slotów
  anims=os.environ.get('ANIMS','walk,bite,die').split(',')
  def out(uid,a,d): return f'{ROOT}/{uid}/anims/{a}_{d}.png'
  jobs=db.setdefault('_jobs',{}); groups=db.setdefault('_groups',{})
  queue=[(u,a,d) for u in ids for a in anims for d in (ALL8 if a=='walk' else FB)]
  while True:
    while queue:
      uid,a,d=queue[0]; k=f'{uid}/{a}/{d}'
      if os.path.exists(out(uid,a,d)) or k in jobs: queue.pop(0); continue
      body={'character_id':db[uid]['character_id'],'mode':'v3','action_description':ACT_DIE.get(uid,ACT[a]) if a=='die' else ACT[a],'frame_count':8 if a=='walk' else 6,
            'directions':[d],'animation_name':a}
      if a=='die' and uid in ACT_DIE: body.update(mode='pixminimax',frame_count=8,initial_pose='standing on all legs')
      if groups.get(f'{uid}/{a}'): body['animation_group_id']=groups[f'{uid}/{a}']
      r=api('/characters/animations',body)
      if 'background_job_ids' not in r:
        if 'slots' in str(r) or 'concurrent' in str(r): break
        print('ERR',k,str(r)[:300]); queue.pop(0); continue
      groups[f'{uid}/{a}']=r.get('animation_group_id'); jobs[k]=r['background_job_ids'][0]; save(); queue.pop(0); print('submitted',k,flush=True)
    left=0
    for k,j in list(jobs.items()):
      uid,a,d=k.split('/')
      if os.path.exists(out(uid,a,d)): continue
      r=api('/background-jobs/'+j)
      if r.get('status') in ('processing','pending','queued'): left+=1; continue
      if r.get('status')!='completed': print('FAIL',k,str(r)[:300]); del jobs[k]; save(); continue
      ims=[Image.open(io.BytesIO(base64.b64decode(i['base64']))).convert('RGBA') for i in r['last_response']['images']]
      w,h=ims[0].size; s=Image.new('RGBA',(w*len(ims),h))
      for n,im in enumerate(ims): s.paste(im,(n*w,0))
      os.makedirs(os.path.dirname(out(uid,a,d)),exist_ok=True); s.save(out(uid,a,d),optimize=True); print('saved',k,len(ims),w,flush=True)
    print('left',left,'queue',len(queue),flush=True)
    if not left and not queue: break
    time.sleep(20)
