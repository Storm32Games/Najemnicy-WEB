# Tworzenie postaci PixelLab (create-character-v3: 64x64, 8 obrotów, szkielet 'mannequin' do animacji) i portretów.
# Użycie: python3 tools/pixellab_chars.py create <id> ...   - wysyła postacie z PROMPTS (zapis id w PL_CHARS)
#         python3 tools/pixellab_chars.py fetch <id> ...    - pobiera obroty do src/assets/units/<id>/ i portret 64 px
import json,sys,os,re,base64,io,subprocess,time,zipfile
from PIL import Image
STYLE=', gritty post-apocalyptic wasteland, rusty scrap and worn leather, muted desaturated dust-brown palette, full body, human'
PROMPTS={
 'zgrzyt':'skinny wiry ordinary human man thief, weaselly shifty human face: very long thin sharp pointed nose, two large protruding front teeth showing in a sly crooked grin, small beady close-set eyes, narrow chin, thin pencil mustache, greasy slicked-back black hair, large human ears, pale stubbled skin, bare head with face clearly visible; hunched sneaky posture, patched dark leather jacket, knife in reverse grip, lockpicks and many small loot pouches on belt, dark grey and brown clothes with orange accent',
 'raider_thug':'bulky post-apocalyptic raider thug, bald head with scars, red cloth bandana over mouth, spiked scrap shoulder pad, ragged leather vest over bare arms, big wooden club studded with nails, chains on belt, heavy boots',
 'raider_gunner':'lean post-apocalyptic raider gunner, scrap metal welder goggles on forehead, dirty gas mask hanging on neck, makeshift rusty carbine rifle held ready, ammo bandolier across chest, torn brown duster coat, red armband',
 'raider_burner':'crazed post-apocalyptic raider arsonist, scorched gas mask with round lenses, homemade flamethrower with pilot flame, fuel tank strapped on back with hoses, burnt patched overalls, fire-axe on hip, soot stains',
 'raider_psycho':'shirtless post-apocalyptic raider psycho berserker, wild eyes, painted white skull face paint, red mohawk, war paint and tattoos, spiked leather wristbands, huge rusty cleaver in hand, torn trousers, frenzied stance',
 'raider_sniper':'post-apocalyptic raider sniper, hooded tattered camouflage ghillie poncho of rags, cloth face wrap with scrap scope monocle, long bolt-action hunting rifle with makeshift scope, knife on chest strap, desert sand and olive colors',
 'raider_chief':'imposing post-apocalyptic raider warlord chief, heavy armor made of car hood plates and tire rubber, horned scrap metal helmet with skull motif, red cape of torn cloth, big battle axe, revolver in belt holster, trophy teeth necklace',
 'nomad_trader':'weathered post-apocalyptic desert nomad caravan trader man, sand-colored hooded cloak and long wrapped scarf, round brass goggles pushed up on forehead, friendly bearded tanned face clearly visible, huge backpack stacked with bundles, pots, canteens and trinkets, wooden walking staff, many leather satchels, rust-orange accents',
 'nomad_scout':'lean post-apocalyptic desert nomad scout woman, tan scarf wrapped over lower face, dark dust goggles over eyes, short hooded patched poncho, brass spyglass on belt, crossbow slung on back, wrapped forearms and shins, sand beige and rust-orange colors',
 'nomad_elder':'old post-apocalyptic desert nomad elder storyteller, long grey beard, deeply wrinkled tanned face clearly visible, ochre headwrap, patched layered ochre robe hung with charms, bone amulets and small bells, tall carved walking stick with feathers, slightly hunched',
 'nomad_hunter':'sturdy post-apocalyptic desert nomad hunter woman, fur-trimmed leather coat, sand scarf around neck, wide-brim worn hat, tanned face visible, hunting spear in hand, short bow on back, dried meat strips and small pelts hanging from belt, brown and rust-orange colors',
 'captive_man':'gaunt exhausted post-apocalyptic prisoner man standing upright, unarmed civilian, wrists bound together in front with short rough rope, torn dirty linen shirt and ragged trousers, bare feet, bruised unshaven face clearly visible, short messy brown hair, pale grey and faded brown rags, frightened posture, single character only, nothing on the ground, no debris, no props',
 'captive_woman':'thin exhausted post-apocalyptic captive woman, unarmed civilian, wrists bound in front with rope, torn patched grey dress over trousers, dirty headscarf, bruised tired face clearly visible, worn sandals, rope end hanging, faded beige and grey rags, frightened hunched posture',
 'settler_man':'post-apocalyptic desert nomad villager man, unarmed civilian settler, simple patched sand-colored tunic with rope belt, loose cloth trousers, short beard, tanned face clearly visible, cloth headband, water canteen and small pouch on belt, worn sandals, beige and rust-orange colors',
 'settler_woman':'post-apocalyptic desert nomad villager woman, unarmed civilian settler, long patched ochre dress with wrapped scarf over shoulders, braided dark hair, tanned face clearly visible, woven basket carried on hip, bead necklace, worn leather sandals, beige ochre and rust-orange colors',
 'settler_elder':'frail old post-apocalyptic desert nomad villager man, unarmed civilian, white hair and short white beard, wrinkled tanned face clearly visible, long faded brown robe and sand shawl, leaning on simple wooden cane, small prayer beads, slightly hunched',
 'settler_shepherd':'young post-apocalyptic desert nomad shepherd boy, unarmed civilian, sheepskin vest over patched tunic, wide straw hat, tanned face clearly visible, long crooked shepherd staff, small horn on cord, wrapped shins, beige and brown colors',
 'settler_smith':'sturdy post-apocalyptic desert nomad village blacksmith woman, unarmed civilian, heavy scorched leather apron over rolled-up sleeves, strong arms, short cropped hair, soot-smudged tanned face clearly visible, small smithing hammer on belt, thick gloves, brown and rust-orange colors',
}
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','src','assets')
DB=os.environ.get('PL_CHARS','/tmp/pixellab_chars.json')
db=json.load(open(DB)) if os.path.exists(DB) else {}
def save(): json.dump(db,open(DB,'w'),indent=1)
def api(path,body=None,method=None):
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
    body={'description':PROMPTS[uid]+STYLE,'name':'postapo_'+uid+'_v2'+VAR,'image_size':{'width':64,'height':64},'view':'high top-down',
          'template_id':'mannequin','outline':'single color black outline','detail':'high detail'}
    r=api('/create-character-v3',body); print(uid,json.dumps(r)[:300])
    db[uid+VAR]={'character_id':r.get('character_id'),'job':r.get('background_job_id')}; save()
elif cmd=='fetch':
  for uid in ids:
    c=db[uid]
    if c.get('job'): wait(c['job'])
    while True:
      ch=api('/characters/'+c['character_id'])
      if ch.get('status')=='completed' and ch.get('rotation_urls'): break
      time.sleep(10)
    d=f'{ROOT}/units/{uid}'; os.makedirs(d,exist_ok=True)
    z=zipfile.ZipFile(io.BytesIO(subprocess.check_output(['curl','-sS','https://api.pixellab.ai/v2/characters/'+c['character_id']+'/zip'])))
    for n in z.namelist():
      m=re.match(r'[^/]+/rotations/([a-z-]+)\.png$',n)
      if m: Image.open(io.BytesIO(z.read(n))).convert('RGBA').save(f'{d}/{m.group(1)}.png',optimize=True)
    src=open(f'{d}/south.png','rb').read()
    r=api('/portrait-character-pro',{'direction':'character_to_portrait','image':{'type':'base64','base64':base64.b64encode(src).decode()},'view':'high top-down','result_size':64})
    j=r.get('background_job_id') or r.get('job_id')
    if not j: print('portrait ERR',uid,str(r)[:300]); continue
    pr=wait(j)['last_response']; im=(pr.get('images') or [pr.get('image')])[0]
    Image.open(io.BytesIO(base64.b64decode(im['base64']))).convert('RGBA').save(f'{ROOT}/portraits/{uid}.png',optimize=True)
    print('saved',uid,c['character_id'])
