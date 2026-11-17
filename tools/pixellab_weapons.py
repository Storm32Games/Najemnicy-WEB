# Warianty broni postaci PixelLab (create-character-state): ta sama postać, inna broń w ręku, 8 obrotów.
# Bazowy sprite rekruta ma wpaloną broń startową klasy; po zmianie broni gra bierze src/assets/units/<id>~<grupa>/
# (iso/UnitLooks.weaponSpriteId, grupy jak WEAPON_GROUPS). Koszt: ok. 10 generacji na wariant.
# Użycie: python3 tools/pixellab_weapons.py create [id ...]   - wysyła brakujące warianty (GROUPS=rifle,bow ... - wybrane)
#         python3 tools/pixellab_weapons.py fetch  [id ...]   - czeka na zadania i zapisuje obroty
# Bez listy id: wszyscy rekruci. Id zadań w PL_WEAPONS (domyślnie /tmp/pixellab_weapons.json).
import json,sys,os,io,subprocess,time,zipfile
from PIL import Image
CH={'zgrzyt':'c11c7eb6-508d-4e38-afad-d2fcc19e13f7','szept':'edd81d76-1094-4786-a008-2f11a5ab5d79','iskra':'33ad4274-57fb-4cf0-9f19-df7228bfd66f',
'lut':'ef6b6fd6-d50e-4219-9c3c-a3f91ffb4073','zero':'723b7ae4-be0b-4011-b95d-3cfa0f0f6f5a','grzmot':'270389f8-d7c9-45a0-9414-86f05ac77b17',
'aksamit':'8dc2cc7d-b33f-437e-960d-d878862fa6da','retorta':'5046ad43-aaab-4093-978c-901841ca4c92','mur':'76cfdb9c-d3d9-4d3c-b5af-fd2946c85e07',
'kruk':'dc73d50b-4df9-44c3-9104-69960914a639','bizon':'5cc3213b-9b4a-4ead-a117-b19c7f6171fb','szczurek':'b572bcbc-7453-410b-a0f6-0f78d3dc8af6',
'igla':'bd785f0d-3c25-4b02-8dff-2e90f0cecd94','sowa':'0b0a27d6-274a-49ba-a69e-3f2879d65b89','hak':'78e6a020-648e-48cb-8b3c-da7f88dba7f7',
'plesn':'f1094a30-9592-41b6-b476-944d0425110d'}
# grupa broni startowej klasy (UnitLooks.bakedWeaponGroup) - tego wariantu nie trzeba
BAKED={'hak':'rifle','sowa':'bow','szept':'bow','igla':'pistol','plesn':'pistol','lut':'pistol','iskra':'pistol','szczurek':'blade',
'zgrzyt':'blade','bizon':'blunt','grzmot':'blunt','kruk':'pistol','zero':'pistol','mur':'blade','retorta':'shotgun','aksamit':'rifle'}
WEAPON={
 'rifle':'a rusty scrap assault rifle held ready in both hands',
 'shotgun':'a double-barreled pump shotgun held ready in both hands',
 'pistol':'a heavy revolver pistol held in one hand',
 'bow':'a wooden recurve bow held in one hand and an arrow quiver on the back',
 'blade':'a long rusty machete held in one hand',
 'blunt':'a heavy sledgehammer held in both hands',
 'none':'empty bare hands with no weapon at all, fists clenched',
}
DIRS=['south','south-east','east','north-east','north','north-west','west','south-west']
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','src','assets','units')
DB=os.environ.get('PL_WEAPONS','/tmp/pixellab_weapons.json')
db=json.load(open(DB)) if os.path.exists(DB) else {}
def save(): json.dump(db,open(DB,'w'),indent=1)
def api(path,body=None):
  cmd=['curl','-sS','https://api.pixellab.ai/v2'+path]
  if body is not None: cmd+=['-X','POST','-H','Content-Type: application/json','-d',json.dumps(body)]
  return json.loads(subprocess.check_output(cmd))
def out(uid,g): return f'{ROOT}/{uid}~{g}'
def todo(ids):
  groups=os.environ.get('GROUPS',','.join(WEAPON)).split(',')
  return [(u,g) for u in ids for g in groups if g!=BAKED[u] and not os.path.exists(out(u,g)+'/south.png')]
cmd=sys.argv[1]; ids=sys.argv[2:] or list(CH)
if cmd=='create':
  for uid,g in todo(ids):
    if f'{uid}~{g}' in db: continue
    edit=(f'the character now holds {WEAPON[g]} instead of the previous weapon; the previous weapon is removed completely; '
          'same character, same face, body, clothes, colors and pose')
    r=api('/create-character-state',{'character_id':CH[uid],'edit_description':edit,'state_name':'w_'+g,'use_color_palette_from_reference':True})
    if not r.get('character_id'): print('ERR',uid,g,str(r)[:300]); continue
    db[f'{uid}~{g}']={'character_id':r['character_id'],'job':r.get('background_job_id'),'state':'w_'+g}; save(); print('submitted',uid,g)
elif cmd=='fetch':
  for uid,g in todo(ids):
    c=db.get(f'{uid}~{g}')
    if not c: continue
    while True:
      st=api('/background-jobs/'+c['job'])['status'] if c.get('job') else 'completed'
      if st=='completed': break
      if st not in ('processing','pending','queued'): print('FAIL',uid,g,st); break
      time.sleep(10)
    if st!='completed': continue
    # ZIP postaci zawiera całą grupę stanów (Idle/, w_<grupa>/ ...) - bierzemy katalog tego stanu
    z=zipfile.ZipFile(io.BytesIO(subprocess.check_output(['curl','-sS','https://api.pixellab.ai/v2/characters/'+c['character_id']+'/zip'])))
    d=out(uid,g); os.makedirs(d,exist_ok=True)
    for dr in DIRS: Image.open(io.BytesIO(z.read(f"{c['state']}/rotations/{dr}.png"))).convert('RGBA').save(f'{d}/{dr}.png',optimize=True)
    print('saved',uid,g)
