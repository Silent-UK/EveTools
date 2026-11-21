import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
// CCP ESI type 96100, for catalogues built before Fractured Skies.
const synchronizationRigging = {
  id: 96100,
  name: "Synchronization Rigging",
  group_id: 269,
  category_id: 16,
  published: 1,
  volume: 0.01,
  attributes: { 4: 0, 38: 0, 161: 0.01, 162: 1, 180: 165, 181: 166, 182: 26252, 275: 5, 277: 5, 280: 0, 1047: 0, 1139: -10 },
};

export function catalog(dir) {
  const db = new DatabaseSync(join(dir, "catalog.sqlite"), { readOnly: true });
  return {
    close(){db.close();},
    ships(group){return db.prepare('SELECT id,name FROM types WHERE category_id=6 AND group_id=? AND published=1 ORDER BY name').all(group);},
    type(id) {
      const r = db.prepare("SELECT * FROM types WHERE id=?").get(Number(id));
      if (r) return { ...r, attributes: JSON.parse(r.attributes) };
      return Number(id) === synchronizationRigging.id ? structuredClone(synchronizationRigging) : null;
    },
    named(name) {
      return db
        .prepare(
          "SELECT id FROM types WHERE name=? COLLATE NOCASE AND published=1 ORDER BY id LIMIT 1",
        )
        .get(name)?.id;
    },
    search(q, skills = false) {
      return db
        .prepare(
          "SELECT id,name,category_id FROM types WHERE published=1 AND name LIKE ?" +
            (skills ? " AND category_id=16" : "") +
            " ORDER BY name LIMIT 40",
        )
        .all("%" + q.replace(/[%_]/g, "") + "%");
    },
    fittingSearch(q, category) {
      const categories={ships:[6],equipment:[7],rigs:[7,32],charges:[8],drones:[18,87],implants:[20]};
      const key=Object.hasOwn(categories,category)?category:'equipment',ids=categories[key];
      // CCP stores rigs as category 7 modules with a calibration cost; category 32 is subsystems.
      const calibration=`COALESCE(json_extract(attributes,'$."1153"'),0)`;
      const filter=key==='rigs'?`AND (category_id=32 OR ${calibration}>0)`:key==='equipment'?`AND ${calibration}<=0`:'';
      return db.prepare(`SELECT id,name,category_id FROM types WHERE published=1 AND category_id IN (${ids.map(()=>'?').join(',')}) ${filter} AND name LIKE ? ORDER BY name LIMIT 60`).all(...ids,'%'+q.replace(/[%_]/g,'')+'%');
    },
    schematic(id) {
      const r = db
        .prepare("SELECT data FROM schematics WHERE id=?")
        .get(Number(id));
      return r ? JSON.parse(r.data) : null;
    },
    piRecipes() {
      return db.prepare("SELECT data FROM schematics").all().flatMap(row=>{
        const s=JSON.parse(row.data);
        return s.types.filter(t=>!t.isInput).map(t=>{
          const type=db.prepare("SELECT name,group_id FROM types WHERE id=?").get(t._key);
          return {id:t._key,name:type?.name||String(t._key),tier:({1042:1,1034:2,1040:3,1041:4})[type?.group_id]||0,quantity:t.quantity,inputs:s.types.filter(t=>t.isInput).map(i=>({id:i._key,quantity:i.quantity,name:db.prepare("SELECT name FROM types WHERE id=?").get(i._key)?.name||String(i._key)}))};
        });
      });
    },
    operation(id) {
      const r = db
        .prepare("SELECT data FROM operations WHERE id=?")
        .get(Number(id));
      return r ? JSON.parse(r.data) : null;
    },
    close() {
      db.close();
    },
  };
}
