import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { openStore as productionStore, transaction } from "../lib/store.mjs";
import { cryptoBox, hash } from "../lib/security.mjs";
import { catalog } from "../lib/catalog.mjs";
import {
  comparePlan,
  expandPlan,
  parseFitting,
  skillpoints,
} from "../lib/plans.mjs";
import { syncService, piSummary } from "../lib/sync.mjs";
// Explicit legacy-edition fixtures; production stores ship without these grants.
function openStore(dir){const db=productionStore(dir);db.prepare('INSERT OR IGNORE INTO login_whitelist VALUES(?,?)').run(668298004,'Example corporation');db.prepare('INSERT OR IGNORE INTO login_whitelist VALUES(?,?)').run(98044257,'Example allied corporation');return db;}
const key = "ab".repeat(32);
const fakeCat = {
  type(id) {
    return {
      id,
      name: "Skill " + id,
      category_id: 16,
      attributes: {
        275: 1,
        180: 165,
        181: 166,
        ...(id === 2 ? { 182: 1, 277: 3 } : {}),
      },
    };
  },
  close() {},
  search() {
    return [];
  },
  schematic() {
    return null;
  },
};
async function fixture(fn, fixtureCat = fakeCat, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tools-test-")),
    db = openStore(dir);
  let identity = {
    id: 100,
    name: "Pilot A",
    owner: "owner-a",
    expires: Date.now() + 3600000,
    scopes: [],
  };
  const { app, corp, usersReview, recruitMembership, groupEnrolment } = createApp({
    fittingSimulator:()=>({}),
    base: "http://127.0.0.1",
    data: dir,
    key,
    db,
    cat: fixtureCat,
    owner: 100,
    corporationId:668298004,corporationName:'Example corporation',corporationTicker:'STEMP',allianceTicker:'FRT',
    client: "test",
    secret: "test",
    eve: {},
    membershipLookup:async()=>({corporation_id:668298004}),
    exchange: async () => ({ access_token: "fake", refresh_token: "fake" }),
    verifyToken: async () => identity,
    ...overrides,
  });
  if(!overrides.corporationId||overrides.corporationId===668298004)db.prepare("INSERT OR IGNORE INTO login_whitelist VALUES(?,?)").run(98044257,'Example allied corporation');
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (
    path,
    { session, body, method = "GET", origin = "http://127.0.0.1", cookie } = {},
  ) =>
    fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        ...(session ? { cookie: "tools_session=" + session } : {}),
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined
          ? { "content-type": "application/json", origin }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const user = (id, name) => {
    const uid = Number(
      db.prepare("INSERT INTO users(main_id,name) VALUES(?,?)").run(id, name)
        .lastInsertRowid,
    );
    db.prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)").run(
      id,
      uid,
      name,
      "owner-" + id,
      cryptoBox(key).seal({ refresh_token: "secret" }),
      "[]",
      Date.now() + 10000,
    );
    const session = "session-" + id;
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(session),
      uid,
      Date.now() + 100000,
    );
    return { uid, session };
  };
  try {
    await fn({ db, request, user, corp, usersReview, recruitMembership, groupEnrolment, identity: (v) => (identity = v) });
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
test("encrypted credentials authenticate ciphertext and reject wrong keys", () => {
  const box = cryptoBox(key),
    sealed = box.seal({ token: "private" });
  assert.ok(!sealed.includes("private"));
  assert.deepEqual(box.open(sealed), { token: "private" });
  assert.throws(() => cryptoBox("cd".repeat(32)).open(sealed));
});
test("training plan expands and deduplicates prerequisites in order", () => {
  assert.deepEqual(
    expandPlan(
      [
        { id: 2, level: 4 },
        { id: 1, level: 2 },
      ],
      fakeCat,
    ),
    [
      { id: 1, level: 3 },
      { id: 2, level: 4 },
    ],
  );
  assert.throws(() => expandPlan([{ id: 1, level: 6 }], fakeCat));
  assert.equal(skillpoints(1, 5), 256000);
});
test("plan estimate uses partial SP, selected speed and active skill levels", () => {
  const skills = {
    skills: [
      {
        skill_id: 1,
        trained_skill_level: 1,
        active_skill_level: 0,
        skillpoints_in_skill: 250,
      },
    ],
  };
  const r = comparePlan(
    [{ id: 1, level: 1 }],
    skills,
    [],
    { intelligence: 20, memory: 20 },
    fakeCat,
  );
  assert.equal(r.seconds, 0);
  assert.equal(r.ready, false);
  const omega = comparePlan(
      [{ id: 1, level: 2 }],
      skills,
      [],
      { intelligence: 20, memory: 20 },
      fakeCat,
    ),
    alpha = comparePlan(
      [{ id: 1, level: 2 }],
      skills,
      [],
      { intelligence: 20, memory: 20 },
      fakeCat,
      true,
    );
  assert.ok(Math.abs(alpha.seconds - omega.seconds * 2) <= 1);
});
test("anonymous users cannot read data or shared documents", () =>
  fixture(async ({ request }) => {
    for (const path of [
      "/api/me",
      "/api/characters",
      "/api/assets",
      "/api/documents",
      "/api/operations/pi",
      "/api/admin/whitelist",
    ])
      assert.equal((await request(path)).status, 401);
  }));
test("owner isolation, CSRF and shared document permissions", () =>
  fixture(async ({ request, user, db }) => {
    const a = user(1, "A"),
      b = user(2, "B");
    assert.equal(
      (await request("/api/characters/2/skills", { session: a.session }))
        .status,
      404,
    );
    assert.equal(
      (
        await request("/api/sync", {
          session: a.session,
          method: "POST",
          body: {},
          origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    const saved = await request("/api/documents", {
      session: a.session,
      method: "POST",
      body: {
        kind: "plan",
        name: "Private",
        body: [{ id: 1, level: 3 }],
        shared: false,
      },
    });
    const { id } = await saved.json();
    assert.equal(
      (await request("/api/documents/" + id, { session: b.session })).status,
      404,
    );
    await request("/api/documents/" + id, {
      session: a.session,
      method: "PATCH",
      body: { shared: true },
    });
    assert.equal(
      (await request("/api/documents/" + id, { session: b.session })).status,
      200,
    );
    assert.equal(
      (
        await request("/api/documents/" + id, {
          session: b.session,
          method: "DELETE",
          body: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/documents/" + id, {
          session: b.session,
          method: "PUT",
          body: {
            name: "Stolen edit",
            body: [{ id: 1, level: 5 }],
            shared: true,
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/documents/" + id, {
          session: a.session,
          method: "PUT",
          body: {
            name: "Updated plan",
            body: [{ id: 1, level: 4 }],
            shared: true,
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/admin/whitelist", {
          session: a.session,
          method: "POST",
          body: {},
        })
      ).status,
      403,
    );
    db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(
      2,
      "assets",
      JSON.stringify({
        items: [{ item_id: 42, type_id: 1, quantity: 2, root_location_id: 9 }],
        locations: { 9: "Secret base" },
      }),
      Date.now(),
      Date.now() + 1000,
    );
    const result = await (
      await request("/api/assets", { session: a.session })
    ).json();
    assert.equal(result.total, 0);
  }));
test("main cannot be removed and alt data is removed on unlink", () =>
  fixture(async ({ request, user, db }) => {
    const a = user(1, "A");
    assert.equal(
      (
        await request("/api/characters/1", {
          session: a.session,
          method: "DELETE",
          body: {},
        })
      ).status,
      400,
    );
    db.prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)").run(
      3,
      a.uid,
      "Alt",
      "owner",
      "sealed",
      "[]",
      0,
    );
    db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(
      3,
      "skills",
      "{}",
      0,
      0,
    );
    assert.equal(
      (
        await request("/api/characters/3", {
          session: a.session,
          method: "DELETE",
          body: {},
        })
      ).status,
      200,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM snapshots").get().n, 0);
  }));
test("whitelist registration rejects outsiders, permits both corporations and prevents OAuth replay",async()=>{
 let corporation=999,fail=false;
 await fixture(async({request,db,identity})=>{
  const flow=code=>db.prepare('INSERT INTO oauth VALUES(?,?,?,?,?,?)').run(hash(code),hash('browser'),null,hash('legacy-invite'),'verifier',Date.now()+10000);
  const login=async(code,id)=>{identity({id,name:'Pilot '+id,owner:'owner-'+id,expires:Date.now()+100000,scopes:[]});flow(code);return request('/auth/callback?state='+code+'&code=x',{cookie:'tools_oauth=browser'});};
  assert.equal((await login('outside',200)).status,403);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,0);
  fail=true;assert.equal((await login('unavailable',200)).status,503);fail=false;
  corporation=668298004;assert.equal((await login('stemp',200)).status,302);
  assert.equal((await request('/auth/callback?state=stemp&code=x',{cookie:'tools_oauth=browser'})).status,400);
  corporation=98044257;assert.equal((await login('knights',300)).status,302);
  corporation=999;assert.equal((await login('existing-outside',200)).status,403);
  assert.equal((await login('owner-outside',100)).status,403);
  corporation=668298004;assert.equal((await login('owner',100)).status,302);
 },fakeCat,{membershipLookup:async()=>{if(fail)throw Error('ESI offline');return {corporation_id:corporation};}});
});

test("whitelist administration blocks removed corporations and keeps the owner's corporation",async()=>{
 await fixture(async({request,user,db})=>{
  const owner=user(100,'Owner'),member=user(200,'Member');
  const list=await(await request('/api/admin/whitelist',{session:owner.session})).json();assert.equal(list.length,2);
  assert.equal((await request('/api/me',{session:member.session})).status,200);
  assert.equal((await request('/api/admin/whitelist/98044257',{session:member.session,method:'DELETE',body:{}})).status,403);
  assert.equal((await request('/api/admin/whitelist/98044257',{session:owner.session,method:'DELETE',body:{},origin:'https://evil.test'})).status,403);
  assert.equal((await request('/api/admin/whitelist/668298004',{session:owner.session,method:'DELETE',body:{}})).status,400);
  assert.equal((await request('/api/admin/whitelist/98044257',{session:owner.session,method:'DELETE',body:{}})).status,200);
  assert.equal((await request('/api/me',{session:member.session})).status,403);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(member.uid).n,0);
  assert.equal((await request('/api/admin/invites',{session:owner.session})).status,404);
  assert.equal((await request('/api/admin/invites',{session:owner.session,method:'POST',body:{}})).status,404);
  assert.equal((await request('/api/admin/whitelist',{session:owner.session,method:'POST',body:{corporation_id:98044257}})).status,200);
 },fakeCat,{membershipLookup:async id=>({corporation_id:id===100?668298004:98044257}),eve:{publicGet:async()=>({name:'Sacred Templar Knights'})}});
});

test("existing sessions fail closed when membership cannot be verified",async()=>{
 await fixture(async({request,user,db})=>{
  const u=user(100,'Owner');assert.equal((await request('/api/me',{session:u.session})).status,503);
  assert.equal((await request('/API/me',{session:u.session})).status,503);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);
 },fakeCat,{membershipLookup:async()=>{throw Error('ESI unavailable');}});
});

test("alt cannot be attached to another account and linking session must match", () =>
  fixture(async ({ request, user, db, identity }) => {
    const a = user(1, "A"),
      b = user(2, "B");
    identity({
      id: 2,
      name: "B",
      owner: "owner-2",
      expires: Date.now() + 10000,
      scopes: [],
    });
    db.prepare("INSERT INTO oauth VALUES(?,?,?,?,?,?)").run(
      hash("link"),
      hash("browser"),
      a.uid,
      null,
      "v",
      Date.now() + 10000,
    );
    const r = await request("/auth/callback?state=link&code=x", {
      cookie: "tools_oauth=browser; tools_session=" + a.session,
    });
    assert.equal(r.status, 409);
    assert.equal(
      db.prepare("SELECT user_id FROM characters WHERE id=2").get().user_id,
      b.uid,
    );
  }));
test("sync keeps previous complete data when a source fails", () =>
  fixture(async ({ db, user }) => {
    const a = user(1, "A");
    db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(
      1,
      "assets",
      JSON.stringify({ items: [{ item_id: 1 }], locations: {} }),
      1,
      1,
    );
    const svc = syncService(
      db,
      {
        get: async () => {
          throw Error("outage");
        },
        request: async () => {
          throw Error("outage");
        },
      },
      fakeCat,
    );
    svc.queue(a.uid);
    await svc.tick();
    assert.equal(
      JSON.parse(
        db.prepare("SELECT data FROM snapshots WHERE kind='assets'").get().data,
      ).items.length,
      1,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM sync_errors").get().n, 8);
  }));
test("PI identifies launchpads and flags factory capacity as estimates", () => {
  const cat = {
    type: (id) => ({ name: "Item " + id, group_id: id === 5 ? 1030 : 0 }),
    schematic: () => null,
  };
  const result = piSummary(
    [
      {
        pins: [
          { pin_id: 7, type_id: 5, contents: [{ type_id: 8, amount: 100 }] },
          {
            pin_id: 9,
            type_id: 6,
            expiry_time: "2000-01-01",
            extractor_details: {
              product_type_id: 8,
              qty_per_cycle: 10,
              cycle_time: 60,
            },
          },
        ],
      },
    ],
    cat,
  );
  assert.equal(result[0].launchpads[0].contents[0].amount, 100);
  assert.equal(result[0].production[0].perHour, 0);
});
test("official catalogue resolves an Avatar plan and rejects unknown fitting items", () => {
  const cat = catalog("data");
  try {
    const fit = parseFitting("[Avatar, Test]\nDamage Control II", cat);
    assert.ok(fit.requirements.length > 5);
    assert.ok(fit.requirements.every((r) => cat.type(r.id).category_id === 16));
    assert.throws(() => parseFitting("[Avatar, Bad]\nImaginary Module", cat));
  } finally {
    cat.close();
  }
});

test("paginated assets publish only after every page succeeds", () =>
  fixture(async ({ db, user }) => {
    const a = user(1, "A");
    let failing = true;
    const eve = {
      get: async (path) => {
        throw Error("unavailable");
      },
      publicGet: async () => ({ name: "Station" }),
      request: async (path) => {
        if (path.includes("page=2") && failing) throw Error("outage");
        return {
          pages: 2,
          data: [
            {
              item_id: path.includes("page=2") ? 2 : 1,
              type_id: 1,
              location_id: 60000001,
              quantity: 1,
            },
          ],
        };
      },
    };
    const svc = syncService(db, eve, fakeCat);
    svc.queue(a.uid);
    await svc.tick();
    assert.equal(
      db.prepare("SELECT count(*) n FROM snapshots WHERE kind='assets'").get()
        .n,
      0,
    );
    failing = false;
    svc.queue(a.uid);
    await svc.tick();
    const data = JSON.parse(
      db.prepare("SELECT data FROM snapshots WHERE kind='assets'").get().data,
    );
    assert.equal(data.items.length, 2);
    assert.equal(data.locations[60000001], "Station");
  }));

test("queue separates active training and ignores completed entries", async () => {
  const { splitQueue, skillGroups } = await import("../public/view-models.mjs");
  const q = [
    { queue_position: 0, start_date: "2026-01-01", finish_date: "2026-01-02" },
    { queue_position: 1, start_date: "2026-01-02", finish_date: "2026-01-04" },
    { queue_position: 2, start_date: "2026-01-04", finish_date: "2026-01-05" },
  ];
  const result = splitQueue(q, Date.parse("2026-01-03"));
  assert.equal(result.current, q[1]);
  assert.deepEqual(result.waiting, [q[2]]);
  assert.equal(splitQueue([{ queue_position: 0 }]).current, undefined);
  assert.deepEqual(
    skillGroups([
      { name: "B", group: "Shield" },
      { name: "A", group: "Armor" },
    ]).map((g) => g.name),
    ["Armor", "Shield"],
  );
});
test("PI combines final output and launchpad stock without intermediate products", () => {
  const cat = {
    type: (id) => ({ name: String(id), group_id: id === 99 ? 1030 : 0 }),
    schematic: (id) =>
      id === 1
        ? {
            cycleTime: 3600,
            types: [
              { _key: 10, isInput: true, quantity: 40 },
              { _key: 20, isInput: false, quantity: 5 },
            ],
          }
        : null,
  };
  const [p] = piSummary(
    [
      {
        pins: [
          {
            extractor_details: {
              product_type_id: 10,
              cycle_time: 1800,
              qty_per_cycle: 100,
            },
            expiry_time: "2026-01-01",
          },
          { schematic_id: 1 },
          { schematic_id: 1 },
          { type_id: 99, contents: [{ type_id: 20, amount: 300 }] },
        ],
      },
    ],
    cat,
    Date.parse("2026-01-02"),
  );
  assert.deepEqual(p.finalProducts, [
    { type_id: 20, name: "20", perHour: 10, stored: 300 },
  ]);
  assert.equal(p.status, "Extractors stopped");
  assert.equal(p.resetAt, "2026-01-01");
  const [factory] = piSummary([{ pins: [{ schematic_id: 1 }] }], cat);
  assert.equal(factory.resetAt, null);
  assert.equal(factory.status, "Production status unknown");
});

test("asset grouping keeps a station together and respects character ownership", () =>
  fixture(async ({ db, user, request }) => {
    const owner = user(100, "Owner"),
      other = user(200, "Other");
    for (const id of [100, 200])
      db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(
        id,
        "assets",
        JSON.stringify({
          items: Array.from({ length: 125 }, (_, i) => ({
            item_id: i,
            type_id: 1,
            quantity: 1,
            location_id: 6001,
            root_location_id: 6001,
            location_flag: "Hangar",
          })),
          locations: { 6001: "Station" },
        }),
        Date.now(),
        Date.now() + 60000,
      );
    const result = await (
      await request("/api/assets", { session: owner.session })
    ).json();
    assert.equal(result.total, 125);
    assert.equal(result.locationCount, 1);
    assert.equal(result.locations[0].items.length, 125);
    assert.ok(result.locations[0].items.every((i) => i.character_id === 100));
    const filtered = await (
      await request("/api/assets?location=missing", { session: owner.session })
    ).json();
    assert.equal(filtered.locations.length, 0);
    assert.deepEqual(result.asset_safety.map(p=>p.id),[100]);
    const name=result.locations[0].items[0].name;
    const exact=await (await request('/api/assets?exact=true&q='+encodeURIComponent(name.toUpperCase()),{session:owner.session})).json();
    assert.equal(exact.total,125);
    const partial=await (await request('/api/assets?exact=true&q='+encodeURIComponent(name+' extra'),{session:owner.session})).json();
    assert.equal(partial.total,0);

  }));

test("character order is main-first, persistent and shared with operations", () =>
  fixture(async ({ db, user, request }) => {
    const owner = user(500, "Z Main"),
      outsider = user(900, "Other");
    const add = (id, name) =>
      db
        .prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)")
        .run(id, owner.uid, name, "owner", "unused", "[]", 0);
    add(700, "Z Alt");
    add(600, "A Alt");
    const list = async (path) =>
      (await (await request(path, { session: owner.session })).json()).map(
        (c) => c.id,
      );
    assert.deepEqual(await list("/api/characters"), [500, 700, 600]);
    assert.equal(
      (
        await request("/api/characters/order", {
          session: owner.session,
          method: "POST",
          body: { ids: [500, 600, 700] },
        })
      ).status,
      200,
    );
    assert.deepEqual(await list("/api/operations/pi"), [500, 600, 700]);
    assert.deepEqual(await list("/api/operations/dens"), [500, 600, 700]);
    assert.equal(
      (
        await request("/api/characters/order", {
          session: owner.session,
          method: "POST",
          body: { ids: [600, 500, 700] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/characters/order", {
          session: owner.session,
          method: "POST",
          body: { ids: [500, 900, 700] },
        })
      ).status,
      400,
    );
    add(800, "New Alt");
    assert.deepEqual(await list("/api/characters"), [500, 600, 700, 800]);
  }));
test("manual sync targets owned character and refreshes fresh snapshots", () =>
  fixture(async ({ db, user, request }) => {
    const a = user(100, "A"),
      b = user(200, "B");
    for (const id of [100, 200])
      db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(
        id,
        "skills",
        "{}",
        Date.now(),
        Date.now() + 3600000,
      );
    assert.notEqual(
      (
        await request("/api/characters/200/sync", {
          session: a.session,
          method: "POST",
          body: {},
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/characters/100/sync", {
          session: a.session,
          method: "POST",
          body: {},
        })
      ).status,
      200,
    );
    assert.equal(
      db.prepare("SELECT expires FROM snapshots WHERE character_id=100").get()
        .expires,
      0,
    );
    assert.ok(
      db.prepare("SELECT expires FROM snapshots WHERE character_id=200").get()
        .expires > Date.now(),
    );
    assert.deepEqual(
      db
        .prepare("SELECT character_id FROM jobs")
        .all()
        .map((r) => r.character_id),
      [100],
    );
  }));

test("industry sync requires permission and publishes all blueprint pages atomically", () =>
  fixture(async ({ db, user, request }) => {
    const a = user(100, "Industrialist"),
      b = user(200, "Other");
    let failing = true,
      industryCalls = 0;
    const eve = {
      get: async (path) => {
        if (path.includes("industry/jobs")) {
          industryCalls++;
          return [
            {
              job_id: 1,
              blueprint_type_id: 1,
              station_id: 60000001,
              status: "active",
              runs: 10,
            },
          ];
        }
        throw Error("unused");
      },
      publicGet: async () => ({ name: "Factory" }),
      request: async (path) => {
        if (!path.includes("blueprints")) throw Error("unused");
        if (path.endsWith("page=2") && failing) throw Error("page failure");
        return {
          pages: 2,
          data: [
            {
              item_id: path.endsWith("page=2") ? 2 : 1,
              type_id: 1,
              location_id: 60000001,
              quantity: -2,
              runs: 5,
              material_efficiency: 10,
              time_efficiency: 20,
            },
          ],
        };
      },
    };
    const svc = syncService(db, eve, fakeCat);
    svc.queue(a.uid);
    await svc.tick();
    assert.equal(industryCalls, 0);
    assert.match(
      db.prepare("SELECT message FROM sync_errors WHERE kind='industry'").get()
        .message,
      /Reconnect/,
    );
    db.prepare("UPDATE characters SET scopes=? WHERE id=100").run(
      JSON.stringify([
        "esi-industry.read_character_jobs.v1",
        "esi-characters.read_blueprints.v1",
      ]),
    );
    svc.queue(a.uid);
    await svc.tick();
    assert.equal(
      db.prepare("SELECT count(*) n FROM snapshots WHERE kind='industry'").get()
        .n,
      0,
    );
    failing = false;
    svc.queue(a.uid);
    await svc.tick();
    const data = JSON.parse(
      db.prepare("SELECT data FROM snapshots WHERE kind='industry'").get().data,
    );
    assert.equal(data.blueprints.length, 2);
    assert.equal(data.jobs.length, 1);
    assert.equal(data.blueprints[0].location, "Factory");
    const own = await (
      await request("/api/operations/industry", { session: a.session })
    ).json();
    assert.equal(own[0].data.jobs.length, 1);
    const other = await (
      await request("/api/operations/industry", { session: b.session })
    ).json();
    assert.equal(other[0].data, null);
  }));

test("fitting view groups modules, loaded charges, drones and cargo",async()=>{
 const {fittingView}=await import("../lib/fitting-view.mjs");
 const cat=catalog("data");
 try {
 const fit=fittingView("[Rifter, Test]\nDamage Control II\n[Empty Low slot]\n1MN Afterburner II\n200mm AutoCannon II, EMP S\nSmall Projectile Burst Aerator I\n\nWarrior II x2\nEMP S x1000",cat);
 assert.equal(fit.ship.name,"Rifter");
 assert.equal(fit.groups.find(g=>g.name==="Low slots").items.length,2);
 assert.equal(fit.groups.find(g=>g.name==="High slots").items[0].charges[0].name,"EMP S");
 assert.equal(fit.groups.find(g=>g.name==="Drones").items[0].quantity,2);
 assert.equal(fit.groups.find(g=>g.name==="Cargo").items[0].quantity,1000);
 }finally{cat.close();}
});

test("training overview exposes only owned characters and compact skill data",()=>fixture(async({db,user,request})=>{
 const a=user(100,"Main"),b=user(200,"Other");
 db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(100,"skills",JSON.stringify({skills:{total_sp:12345,skills:[{skill_id:1}]},queue:[{skill_id:1,queue_position:0}]}),Date.now(),Date.now()+3600000);
 const result=await(await request("/api/skills/overview",{session:a.session})).json();
 assert.equal(result.length,1);assert.equal(result[0].id,100);assert.equal(result[0].total_sp,12345);assert.equal(result[0].queue.length,1);assert.equal(result[0].skills,undefined);
 const other=await(await request("/api/skills/overview",{session:b.session})).json();assert.equal(other[0].total_sp,null);
}));

test("clones calculate cooldown, sort locations and preserve implants",()=>fixture(async({db,user})=>{
 const a=user(100,"Main");db.prepare("UPDATE characters SET scopes=? WHERE id=100").run(JSON.stringify(["esi-clones.read_clones.v1","esi-clones.read_implants.v1"]));
 db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(100,"assets",JSON.stringify({locations:{2:"Zulu"}}),0,0);
 const eve={get:async path=>{
 if(path.endsWith("/clones"))return {last_clone_jump_date:"2026-10-18T00:00:00Z",jump_clones:[{jump_clone_id:1,name:"Combat",location_id:2,location_type:"station",implants:[1]},{jump_clone_id:2,name:"Training",location_id:1,location_type:"station",implants:[]}]};
 if(path.endsWith("/implants"))return [1];
 if(path.endsWith("/skills"))return {skills:[{skill_id:33399,active_skill_level:5},{skill_id:24242,active_skill_level:5},{skill_id:33407,active_skill_level:3},{skill_id:73910,active_skill_level:0,trained_skill_level:5}]};
 throw Error("unused");},publicGet:async path=>{if(path==='/universe/stations/2')throw Error('Access denied');if(path.startsWith('/universe/stations/'))return {name:path.endsWith('/1')?'Alpha':'Zulu',system_id:path.endsWith('/1')?10:20};if(path==='/universe/systems/10')return {name:'Test System',constellation_id:30};if(path==='/universe/constellations/30')return {region_id:40};if(path==='/universe/regions/40')return {name:'Test Region'};throw Error('Unavailable region');},request:async()=>{throw Error("unused");}};
 const svc=syncService(db,eve,fakeCat);svc.queue(a.uid);await svc.tick();
 const result=JSON.parse(db.prepare("SELECT data FROM snapshots WHERE kind='clones'").get().data);
 assert.equal(result.capacity,8);assert.equal(result.ready_at,"2026-10-18T19:00:00.000Z");assert.deepEqual(result.clones.map(c=>c.location),["Alpha","Zulu"]);assert.equal(result.active_implants.length,1);assert.equal(result.clones[1].implants.length,1);assert.equal(result.clones[0].system,"Test System");assert.equal(result.clones[0].region,"Test Region");assert.equal(result.clones[1].region,null);assert.equal(result.clones[1].location_unavailable,true);
}));

test("linked plan adds effective-use requirements to fitting readiness",()=>fixture(async({db,user,request})=>{
 const a=user(100,"Main"),b=user(200,"Other");
 const insert=db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?)");
 insert.run("fit",a.uid,"fitting","Ship",JSON.stringify("[Test ship, Test]"),0,0);
 insert.run("plan",a.uid,"plan","Extra skills",JSON.stringify([{id:1,level:5}]),0,0);
 insert.run("private",b.uid,"plan","Private",JSON.stringify([{id:1,level:5}]),0,0);
 db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)").run(100,"skills",JSON.stringify({skills:{skills:[{skill_id:1,active_skill_level:3,trained_skill_level:3}]}}),0,0);
 const get=async()=>await(await request("/api/documents/fit",{session:a.session})).json();
 assert.equal((await get()).readiness[0].ready,true);
 assert.equal((await request("/api/documents/fit/plan",{session:a.session,method:"POST",body:{plan:"plan"}})).status,200);
 const linked=await get();assert.equal(linked.readiness[0].ready,false);assert.equal(linked.readiness[0].missing[0].required,5);
 assert.notEqual((await request("/api/documents/fit/plan",{session:a.session,method:"POST",body:{plan:"private"}})).status,200);
 const plan=await(await request("/api/documents/plan",{session:a.session})).json();assert.equal(plan.readiness[0].ready,false);
}, {...fakeCat,named:()=>99,type:id=>id===99?{id:99,name:"Test ship",category_id:6,attributes:{182:1,277:3}}:fakeCat.type(id)}));

test("main and alt groups preserve login ownership and forbid cross-account or cyclic assignments",()=>fixture(async({db,user,request})=>{
 const a=user(100,"Login Main"),b=user(900,"Other");
 for(const [id,name] of [[200,"Second Main"],[300,"Alt"]])db.prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)").run(id,a.uid,name,"owner","unused","[]",0);
 const assign=(id,parent_id)=>request(`/api/characters/${id}/group`,{session:a.session,method:"POST",body:{parent_id}});
 assert.equal((await assign(200,200)).status,200);assert.equal((await assign(300,200)).status,200);
 let rows=await(await request("/api/characters",{session:a.session})).json();assert.equal(rows.find(c=>c.id===300).parent_id,200);assert.equal(rows.find(c=>c.id===200).main,false);
 assert.equal((await assign(200,300)).status,400);assert.equal((await assign(100,200)).status,400);assert.notEqual((await assign(300,900)).status,200);
 assert.equal((await assign(200,100)).status,200);
 rows=await(await request("/api/characters",{session:a.session})).json();assert.equal(rows.find(c=>c.id===300).parent_id,100);
}));


test("clipboard skill lists merge repeated levels and reject invalid lines atomically", async () => {
  const {importSkillText}=await import("../lib/plans.mjs");
  const types={1:{id:1,name:"Motion Prediction",category_id:16},2:{id:2,name:"Gunnery",category_id:16},3:{id:3,name:"Rifter",category_id:6}};
  const cat={named:n=>Object.values(types).find(t=>t.name.toLowerCase()===n.toLowerCase())?.id,type:id=>types[id]};
  assert.deepEqual(importSkillText("Motion Prediction III\r\nMotion Prediction IV\nMotion Prediction V\nGunnery V\n",cat),[{id:1,name:"Motion Prediction",level:5},{id:2,name:"Gunnery",level:5}]);
  assert.equal(importSkillText("gunnery 4",cat)[0].level,4);
  for(const text of ["Gunnery V\nTypo III","Gunnery VI","Rifter I","","Gunnery 0"])
    assert.throws(()=>importSkillText(text,cat));
  await fixture(async({request,user})=>{
    const a=user(100,"A");
    const r=await request("/api/skill-plan/import",{session:a.session,method:"POST",body:{text:"Gunnery V"}});
    assert.equal(r.status,200);
    assert.equal((await r.json())[0].level,5);
    const bad=await request("/api/skill-plan/import",{session:a.session,method:"POST",body:{text:"Gunnery VI"}});
    assert.equal(bad.status,400);
  },cat);
});

test("den totals include all owners, exclude expired MTOs and distinguish unknown anarchy",async()=>{
  const {denTotals,workforceImpact}=await import("../public/den-model.mjs");
  const make=(level,amount)=>({state:"Running",infomorphs:{amount},evolution:{anarchy:{level}},operations:[]});
  const a=make("Level1",100), b=make("Level4",250), now=Date.now();
  a.operations=[{state:"Available",expires:new Date(now+60000).toISOString()},{state:"Available",expires:new Date(now-1).toISOString()},{state:"Completed",expires:new Date(now+60000).toISOString()}];
  assert.equal(workforceImpact(a),0);assert.equal(workforceImpact(b),40);assert.equal(workforceImpact(make("Unspecified",0)),null);
  const total=denTotals([{data:[a]},{data:[b]},{data:null}],now);
  assert.equal(total.count,2);assert.equal(total.keys,350);assert.equal(total.ready,1);assert.equal(total.impacting,1);
});


test("dens still sync when MTO service fails and report the partial status",()=>fixture(async({db,user})=>{
 const a=user(100,"A");
 const svc=syncService(db,{
   async get(path){
    if(path.endsWith("/structures/mercenary-dens"))return {mercenary_dens:[{id:123,planet_id:456}]};
    if(path.endsWith("/structures/mercenary-dens/123"))return {id:123,state:"Running",infomorphs:{amount:4567}};
    throw Error("temporary outage");
   },
   async publicGet(){return {name:"Example planet"};}
 },fakeCat);
 svc.queue(a.uid);await svc.tick();
 const snap=JSON.parse(db.prepare("SELECT data FROM snapshots WHERE character_id=100 AND kind='dens'").get().data);
 assert.equal(snap[0].infomorphs.amount,4567);
 assert.match(snap[0].operations_error,/incomplete/);
}));

test("anarchy rings use progress within the next stage's thresholds",async()=>{
 const {anarchyProgress}=await import('../public/den-model.mjs');
 for(const [level,amount,next,percent] of [[0,10,1,50],[1,20,2,0],[1,30,2,50],[2,55,3,50],[3,85,4,50],[3,100,4,100]])
   assert.deepEqual(anarchyProgress({level:'Level'+level,amount}),{next,percent});
 assert.equal(anarchyProgress({level:'Level4',amount:100}),null);
 assert.equal(anarchyProgress({level:'Unspecified',amount:0}),null);
 assert.equal(anarchyProgress({level:'Level1'}),null);
});

test('missing skill export includes intermediate levels and excludes trained but inactive skills',async()=>{
 const {missingSkillText}=await import('../public/skill-export.mjs');
 assert.equal(missingSkillText([{name:'Gunnery',current:3,level:5},{name:'Motion Prediction',trained:0,required:2},{name:'Gunnery',trained:3,required:5},{name:'Inactive skill',current:5,active:0,level:5}]),'Gunnery IV\nGunnery V\nMotion Prediction I\nMotion Prediction II');
 assert.equal(missingSkillText([]),'');
});

test('subscription countdown uses UTC calendar dates and the requested colour thresholds',async()=>{
 const {subscriptionStatus,validSubscriptionDate}=await import('../public/subscription.mjs');
 const now=Date.parse('2026-10-18T23:59:59Z');
 for(const [date,days] of [['2026-11-18',31],['2026-11-17',30],['2026-10-28',10],['2026-10-18',0],['2026-10-17',-1]])assert.equal(subscriptionStatus(date,now).days,days);
 assert.equal(subscriptionStatus('2026-10-17',now).label,'Expired');
 assert.equal(subscriptionStatus('2026-11-17',now).color,'var(--green)');
 assert.equal(subscriptionStatus('2026-10-28',now).color,'var(--warning,#e6b65c)');
 assert.equal(subscriptionStatus('2026-10-18',now).color,'var(--red,#f57878)');
 assert.equal(subscriptionStatus(null,now).label,'Not set');
 assert.equal(validSubscriptionDate('2026-02-30'),false);assert.equal(validSubscriptionDate('2028-02-29'),true);
});
test('subscription dates persist per owner, validate input and can be cleared',()=>fixture(async({request,user,db})=>{
 const a=user(100,'A'),b=user(200,'B');
 const save=(id,value,session=a.session)=>request('/api/characters/'+id+'/subscription',{session,method:'POST',body:{expires_on:value}});
 assert.equal((await save(100,'2026-11-30')).status,200);
 assert.equal((await (await request('/api/characters',{session:a.session})).json())[0].subscription_end,'2026-11-30');
 assert.equal((await save(100,'2026-12-01',b.session)).status,404);
 assert.equal((await save(100,'2026-02-30')).status,400);
 assert.equal(db.prepare('SELECT expires_on FROM character_subscriptions WHERE character_id=100').get().expires_on,'2026-11-30');
 assert.equal((await (await request('/api/characters',{session:b.session})).json())[0].subscription_end,null);
 assert.equal((await save(100,null)).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM character_subscriptions').get().n,0);
}));

test('recurring subscription and MCT settings persist independently',()=>fixture(async({request,user,db})=>{
 const owner=user(100,'Main');
 db.prepare("INSERT INTO characters VALUES(101,?,'Alt','alt-owner','unused','[]',0,0)").run(owner.uid);
 const save=(id,body)=>request('/api/characters/'+id+'/subscription',{session:owner.session,method:'POST',body});
 assert.equal((await save(100,{expires_on:'2026-11-30',recurring:true})).status,200);
 assert.equal((await save(100,{mct_enabled:true})).status,400);
 assert.equal((await save(101,{recurring:true})).status,400);
 assert.equal((await save(101,{mct_enabled:true,mct_expires_on:'2026-02-30'})).status,400);
 assert.equal((await save(101,{mct_enabled:true,mct_expires_on:'2026-12-30'})).status,200);
 assert.equal((await save(101,{mct_enabled:false})).status,200);
 assert.equal((await save(101,{mct_enabled:true})).status,200);
 const [main,alt]=await(await request('/api/characters',{session:owner.session})).json();
 assert.equal(main.subscription_recurring,true);
 assert.equal(main.subscription_end,'2026-11-30');
 assert.equal(alt.mct_enabled,true);
 assert.equal(alt.mct_expires_on,'2026-12-30');
}));

test('adding a character carries Main or Alt selection through the bound OAuth flow',async()=>{
 for(const mode of ['main','alt'])await fixture(async({db,user,request,identity})=>{
  const a=user(100,'A');user(200,'Other account');
  assert.equal((await request('/auth/login?link=1&group=alt&parent=200',{session:a.session})).status,404);
  const start=await request('/auth/login?link=1&group='+mode+'&parent=100',{session:a.session});
  assert.equal(start.status,302);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const browser=start.headers.get('set-cookie').match(/tools_oauth=([^;]+)/)[1];
  identity({id:300,name:'New pilot',owner:'owner-300',expires:Date.now()+3600000,scopes:[]});
  const result=await request('/auth/callback?code=test&state='+state,{cookie:'tools_oauth='+browser+'; tools_session='+a.session});
  assert.equal(result.status,302);
  assert.equal(db.prepare('SELECT parent_id FROM character_groups WHERE character_id=300').get().parent_id,mode==='main'?300:100);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE character_id=300').get().status,'queued');
  assert.equal(db.prepare('SELECT main_id FROM users WHERE id=?').get(a.uid).main_id,100);
  assert.equal(db.prepare('SELECT count(*) n FROM oauth_character_groups').get().n,0);
 });
});


test("wallet sync isolates balances, preserves failures and distinguishes zero from missing",()=>fixture(async({db,user,request})=>{
 const a=user(100,"Wallet owner"),b=user(200,"Other");
 const list=async session=>(await(await request("/api/characters",{session})).json());
 assert.equal((await list(a.session))[0].isk,null);
 db.prepare("UPDATE characters SET scopes=? WHERE id=100").run(JSON.stringify(["esi-wallet.read_character_wallet.v1"]));
 let balance=123456.78;
 const eve={get:async path=>{if(path.endsWith("/wallet")){if(balance===null)throw Error("outage");return balance;}throw Error("unused");},request:async()=>{throw Error("unused");}};
 const svc=syncService(db,eve,fakeCat);
 const sync=async()=>{db.prepare("UPDATE snapshots SET expires=0 WHERE character_id=100").run();svc.queue(a.uid);await svc.tick();};
 await sync();assert.equal((await list(a.session))[0].isk,123456.78);assert.equal((await list(b.session))[0].isk,null);
 balance=null;await sync();assert.equal((await list(a.session))[0].isk,123456.78);
 balance=0;await sync();assert.equal((await list(a.session))[0].isk,0);
 db.prepare("UPDATE characters SET scopes='[]' WHERE id=100").run();await sync();
 assert.match(db.prepare("SELECT message FROM sync_errors WHERE character_id=100 AND kind='wallet'").get().message,/Reconnect/);
 assert.equal((await list(a.session))[0].isk,0);
 db.prepare("INSERT INTO snapshots VALUES(100,'skills',?,1,1,NULL)").run(JSON.stringify({skills:{total_sp:98765}}));
 assert.equal((await list(a.session))[0].total_sp,98765);assert.equal((await list(b.session))[0].total_sp,null);
}));
import {extractionProgramme,combinedProduction,validatePISettings,jitaPricing} from '../lib/pi.mjs';

test('PI programme average sums declining cycles in ESI seconds',()=>{
 const pin={install_time:'2026-01-01T00:00:00Z',expiry_time:'2026-01-02T23:30:00Z',extractor_details:{qty_per_cycle:6965,cycle_time:1800}};
 const r=extractionProgramme(pin);
 assert.equal(r.cycles,95);assert.equal(r.hours,47.5);assert.equal(r.total,789314);assert.ok(Math.abs(r.perHour-16617.136842105265)<.0001);
 assert.equal(extractionProgramme({...pin,install_time:undefined}),null);
 assert.equal(extractionProgramme({...pin,extractor_details:{...pin.extractor_details,cycle_time:0}}),null);
 assert.equal(extractionProgramme({...pin,extractor_details:{...pin.extractor_details,qty_per_cycle:0}}).total,0);
 const cat={type:()=>({attributes:{}}),schematic:()=>null};
 const [p]=piSummary([{pins:[{...pin,extractor_details:{...pin.extractor_details,product_type_id:2267}}]}],cat,Date.parse('2026-02-01'));
 assert.equal(p.production[0].perHour,0);assert.equal(p.production[0].averagePerHour,r.perHour);assert.equal(p.mode,'Extraction only');
});

test('PI combining observes limiting ingredients, intermediate recipes and shared-stock priority',()=>{
 const cat=catalog('data');try{
 const recipes=cat.piRecipes();
 const result=combinedProduction([{type_id:3689,amount:100},{type_id:9836,amount:90},{type_id:9848,amount:6}],[9848],recipes)[0];
 assert.equal(result.additional,27);assert.equal(result.existing,6);
 assert.equal(combinedProduction([{type_id:3689,amount:9},{type_id:9836,amount:100}],[9848],recipes)[0].additional,0);
 const recursive=combinedProduction([{type_id:2398,amount:80},{type_id:2399,amount:80},{type_id:9836,amount:10}],[9848],recipes)[0];
 assert.equal(recursive.additional,3);
 }finally{cat.close();}
 const recipes=[{id:10,name:'A',tier:3,quantity:3,inputs:[{id:1,quantity:10}]},{id:20,name:'B',tier:4,quantity:1,inputs:[{id:1,quantity:5}]}];
 const result=combinedProduction([{type_id:1,amount:25}],[10,20],recipes);
 assert.deepEqual(result.map(r=>r.additional),[6,1]);
 assert.deepEqual(combinedProduction([{type_id:1,amount:25}],[20,10],recipes).map(r=>r.additional),[5,0]);
 assert.throws(()=>validatePISettings({perfect:16000,critical:18000,targets:[]},recipes));
 assert.throws(()=>validatePISettings({perfect:18000,critical:16000,targets:[10,10]},recipes));
 assert.throws(()=>validatePISettings({perfect:18000,critical:16000,targets:[1]},recipes));
});

test('PI settings and stock summaries are private to the account',()=>fixture(async({db,user,request})=>{
 const a=user(100,'A'),b=user(200,'B');
 const get=async session=>(await(await request('/api/pi/dashboard',{session})).json());
 assert.equal((await get(a.session)).settings.perfect,18000);
 const body={perfect:20000,critical:17000,targets:[9848],show_goals:false};
 db.prepare('INSERT INTO pi_settings VALUES(?,?)').run(b.uid,JSON.stringify({perfect:21000,critical:17000,targets:[]}));
 assert.equal((await get(b.session)).settings.show_goals,true);
 assert.equal((await request('/api/pi/settings',{session:a.session,method:'POST',body})).status,200);
 assert.deepEqual((await get(a.session)).settings,body);assert.deepEqual((await get(b.session)).settings.targets,[]);
 const snapshot=id=>JSON.stringify([{pins:[{type_id:99,contents:[{type_id:3689,amount:id},{type_id:9836,amount:id}]}]}]);
 for(const [id,qty] of [[100,20],[200,10000]])db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(id,'pi',snapshot(qty),1,1);
 const data=await get(a.session);assert.equal(data.targets[0].additional,6);assert.equal(data.targets[0].ingredients[0].stored,20);
 assert.equal((await request('/api/pi/settings',{session:a.session,method:'POST',body:{...body,targets:[666]}})).status,400);
 assert.deepEqual((await get(a.session)).settings,body);
}, {...fakeCat,type:id=>({name:String(id),group_id:id===99?1030:0}),piRecipes:()=>[{id:9848,name:'Robotics',tier:3,quantity:3,inputs:[{id:3689,name:'Mechanical Parts',quantity:10},{id:9836,name:'Consumer Electronics',quantity:10}]}]}));

test('Jita valuation reads every page, excludes other stations and never caches partial results',()=>fixture(async({db})=>{
 let fail=false,calls=0;
 const eve={request:async path=>{calls++;const page=Number(new URL('https://esi.evetech.net'+path).searchParams.get('page'));if(fail&&page===2)throw Error('outage');return {pages:2,expires:Date.now()+60000,data:page===1?[{type_id:9848,location_id:60003760,is_buy_order:false,volume_remain:2,price:100},{type_id:9848,location_id:123,is_buy_order:false,volume_remain:2,price:1}]:[{type_id:9848,location_id:60003760,is_buy_order:false,volume_remain:2,price:80},{type_id:9848,location_id:60003760,is_buy_order:true,volume_remain:2,price:2}]};}};
 const price=jitaPricing(db,eve);
 assert.equal((await price([9848]))[0].price,80);assert.equal(calls,2);
 await price([9848]);assert.equal(calls,2);
 db.prepare('DELETE FROM public_cache').run();fail=true;
 assert.equal((await price([9848]))[0].price,null);assert.equal(db.prepare('SELECT count(*) n FROM public_cache').get().n,0);
}));

test("only owner manages admin grants, delegated access updates immediately and inspection stays read-only",async()=>{
 await fixture(async({db,user,request})=>{
  const owner=user(100,"Owner"),other=user(200,"Other"),third=user(300,"Third");
  const grant=(actor,id,admin)=>request('/api/admin/users/'+id+'/admin',{session:actor.session,body:{admin,confirm_main_id:db.prepare('SELECT main_id FROM users WHERE id=?').get(id)?.main_id},method:'POST'});
  assert.equal((await grant(other,other.uid,true)).status,403);
  assert.equal((await request('/api/admin/users',{session:other.session})).status,403);
  assert.equal((await grant(owner,other.uid,'yes')).status,400);
  assert.equal((await grant(owner,9999,true)).status,404);
  assert.equal((await grant(owner,owner.uid,false)).status,400);
  assert.equal((await request('/api/admin/users/'+other.uid+'/admin',{session:owner.session,method:'POST',body:{admin:true}})).status,400);
  assert.equal((await grant(owner,other.uid,true)).status,200);
  assert.equal((await (await request('/api/me',{session:other.session})).json()).admin,true);
  for(const path of ['users','esi','corporations','whitelist','groups','links'])assert.equal((await request('/api/admin/'+path,{session:other.session})).status,200);
  assert.equal((await grant(other,third.uid,true)).status,403);
  assert.equal((await grant(other,other.uid,false)).status,403);
  const users=await (await request('/api/admin/users',{session:owner.session})).json();
  assert.equal(users.find(u=>u.id===owner.uid).owner,true);assert.equal(users.find(u=>u.id===other.uid).admin,true);
  assert.ok(!JSON.stringify(users).includes('tokens'));assert.ok(!JSON.stringify(users).includes('owner_hash'));
  assert.equal((await request('/api/inspect',{session:other.session,body:{user_id:owner.uid},method:'POST'})).status,403);
  assert.equal((await request('/api/inspect',{session:other.session,body:{user_id:third.uid},method:'POST'})).status,200);
  assert.equal((await request('/api/admin/users',{session:other.session})).status,403);
  assert.equal((await request('/api/admin/esi/rebalance',{session:other.session,body:{},method:'POST'})).status,403);
  assert.equal((await grant(owner,other.uid,false)).status,200);
  assert.equal(db.prepare('SELECT count(*) n FROM inspections').get().n,0);
  assert.equal((await (await request('/api/me',{session:other.session})).json()).admin,false);
  assert.equal((await request('/api/admin/groups',{session:other.session})).status,403);
  assert.equal((await request('/api/inspect',{session:other.session,body:{user_id:third.uid},method:'POST'})).status,403);
 });
});

test("buckets persist, enqueue once per UTC slot and manual refresh does not move schedule",async()=>{
 await fixture(async({db,user})=>{
  const u=user(100,"Owner"),sync=syncService(db,{},fakeCat);
  const assigned=db.prepare("SELECT * FROM character_buckets WHERE character_id=100").get();
  assert.ok([0,10,20,30,40,50].includes(assigned.minute));assert.ok(assigned.next_due>Date.now());
  const start=Date.UTC(2026,9,20,12,20);
  db.prepare("UPDATE character_buckets SET minute=20,next_due=?").run(start);
  db.prepare("INSERT INTO snapshots VALUES(100,'skills','{}',?, ?,NULL)").run(start-1000,start+3600000);
  sync.schedule(start-1);assert.equal(db.prepare("SELECT count(*) n FROM jobs").get().n,0);
  sync.schedule(start+30000);assert.equal(db.prepare("SELECT count(*) n FROM jobs").get().n,1);
  assert.equal(db.prepare("SELECT expires FROM snapshots").get().expires,0);
  assert.equal(db.prepare("SELECT next_due FROM character_buckets").get().next_due,start+3600000);
  db.prepare("DELETE FROM jobs").run();sync.schedule(start+60000);
  assert.equal(db.prepare("SELECT count(*) n FROM jobs").get().n,0);
  sync.queue(u.uid,100,true);assert.equal(db.prepare("SELECT next_due FROM character_buckets").get().next_due,start+3600000);
  db.prepare("DELETE FROM jobs").run();sync.schedule(start+3600000+600000);
  assert.equal(db.prepare("SELECT count(*) n FROM jobs").get().n,0);
  assert.equal(db.prepare("SELECT next_due FROM character_buckets").get().next_due,start+7200000);
 });
});
test("corporation OAuth remains separate, session-bound and stores encrypted credentials",async()=>{
 await fixture(async({db,user,request})=>{
  const u=user(100,"Owner");
  const original=db.prepare("SELECT tokens FROM characters WHERE id=100").get().tokens;
  const begin=await request("/auth/login?corporation=1",{session:u.session});
  const url=new URL(begin.headers.get("location"));
  assert.ok(url.searchParams.get("scope").includes("esi-corporations.read_structures.v1"));
  const cookie=begin.headers.get("set-cookie").split(";")[0];
  const callback="/auth/callback?code=fake&state="+url.searchParams.get("state");
  assert.equal((await request(callback,{cookie:cookie+"; tools_session="+u.session})).status,302);
  const corp=db.prepare("SELECT * FROM corporation_connections").get();
  assert.equal(corp.corporation_id,668298004);assert.equal(corp.role,"Director");
  assert.ok(!corp.tokens.includes("fake"));
  assert.equal(db.prepare("SELECT tokens FROM characters WHERE id=100").get().tokens,original);
  assert.equal((await request(callback,{cookie:cookie+"; tools_session="+u.session})).status,400);
  const rows=await (await request("/api/admin/corporations",{session:u.session})).json();assert.ok(!("tokens" in rows[0]));
 },fakeCat,{verifyCorporation:async()=>({id:668298004,name:"Sacred Templars",role:"Director"})});
});
test("corporation validation rejects ordinary members and accepts only CEO or Director",async()=>{
 const {verifyCorporation}=await import("../lib/corp.mjs");
 const original=globalThis.fetch;let roles=[],ceo=999;
 globalThis.fetch=async url=>({ok:true,json:async()=>url.includes("/affiliation")?[{character_id:100,corporation_id:300}]:url.includes("/roles/")?{roles}:url.includes("/corporations/")?{name:"Corp",ceo_id:ceo}:{corporation_id:300}});
 try {
  await assert.rejects(()=>verifyCorporation("token",100),/CEO or Director/);
  roles=["Director"];assert.equal((await verifyCorporation("token",100)).role,"Director");
  roles=[];ceo=100;assert.equal((await verifyCorporation("token",100)).role,"CEO");
 }finally{globalThis.fetch=original;}
});

function connectCorpFixture(db,user,id=100,corp=668298004) {
 db.prepare("INSERT INTO corp_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)").run(user,id,"Director","owner-a",corp,cryptoBox(key).seal({access_token:"corp-secret",refresh_token:"refresh"}),JSON.stringify(["esi-characters.read_corporation_roles.v1","esi-corporations.read_structures.v1","esi-assets.read_corporation_assets.v1","esi-corporations.read_starbases.v1"]),Date.now()+3600000,"Director",Date.now());
}
test("corporation endpoints allow admin viewing and verified non-admin directors",async()=>{
 let role="Director",corpId=668298004;
 await fixture(async({db,user,request,corp})=>{
  const owner=user(100,"Owner"),director=user(200,"Director"),outsider=user(300,"Member");
  assert.equal((await request("/api/corporation/structures",{session:owner.session})).status,200);
  const me=await (await request("/api/me",{session:owner.session})).json();assert.equal(me.corporation,true);assert.equal(me.director,false);
  assert.equal((await request("/api/corporation/sync",{session:owner.session,method:"POST",body:{}})).status,200);
  connectCorpFixture(db,director.uid,200);
  assert.equal((await request("/api/corporation/structures",{session:director.session})).status,200);
  assert.equal((await request("/api/admin/users",{session:director.session})).status,403);
  assert.equal((await request("/api/corporation/structures",{session:outsider.session})).status,403);
  assert.equal((await request("/api/corporation/sync",{session:director.session,method:"POST",body:{}})).status,200);
  assert.equal((await request("/api/corporation/sync",{session:director.session,method:"POST",body:{},origin:"https://evil.test"})).status,403);
  role="Member";assert.equal(await corp.access(director.uid,true),false);
  assert.equal((await request("/api/corporation/structures",{session:director.session})).status,403);
  role="Director";corpId=999;assert.equal(await corp.access(director.uid,true),false);
 },fakeCat,{verifyCorporation:async()=>({id:corpId,role})});
});
test("corporation login rejects non-STEMP CEOs without overwriting saved authorization",async()=>{
 await fixture(async({db,user,request})=>{
  const u=user(100,"Owner");connectCorpFixture(db,u.uid);
  const begin=await request("/auth/login?corporation=1",{session:u.session});
  const url=new URL(begin.headers.get("location")),cookie=begin.headers.get("set-cookie").split(";")[0]+"; tools_session="+u.session;
  const result=await request("/auth/callback?code=fake&state="+url.searchParams.get("state"),{cookie});
  assert.equal(result.status,403);assert.equal(db.prepare("SELECT corporation_id FROM corp_authorizations").get().corporation_id,668298004);
 },fakeCat,{verifyCorporation:async()=>({id:999,name:"Other",role:"CEO"})});
});
test("moon collections compare each resource, retain partial collections and ignore initial or repeated snapshots",async()=>{
 const {moonHistory}=await import("../lib/corp-fuel.mjs");
 const old={inventory_at:100,materials:[{type_id:1,quantity:100,name:"A"},{type_id:2,quantity:20,name:"B"}],history:[]};
 assert.deepEqual(moonHistory(null,[],200),[]);
 const next=[{type_id:1,quantity:30,name:"A"},{type_id:2,quantity:500,name:"B"}];
 const history=moonHistory(old,next,200);assert.equal(history[0].items[0].quantity,70);assert.equal(history[0].emptied,false);
 assert.equal(moonHistory(old,[],200)[0].emptied,true);assert.deepEqual(moonHistory(old,[],100),[]);
});
test("Fuel-derived rates distinguish offline, unknown and online module fuel",async()=>{
 const {structureRate}=await import("../lib/corp-fuel.mjs");
 const row={id:1,kind:"Structure",type_name:"Raitaru",services:[{name:"Manufacturing",state:"online"}]};
 const assets=[{item_id:11,location_id:1,location_flag:"ServiceSlot0",type_id:10}];
 const type=()=>({name:"Standup Manufacturing Plant I",attributes:{2109:12}});
 assert.equal(structureRate(row,assets,type,false),9);assert.equal(structureRate(row,assets,type,true),8);
 assert.equal(structureRate(row,[],type,false),null);assert.equal(structureRate(row,assets,type,null),null);
 assert.equal(structureRate({...row,services:[]},assets,type,false),0);
 assert.equal(structureRate({...row,services:[],fuel_expires:new Date(Date.now()+3600000).toISOString()},assets,type,false),null);
 assert.equal(structureRate({kind:"POS",state:"online",type_name:"Caldari Control Tower Small"},[],type,false),10);
 assert.equal(structureRate({kind:"POS",state:"online",type_name:"Unknown Tower"},[],type,false),null);
});
test("corporation inventory commits atomically and failed pages cannot invent moon collections",async()=>{
 let fail=false,amount=100,stamp=Date.now();
 const network=async url=>{
  const u=new URL(url),path=u.pathname;let data=[],pages=1;
  if(path.endsWith("/structures"))data=[{structure_id:123,type_id:81826,corporation_id:668298004,system_id:3001,name:"Test drill",state:"shield_vulnerable",services:[{name:"Metenox Moon Drill",state:"online"}]},{structure_id:124,type_id:35833,system_id:3001,name:"Z Test Fortizar"}];
  if(path.endsWith("/assets")){pages=2;if(u.searchParams.get("page")==="2"){if(fail)return {ok:false,status:503,headers:new Headers()};data=[];}else data=[{item_id:5,type_id:1,location_id:123,location_flag:"MoonMaterialBay",quantity:amount},{item_id:6,type_id:4051,location_id:123,location_flag:"StructureFuel",quantity:50},{item_id:7,type_id:81143,location_id:123,location_flag:"StructureFuel",quantity:2000},{item_id:8,type_id:4051,location_id:123,location_flag:"CorpSAG1",quantity:9999},{item_id:9,type_id:10,location_id:124,location_flag:"HiSlot0",quantity:1},{item_id:11,type_id:12,location_id:9,location_flag:"HiSlot0",quantity:25},{item_id:13,type_id:12,location_id:124,location_flag:"CorpSAG1",quantity:9999}];}
  return {ok:true,headers:new Headers({'x-pages':String(pages),'last-modified':new Date(stamp).toUTCString()}),json:async()=>data};
 };
 await fixture(async({db,user,corp})=>{
  const u=user(100,"Owner");connectCorpFixture(db,u.uid);
  corp.queue();await corp.tick();let snapshot=corp.snapshot();assert.equal(snapshot.job.status,"idle");assert.equal(snapshot.structures[0].fuel,50);assert.equal(snapshot.structures[0].gas,2000);assert.equal(snapshot.structures[0].history.length,0);assert.deepEqual(snapshot.structures[1].fitting.items.map(i=>[i.slot,i.quantity]),[["HiSlot0",1],["Ammunition",25]]);
  const before=snapshot.updated;fail=true;amount=0;stamp+=3600000;
  db.prepare("UPDATE corp_jobs SET attempted=0").run();corp.queue();await corp.tick();snapshot=corp.snapshot();assert.equal(snapshot.job.status,"failed");assert.equal(snapshot.updated,before);assert.equal(snapshot.structures[0].materials[0].quantity,100);
  fail=false;db.prepare("UPDATE corp_jobs SET attempted=0").run();corp.queue();await corp.tick();snapshot=corp.snapshot();assert.equal(snapshot.job.status,"idle");assert.equal(snapshot.structures[0].history[0].emptied,true);
 },{...fakeCat,type:id=>({name:id===81826?"Metenox Moon Drill":"Resource",group_id:id===35833?1657:undefined,category_id:id===12?8:undefined,attributes:{2109:5}})},{corpNetwork:network,verifyCorporation:async()=>({id:668298004,role:"Director"}),eve:{publicGet:async path=>path==="/sovereignty/systems"?{solar_systems:[]}:path.startsWith("/corporations")?{alliance_id:1}:{name:"Test system"}}});
});

test("a signed-in non-admin can authorize STEMP without modifying the owner's connection",async()=>{
 await fixture(async({db,user,request,identity})=>{
  const u=user(200,"Director");
  const {CORP_SCOPES}=await import("../lib/corp.mjs");
  identity({id:200,name:"Director",owner:"owner-200",expires:Date.now()+3600000,scopes:CORP_SCOPES});
  const start=await request("/auth/login?corporation=1",{session:u.session});
  const url=new URL(start.headers.get("location"));
  const cookie=start.headers.get("set-cookie").split(";")[0]+"; tools_session="+u.session;
  assert.equal((await request("/auth/callback?code=fake&state="+url.searchParams.get("state"),{cookie})).status,302);
  assert.equal(db.prepare("SELECT count(*) n FROM corporation_connections").get().n,0);
  assert.equal(db.prepare("SELECT user_id FROM corp_authorizations").get().user_id,u.uid);
  assert.equal((await (await request("/api/me",{session:u.session})).json()).corporation,true);
  assert.equal((await request("/api/admin/corporations",{session:u.session})).status,403);
 },fakeCat,{verifyCorporation:async()=>({id:668298004,name:"Sacred Templars",role:"Director"})});
});

test("harvest valuation sorts known totals first and identifies missing prices and volumes",async()=>{
 const {valueHarvest}=await import("../lib/harvest.mjs");
 const rows=valueHarvest([{id:1,name:"Low",kind:"Moon Drill",materials:[{name:"A",type_id:1,quantity:2}]},{id:2,name:"High",kind:"Moon Drill",materials:[{name:"A",type_id:1,quantity:10},{name:"B",type_id:2,quantity:4}]},{id:3,name:"Unknown",kind:"Moon Drill",materials:[{name:"C",type_id:3,quantity:2}]},{id:4,name:"Empty",kind:"Moon Drill",materials:[]},{id:5,kind:"POS",materials:[]}],[{type_id:1,average_price:100},{type_id:2,average_price:-20}],id=>id===1?{volume:2}:{});
 assert.deepEqual(rows.map(r=>r.id),[2,1,4,3]);assert.equal(rows[0].total_value,1000);assert.equal(rows[0].total_volume,20);assert.equal(rows[0].missing_prices,1);assert.equal(rows[0].missing_volumes,1);assert.equal(rows[3].total_value,null);assert.equal(rows[2].total_value,0);
});
test("harvest prices retain their previous value on failure and remain protected by corporation access",async()=>{
 let fail=false,calls=0;
 await fixture(async({db,user,request})=>{
  const u=user(100,"Owner"),other=user(200,"Other");connectCorpFixture(db,u.uid);
  db.prepare("INSERT INTO corp_snapshots VALUES(668298004,?,?)").run(JSON.stringify([{id:1,kind:"Moon Drill",name:"Drill",materials:[{type_id:1,name:"A",quantity:10}]}]),Date.now());
  assert.equal((await request("/api/corporation/harvest",{session:other.session})).status,403);assert.equal(calls,0);
  let result=await (await request("/api/corporation/harvest",{session:u.session})).json();assert.equal(result.structures[0].total_value,500);assert.equal(result.prices.error,null);
  await request("/api/corporation/harvest",{session:u.session});assert.equal(calls,1);
  fail=true;db.prepare("UPDATE public_cache SET expires=0 WHERE path='/tools/corp-harvest-prices'").run();
  result=await (await request("/api/corporation/harvest",{session:u.session})).json();assert.equal(result.structures[0].total_value,500);assert.ok(result.prices.error.includes("retained"));assert.equal(calls,2);
 },fakeCat,{verifyCorporation:async()=>({id:668298004,role:"Director"}),eve:{publicGet:async()=>{calls++;if(fail)throw Error("Unavailable");return [{type_id:1,average_price:50}];}}});
});

test('moon extraction sync retains timers on failure and clears on confirmed empty response',async()=>{
 let fail=false,entries=[{structure_id:123,moon_id:45,extraction_start_time:'2026-01-01T00:00:00Z',chunk_arrival_time:'2027-01-01T00:00:00Z',natural_decay_time:'2027-01-03T00:00:00Z'}];
 await fixture(async({db,user,corp})=>{
  const u=user(100,'Owner');connectCorpFixture(db,u.uid);
  const {CORP_SCOPES}=await import('../lib/corp.mjs');
  db.prepare('UPDATE corp_authorizations SET scopes=?').run(JSON.stringify(CORP_SCOPES));
  const sync=async()=>{db.prepare('UPDATE corp_jobs SET attempted=0').run();corp.queue();await corp.tick();return (await corp.harvest()).extractions;};
  let result=await sync();assert.equal(result.rows.length,1);assert.equal(result.error,null);
  fail=true;result=await sync();assert.equal(result.rows.length,1);assert.ok(result.error);assert.equal(corp.snapshot().job.status,'idle');
  fail=false;entries=[];result=await sync();assert.deepEqual(result.rows,[]);assert.equal(result.error,null);
 },fakeCat,{verifyCorporation:async()=>({id:668298004,role:'Director'}),corpNetwork:async url=>({ok:!(fail&&url.includes('/extractions')),status:503,headers:new Headers(),json:async()=>url.includes('/extractions')?entries:[]}),eve:{publicGet:async path=>path==='/markets/prices'?[]:{}}});
});

test('moon extraction display distinguishes empty, unavailable, ready and expired timers',async()=>{
 const {moonExtractions}=await import('../public/moon-extractions.mjs');
 const now=Date.parse('2026-01-01T00:00:00Z');
 assert.match(moonExtractions({rows:[],updated:now},[],now),/No Extractions/);
 assert.doesNotMatch(moonExtractions({rows:[],error:'Reconnect'},[],now),/No Extractions/);
 const row={structure_id:1,moon_id:2,chunk_arrival_time:'2026-01-02T02:03:00Z',natural_decay_time:'2026-01-04T00:00:00Z'};
 assert.match(moonExtractions({rows:[row],updated:now},[{id:1,name:'<Refinery>',type_id:35835}],now),/1d 2h 3m/);
 assert.match(moonExtractions({rows:[row],updated:now},[],Date.parse(row.chunk_arrival_time)),/Ready to fracture/);
 assert.match(moonExtractions({rows:[row],updated:now},[],Date.parse(row.natural_decay_time)),/No Extractions/);
});

test('moon surveys are private and can be filtered and paged',async()=>{
 await fixture(async({request,user,db})=>{
  const u=user(100,'Owner');
  assert.equal((await request('/api/corporation/surveys',{session:u.session})).status,200);
  const outsider=user(300,'Member');assert.equal((await request('/api/corporation/surveys',{session:outsider.session})).status,403);
  connectCorpFixture(db,u.uid);
  db.prepare('INSERT INTO member_moon_scans VALUES(?,?,?,?)').run(999,JSON.stringify({key:'Example|1|1',name:'Example I - Moon 1',system:'Example',region:'Example region',constellation:'Example',planet:1,moon:1,moon_id:999,ores:[{name:'Zeolites',tier:'R4',fraction:1}],sources:[],issues:[]}),u.uid,Date.now());
  const data=await (await request('/api/corporation/surveys?region=Example%20region&q=Example',{session:u.session})).json();
  assert.ok(data.rows.length);assert.ok(data.rows.every(r=>r.region==='Example region'&&r.system==='Example'));
  assert.ok(!data.regions.includes('Vale'));assert.ok(!data.regions.includes('Geminate West'));
 },fakeCat,{verifyCorporation:async()=>({id:668298004,role:'Director'})});
});
test('extraction estimates preserve partial coverage and reject missing or conflicting survey values',async()=>{
 const {estimateExtraction}=await import('../lib/moon-surveys.mjs');
 const e={extraction_start_time:'2026-01-01T00:00:00Z',chunk_arrival_time:'2026-01-02T00:00:00Z'};
 const survey={name:'Moon',ores:[{name:'Ore',fraction:.8}],sources:[]},price=[{type_id:1,average_price:100}];
 const calc=s=>estimateExtraction(e,s,price,()=>({volume:10}),()=>1,720000);
 const result=calc(survey);assert.equal(result.known_m3,576000);assert.equal(result.ores[0].units,57600);assert.equal(result.value,5760000);assert.equal(result.partial,true);
 assert.ok(calc({...survey,conflict:true}).error);assert.ok(calc({...survey,ores:[{name:'Ore',fraction:null}]}).error);assert.ok(calc(null).error);
 assert.equal(estimateExtraction(e,survey,[],()=>({volume:10}),()=>1,720000).value,null);
});
test('combined PI volume counts finished stock and additional output without ingredients',async()=>{
 const {combinedVolumes}=await import('../lib/pi.mjs');
 const targets=[{id:1,existing:10,additional:20},{id:2,existing:1,additional:2}];
 const result=combinedVolumes(targets,id=>({volume:id===1?6:100}));assert.equal(result.total_m3,480);assert.equal(result.targets[0].combined_m3,180);
 assert.equal(combinedVolumes(targets,id=>id===1?{volume:6}:null).total_m3,null);
});

test('corporation industry paginates atomically, retains failures and requires corporation access',async()=>{
 let fail=false,empty=false;
 const job={job_id:1,installer_id:100,facility_id:60003760,location_id:60003760,activity_id:1,blueprint_type_id:1,product_type_id:1,runs:5,status:'active',end_date:'2027-01-01T00:00:00Z'};
 await fixture(async({db,user,request,corp})=>{
  const u=user(100,'Director');assert.equal((await request('/api/corporation/industry',{session:u.session})).status,200);
  connectCorpFixture(db,u.uid);const {CORP_SCOPES}=await import('../lib/corp.mjs');db.prepare('UPDATE corp_authorizations SET scopes=?').run(JSON.stringify(CORP_SCOPES));
  const sync=async()=>{db.prepare('UPDATE corp_jobs SET attempted=0').run();corp.queue();await corp.tick();return corp.industrySnapshot();};
  let result=await sync();assert.equal(result.rows.length,2);assert.equal(result.rows[0].installer,'Test name');assert.equal(result.error,null);
  fail=true;result=await sync();assert.equal(result.rows.length,2);assert.ok(result.error);assert.equal(corp.snapshot().job.status,'idle');
  fail=false;empty=true;result=await sync();assert.equal(result.rows.length,0);assert.equal(result.error,null);
  assert.equal((await request('/api/corporation/industry',{session:u.session})).status,200);
 },fakeCat,{verifyCorporation:async()=>({id:668298004,role:'Director'}),corpNetwork:async url=>{const u=new URL(url),jobs=u.pathname.endsWith('/industry/jobs'),page=Number(u.searchParams.get('page'));if(jobs)assert.equal(u.searchParams.get('include_completed'),'false');return {ok:!(jobs&&fail&&page===2),status:503,headers:new Headers({'x-pages':jobs&&!empty?'2':'1'}),json:async()=>jobs&&!empty?[{...job,job_id:page,status:page===2?'ready':'active'}]:[]};},eve:{publicGet:async()=>({name:'Test name'})}});
});
test('corporation industry distinguishes paused and estimated ready jobs and excludes delivered jobs',async()=>{
 const {industryJobs,jobState}=await import('../public/corp-industry-view.mjs');
 const now=Date.parse('2026-10-23T12:00:00Z'),base={end_date:'2026-10-22T12:00:00Z',name:'Rifter'};
 const jobs=[{...base,job_id:1,status:'active'},{...base,job_id:2,status:'paused'},{...base,job_id:3,status:'delivered'}];
 assert.equal(jobState(jobs[0],now),'ready-estimated');assert.equal(jobState(jobs[1],now),'paused');assert.equal(industryJobs(jobs,{},now).length,2);assert.equal(industryJobs(jobs,{status:'ready'},now).length,1);assert.equal(industryJobs(jobs,{q:'missing'},now).length,0);
});
test('moon browser selects matching systems and refining preserves missing coverage and zero efficiency',async()=>{
 const {surveyBrowser,refinedSurvey}=await import('../lib/moon-surveys.mjs');
 const fixtureData={rows:[{key:'Example|1|1',name:'Example I - Moon 1',system:'Example',region:'Example region',ores:[],sources:[]}],daily_m3:720000};const browser=surveyBrowser({q:'Example'},fixtureData);assert.equal(browser.system,'Example');assert.ok(browser.moons.every(m=>m.system==='Example'));assert.equal(surveyBrowser({q:'not-a-moon-xyz'}).selected,null);
 const moon={ores:[{name:'Ore',fraction:.5}],sources:[]},recipe={athanor:{Ore:{batch_m3:1000,materials:[{name:'Pyerite',quantity:100}]}},metenox:{Ore:{batch_m3:1000,materials:[{name:'Hydrocarbons',quantity:10}]}}},cat={named:()=>1},price=[{type_id:1,average_price:2}];
 let r=refinedSurvey(moon,recipe,price,cat,{daily_m3:1000,refine:90});assert.equal(r.ores[0].m3,15000);assert.equal(r.ores[0].materials[0].quantity,1350);assert.equal(r.value,2700);
 assert.equal(refinedSurvey(moon,recipe,price,cat,{refine:0}).value,0);assert.equal(refinedSurvey(moon,recipe,[],cat,{}).value,null);assert.equal(refinedSurvey({...moon,conflict:true},recipe,price,cat,{}).value,null);
 r=refinedSurvey(moon,recipe,price,cat,{daily_m3:1000,mode:'metenox'});assert.equal(r.ores[0].materials[0].quantity,60);
});

test('whitelisted mains may link outside alts but those alts cannot become a login',async()=>{
 const checked=[];
 await fixture(async({request,user,identity,db})=>{
  const u=user(100,'Main');
  identity({id:200,name:'Outside alt',owner:'outside',expires:Date.now()+100000,scopes:[]});
  const begin=await request('/auth/login?link=1&group=alt&parent=100',{session:u.session});
  const state=new URL(begin.headers.get('location')).searchParams.get('state');
  const cookie=begin.headers.get('set-cookie').split(';')[0]+'; tools_session='+u.session;
  assert.equal((await request('/auth/callback?code=test&state='+state,{cookie})).status,302);
  assert.equal(db.prepare('SELECT user_id FROM characters WHERE id=200').get().user_id,u.uid);
  assert.deepEqual(checked,[100]);
  const login=await request('/auth/login'),loginState=new URL(login.headers.get('location')).searchParams.get('state');
  assert.equal((await request('/auth/callback?code=test&state='+loginState,{cookie:login.headers.get('set-cookie').split(';')[0]})).status,403);
 },fakeCat,{membershipLookup:async id=>{checked.push(id);return {corporation_id:id===100?668298004:999};}});
});

test('whitelist membership cache expires and does not allow access on ESI failure',async t=>{
 const {whitelistService}=await import('../lib/whitelist.mjs');
 const dir=mkdtempSync(join(tmpdir(),'whitelist-test-')),db=openStore(dir);
 let now=1000000,corporation=668298004,calls=0,fail=false;
 t.mock.method(Date,'now',()=>now);
 try {
  const service=whitelistService(db,async()=>{calls++;if(fail)throw Error('offline');return {corporation_id:corporation};});
  await service.check(100);await service.check(100);assert.equal(calls,1);
  now+=300001;fail=true;await assert.rejects(service.check(100),e=>e.status===503);
  fail=false;corporation=999;await assert.rejects(service.check(100),e=>e.status===403);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('whitelist migration preserves old invitations and does not re-add removed corporations',()=>{
 const dir=mkdtempSync(join(tmpdir(),'whitelist-migration-'));
 let db=openStore(dir);
 try {
  db.exec("CREATE TABLE invites(hash TEXT PRIMARY KEY); INSERT INTO invites VALUES('old-record'); DELETE FROM login_whitelist WHERE corporation_id=98044257");
  db.close();db=productionStore(dir);
  assert.equal(db.prepare('SELECT count(*) n FROM invites').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM login_whitelist').get().n,1);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test("PI sharing selects only owned pilots, isolates recipients and revokes immediately",async()=>{
 await fixture(async({db,user,request})=>{
  const a=user(100,"Alice"),b=user(200,"Bob"),c=user(300,"Carol");
  db.prepare("INSERT INTO characters SELECT 101,user_id,'Alice alt',owner_hash,tokens,scopes,expires,reconnect FROM characters WHERE id=100").run();
  const share=(session,recipient_id,character_ids)=>request('/api/pi/shares',{session,method:'POST',body:{recipient_id,character_ids}});
  const shared=async session=>(await request('/api/pi/shared',{session})).json();
  assert.equal((await request('/api/pi/shared')).status,401);
  assert.equal((await share(a.session,b.uid,[100,101])).status,200);
  assert.deepEqual((await shared(b.session)).map(r=>r.id),[100,101]);
  assert.deepEqual(await shared(c.session),[]);
  db.prepare('INSERT INTO sync_errors VALUES(?,?,?)').run(100,'pi','PI refresh failed');
  const row=(await shared(b.session))[0];assert.equal(row.error,'PI refresh failed');
  assert.equal(row.owner_name,'Alice');assert.equal(row.tokens,undefined);assert.equal(row.scopes,undefined);
  assert.equal((await share(a.session,b.uid,[200])).status,404);
  assert.equal((await shared(b.session)).length,2,'invalid replacement leaves current grants intact');
  assert.equal((await share(a.session,a.uid,[100])).status,400);
  assert.equal((await request('/api/pi/shares',{session:a.session,method:'POST',origin:'https://other.example',body:{recipient_id:b.uid,character_ids:[]}})).status,403);
  assert.equal((await share(a.session,b.uid,[101])).status,200);
  assert.deepEqual((await shared(b.session)).map(r=>r.id),[101]);
  assert.equal((await request('/api/characters/101/sync',{session:b.session,method:'POST',body:{}})).ok,false);
  assert.equal((await share(a.session,b.uid,[])).status,200);
  assert.deepEqual(await shared(b.session),[]);
  await share(a.session,b.uid,[101]);
  db.prepare('UPDATE characters SET user_id=? WHERE id=101').run(c.uid);
  assert.deepEqual(await shared(b.session),[],'ownership changes invalidate previous sharing');
  const config=await(await request('/api/pi/shares',{session:a.session})).json();
  assert.deepEqual(config.pilots.map(p=>p.id),[100]);assert.equal(config.grants.length,0);
 });
});

test('PI market uses highest Jita buy, lowest sell and midpoint with complete cached pages',()=>fixture(async({db})=>{
 let calls=0,fail=false;
 const order=(price,buy,location=60003760)=>({type_id:9848,location_id:location,is_buy_order:buy,volume_remain:10,price});
 const eve={request:async path=>{calls++;const query=new URL('https://esi.evetech.net'+path).searchParams;assert.equal(query.get('order_type'),'all');const page=Number(query.get('page'));if(fail&&page===2)throw Error('outage');return {pages:2,expires:Date.now()+60000,data:page===1?[order(100,false),order(50,true),order(500,true,123),order(1,false,123)]:[order(80,false),order(60,true)]};}};
 const price=jitaPricing(db,eve,true),quote=(await price([9848]))[0];
 assert.equal(quote.buy,60);assert.equal(quote.sell,80);assert.equal(quote.average,70);
 await price([9848]);assert.equal(calls,2);
 db.prepare('DELETE FROM public_cache').run();fail=true;
 assert.ok((await price([9848]))[0].error);assert.equal(db.prepare('SELECT count(*) n FROM public_cache').get().n,0);
 const missing=jitaPricing(db,{request:async()=>({pages:1,expires:Date.now()+60000,data:[order(100,false)]})},true);
 const q=(await missing([9848]))[0];assert.equal(q.buy,null);assert.equal(q.sell,100);assert.equal(q.average,null);
}));

test('mining snapshots stay private and failed pagination preserves the previous ledger',()=>fixture(async({db,user,request})=>{
 const a=user(501,'Miner'),b=user(502,'Other');let fail=false;
 db.prepare('UPDATE characters SET scopes=? WHERE id=501').run(JSON.stringify(['esi-industry.read_character_mining.v1']));
 const eve={get:async()=>{throw Error('No other snapshots')},request:async path=>{if(fail&&path.endsWith('=2'))throw Error('ESI unavailable');return {pages:2,data:[{date:new Date().toISOString().slice(0,10),type_id:path.endsWith('=1')?1:2,solar_system_id:30000142,quantity:100}]}}};
 const sync=syncService(db,eve,{...fakeCat,type:id=>({name:'Ore '+id,volume:.1})});sync.queue(a.uid,501,true);await sync.tick();
 const before=db.prepare("SELECT data FROM snapshots WHERE character_id=501 AND kind='mining'").get().data;assert.equal(JSON.parse(before).rows.length,2);
 fail=true;sync.queue(a.uid,501,true);await sync.tick();assert.equal(db.prepare("SELECT data FROM snapshots WHERE character_id=501 AND kind='mining'").get().data,before);
 const own=await(await request('/api/operations/mining',{session:a.session})).json();assert.equal(own[0].data.rows.length,2);assert.match(own[0].error,/retained/);
 const other=await(await request('/api/operations/mining',{session:b.session})).json();assert.equal(other.length,1);assert.equal(other[0].id,502);assert.equal(other[0].data,null);
 assert.equal((await request('/api/operations/mining')).status,401);assert.equal((await request('/api/mining/refining')).status,401);assert.equal((await request('/api/operations/wallet-history')).status,401);assert.deepEqual((await(await request('/api/operations/wallet-history',{session:b.session})).json()).map(c=>c.id),[502]);const refining=await(await request('/api/mining/refining',{session:b.session})).json();assert.deepEqual(refining.recipes,{});assert.deepEqual(refining.prices,[]);
 assert.equal((await request('/auth/login?link=1&mining=1&character=501',{session:b.session})).status,404);
 const auth=await request('/auth/login?link=1&mining=1&character=501',{session:a.session});assert.equal(auth.status,302);assert(new URL(auth.headers.get('location')).searchParams.get('scope').includes('esi-industry.read_character_mining.v1'));
 const regular=await request('/auth/login');assert(new URL(regular.headers.get('location')).searchParams.get('scope').includes('esi-industry.read_character_mining.v1'));
}));

test('mining authorization is bound to its selected pilot and is requested and saved by ordinary reconnect',()=>fixture(async({db,user,request,identity})=>{
 const a=user(601,'Miner');const before=db.prepare('SELECT tokens FROM characters WHERE id=601').get().tokens;
 const start=await request('/auth/login?link=1&mining=1&character=601',{session:a.session});const url=new URL(start.headers.get('location')),browser=start.headers.get('set-cookie').match(/tools_oauth=([^;]+)/)[1];
 identity({id:602,name:'Wrong pilot',owner:'owner-602',expires:Date.now()+100000,scopes:['esi-industry.read_character_mining.v1']});
 const wrong=await request('/auth/callback?state='+url.searchParams.get('state')+'&code=x',{cookie:'tools_oauth='+browser+'; tools_session='+a.session});assert.equal(wrong.status,403);assert.equal(db.prepare('SELECT tokens FROM characters WHERE id=601').get().tokens,before);
 db.prepare('UPDATE characters SET scopes=? WHERE id=601').run(JSON.stringify(['esi-industry.read_character_mining.v1']));
 const normal=await request('/auth/login?link=1',{session:a.session}),normalUrl=new URL(normal.headers.get('location')),normalBrowser=normal.headers.get('set-cookie').match(/tools_oauth=([^;]+)/)[1];
 identity({id:601,name:'Miner',owner:'owner-601',expires:Date.now()+100000,scopes:['esi-industry.read_character_mining.v1']});
 const login=await request('/auth/callback?state='+normalUrl.searchParams.get('state')+'&code=x',{cookie:'tools_oauth='+normalBrowser+'; tools_session='+a.session});assert.equal(login.status,302);
 const saved=db.prepare('SELECT tokens,scopes FROM characters WHERE id=601').get();assert.notEqual(saved.tokens,before);assert(JSON.parse(saved.scopes).includes('esi-industry.read_character_mining.v1'));
}));

test('document tags persist, default safely, and respect document ownership',()=>fixture(async({user,request})=>{
 const a=user(701,'Tag owner'),b=user(702,'Other');
 const create=await request('/api/documents',{session:a.session,method:'POST',body:{kind:'plan',name:'Tagged',body:[{id:1,level:1}],tag:'  Mining  ',shared:true}});
 assert.equal(create.status,200);const {id}=await create.json();
 const list=await(await request('/api/documents',{session:b.session})).json();assert.equal(list.find(d=>d.id===id).tag,'Mining');
 assert.equal((await request('/api/documents/'+id,{session:b.session,method:'PUT',body:{name:'No',body:[{id:1,level:1}],tag:'Corp'}})).status,403);
 const update=await request('/api/documents/'+id,{session:a.session,method:'PUT',body:{name:'Tagged',body:[{id:1,level:1}],tag:'alliance'}});assert.equal(update.status,200);
 assert.equal((await(await request('/api/documents/'+id,{session:a.session})).json()).tag,'Alliance');
 assert.equal((await request('/api/documents',{session:a.session,method:'POST',body:{kind:'plan',name:'Invalid',body:[{id:1,level:1}],tag:'x'.repeat(41)}})).status,400);
}));

test('contracts sync, privacy and missing permission remain isolated',()=>fixture(async({db,user,request})=>{
 const a=user(601,'Contractor'),b=user(602,'Other');
 db.prepare('UPDATE characters SET scopes=? WHERE id=601').run(JSON.stringify(['esi-contracts.read_character_contracts.v1']));
 const sync=syncService(db,{get:async()=>{throw Error('Other sync unavailable')},request:async path=>({pages:1,data:path.includes('?page=')?[{contract_id:11,type:'courier',status:'outstanding'}]:[]})},fakeCat);
 sync.queue(a.uid,601,true);await sync.tick();
 assert.equal(JSON.parse(db.prepare("SELECT data FROM snapshots WHERE character_id=601 AND kind='contracts'").get().data).contracts[0].contract_id,11);
 assert.equal((await request('/api/operations/contracts')).status,401);
 const other=await(await request('/api/operations/contracts',{session:b.session})).json();assert.equal(other.length,1);assert.equal(other[0].data,null);
 sync.queue(b.uid,602,true);await sync.tick();assert.equal(db.prepare("SELECT count(*) n FROM sync_errors WHERE character_id=602 AND kind='contracts'").get().n,0);
}));

test('admin inspection is session-bound, read-only, private and reversible',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),target=user(701,'Sno'),other=user(702,'Other');
 assert.equal((await request('/api/inspect',{session:other.session,method:'POST',body:{user_id:target.uid}})).status,403);
 assert.equal((await request('/api/inspect',{session:admin.session,method:'POST',body:{user_id:target.uid},origin:'https://evil.example'})).status,403);
 assert.equal((await request('/api/inspect',{session:admin.session,method:'POST',body:{user_id:target.uid}})).status,200);
 const me=await(await request('/api/me',{session:admin.session})).json();assert.equal(me.name,'Sno');assert.equal(me.admin,false);assert.equal(me.inspect.name,'Sno');
 const chars=await(await request('/api/characters',{session:admin.session})).json();assert.deepEqual(chars.map(c=>c.id),[701]);
 assert.equal((await request('/api/admin/users',{session:admin.session})).status,403);
 assert.equal((await request('/api/sync',{session:admin.session,method:'POST',body:{}})).status,403);
 assert.equal((await request('/auth/login?link=1',{session:admin.session})).status,403);
 assert.equal(db.prepare('SELECT * FROM user_activity WHERE user_id=?').get(target.uid),undefined);
 assert.equal((await(await request('/api/me',{session:other.session})).json()).name,'Other');
 assert.equal((await request('/api/inspect',{session:admin.session,method:'POST',body:{exit:true}})).status,200);
 const restored=await(await request('/api/me',{session:admin.session})).json();assert.equal(restored.name,'Admin');assert.equal(restored.admin,true);assert.equal(restored.inspect,null);
}));


test('settings, group approval and corporate grants enforce account, admin and endpoint boundaries',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),a=user(801,'Applicant'),b=user(802,'Other');
 const post=(path,session,body)=>request(path,{session,body,method:'POST'});
 assert.equal((await post('/api/settings',a.session,{pi:false})).status,200);
 assert.equal((await(await request('/api/settings',{session:b.session})).json()).preferences.pi,undefined);
 assert.equal((await post('/api/settings',a.session,{'unknown-page':false})).status,400);
 const group={name:'Moon Manager',icon:'☾',description:'Manage moons',mode:'approval',rules:[],pages:['corp-moons']};
 assert.equal((await post('/api/admin/groups',a.session,group)).status,403);
 assert.equal((await post('/api/admin/groups',admin.session,group)).status,200);
 const id=db.prepare('SELECT id FROM access_groups WHERE id NOT IN (SELECT group_id FROM contributor_groups)').get().id;
 assert.equal((await post('/api/groups/'+id+'/apply',a.session,{})).status,200);
 assert.equal((await request('/api/corporation/harvest',{session:a.session})).status,403);
 assert.equal((await post('/api/admin/groups/'+id+'/member',admin.session,{user_id:a.uid,status:'approved'})).status,200);
 const me=await(await request('/api/me',{session:a.session})).json();assert.deepEqual(me.corporate_pages,['corp-moons','corp-projects']);assert.equal(me.director,false);
 assert.equal((await request('/api/corporation/structures',{session:a.session})).status,403);
 assert.equal((await request('/api/corporation/members',{session:a.session})).status,403);
 assert.equal((await post('/api/corporation/sync',a.session,{})).status,403);
 assert.equal((await post('/api/admin/groups/'+id+'/member',admin.session,{user_id:a.uid,status:'rejected'})).status,200);
 assert.deepEqual((await(await request('/api/me',{session:a.session})).json()).corporate_pages,['corp-projects']);
 assert.equal((await post('/api/admin/links',admin.session,{name:'Bad',url:'javascript:alert(1)'})).status,400);
 assert.equal((await post('/api/admin/links',admin.session,{name:'Good',description:'Link',url:'https://example.com'})).status,200);
}));

test('mail and contacts require active inspection, owned pilot, scope and read-only access',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),target=user(901,'Target'),other=user(902,'Other');
 assert.equal((await request('/api/inspect/mail?character=901',{session:admin.session})).status,403);
 assert.equal((await request('/api/inspect/contacts?character=901',{session:target.session})).status,403);
 await request('/api/inspect',{session:admin.session,method:'POST',body:{user_id:target.uid}});
 assert.equal((await request('/api/inspect/mail?character=902',{session:admin.session})).status,404);
 assert.equal((await request('/api/inspect/mail?character=901',{session:admin.session})).status,403);
 assert.equal((await request('/api/settings',{session:admin.session,method:'POST',body:{pi:false}})).status,403);
 assert.equal((await request('/api/admin/groups',{session:admin.session})).status,403);
}));


test('disabled feature syncs stop their ESI calls and resume when enabled',()=>fixture(async({db,user})=>{
 const a=user(1101,'Settings Pilot'),calls=[];
 db.prepare('INSERT INTO page_preferences VALUES(?,?)').run(a.uid,JSON.stringify({pi:false,dens:false,industry:false,blueprints:false,mining:false}));
 const sync=syncService(db,{get:async path=>{calls.push(path);if(path.endsWith('/planets'))return [];throw Error('Unrelated unavailable');},request:async path=>{calls.push(path);throw Error('Unrelated unavailable');},publicGet:async()=>[]},fakeCat);
 sync.queue(a.uid,1101,true);await sync.tick();assert.equal(calls.some(p=>p.includes('/planets')||p.includes('mercenary')||p.includes('/industry/jobs')||p.includes('/mining')),false);
 db.prepare('UPDATE page_preferences SET data=? WHERE user_id=?').run(JSON.stringify({pi:true,dens:false,industry:false,blueprints:false,mining:false}),a.uid);
 sync.queue(a.uid,1101,true);await sync.tick();assert(calls.some(p=>p.endsWith('/planets')));
 assert.equal(db.prepare("SELECT 1 FROM snapshots WHERE character_id=1101 AND kind='pi'").get()[1],1);
}));

test('authorized inspection reads mail bodies and contact pages without leaking another pilot',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),target=user(1201,'Target');
 db.prepare('UPDATE characters SET scopes=? WHERE id=1201').run(JSON.stringify(['esi-mail.read_mail.v1','esi-characters.read_contacts.v1']));
 await request('/api/inspect',{session:admin.session,method:'POST',body:{user_id:target.uid}});
 const mail=await request('/api/inspect/mail?character=1201',{session:admin.session});assert.equal(mail.status,200);const listing=await mail.json();assert.equal(listing.rows[0].subject,'Test');assert.equal(listing.names[99],'Contact');assert.equal(listing.names['mailing_list:42'],'Test mailing list');
 const body=await request('/api/inspect/mail?character=1201&mail=12',{session:admin.session});assert.equal(body.status,200);const detail=await body.json();assert.equal(detail.body,'<b>Read only</b>');assert.equal(detail.names[99],'Contact');assert.equal(detail.names['mailing_list:42'],'Test mailing list');assert.equal(detail.from,99);assert.equal(detail.recipients[0].recipient_id,42);
 const contacts=await request('/api/inspect/contacts?character=1201&page=2',{session:admin.session});assert.equal(contacts.status,200);assert.equal((await contacts.json()).rows[0].contact_id,99);
 assert.equal((await request('/api/inspect/mail?character=1201',{session:target.session})).status,403);
},fakeCat,{eve:{get:async path=>path.endsWith('/lists/')?[{mailing_list_id:42,name:'Test mailing list'}]:({subject:'Test',body:'<b>Read only</b>',from:99,recipients:[{recipient_id:42,recipient_type:'mailing_list'}]}),request:async(path,c,method,ids)=>path==='/universe/names'?(assert.deepEqual(ids,[99]),{data:[{id:99,name:'Contact'}]}):path.includes('contacts')?{data:[{contact_id:99,standing:5}],pages:2}:{data:[{mail_id:12,from:99,subject:'Test',recipients:[{recipient_id:42,recipient_type:'mailing_list'}]}],pages:1}}}));


test('saved fitting imports are owned, private, idempotent and recover after deleting the copy',()=>{
 const types={1:{id:1,name:'Rifter',category_id:6,attributes:{}},2:{id:2,name:'Damage Control II',category_id:7,attributes:{}}};
 const cat={...fakeCat,type:id=>types[id]||null,named:name=>Number(Object.keys(types).find(id=>types[id].name===name))};
 const fit={fitting_id:55,name:'In Game Fit',description:'Saved original',ship_type_id:1,items:[{type_id:2,flag:'LoSlot0',quantity:1}]};
 return fixture(async({db,user,request})=>{
  const a=user(1301,'Owner'),b=user(1302,'Other');
  db.prepare('UPDATE characters SET scopes=? WHERE id=1301').run('["esi-fittings.read_fittings.v1"]');
  assert.equal((await request('/api/characters/1301/saved-fittings',{session:b.session})).status,404);
  assert.equal((await request('/api/characters/1302/saved-fittings',{session:b.session})).status,403);
  const path='/api/characters/1301/saved-fittings/55/import',post=()=>request(path,{session:a.session,method:'POST',body:{}});
  const r=await post();assert.equal(r.status,200);const id=(await r.json()).id;
  const saved=db.prepare('SELECT * FROM documents WHERE id=?').get(id);assert.equal(saved.owner,a.uid);assert.equal(saved.shared,0);assert(JSON.parse(saved.body).includes('Damage Control II'));
  assert.equal((await(await post()).json()).id,id);assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,1);
  assert.equal((await request('/api/documents/'+id,{session:b.session})).status,404);
  await request('/api/documents/'+id,{session:a.session,method:'DELETE',body:{}});assert.equal(db.prepare('SELECT count(*) n FROM fitting_imports').get().n,0);
  assert.notEqual((await(await post()).json()).id,id);
 },cat,{eve:{get:async()=>[fit]}});
});

test('new corporation pages require their own grant and assets never grant wallet or pilot access',()=>fixture(async({db,user,request})=>{
 const director=user(1401,'Director'),viewer=user(1402,'Viewer'),other=user(1403,'Other');connectCorpFixture(db,director.uid,1401);
 db.prepare("INSERT INTO access_groups(id,name,icon,description,mode,rules,pages) VALUES(1001,'Assets','A','','auto','[]','[\"corp-assets\"]')").run();db.prepare("INSERT INTO group_members VALUES(1001,?,'approved')").run(viewer.uid);
 assert.equal((await request('/api/corporation/assets',{session:other.session})).status,403);
 const response=await request('/api/corporation/assets',{session:viewer.session});assert.equal(response.status,200);assert.equal((await response.json()).total,1);
 for(const path of ['wallet','pilots'])assert.equal((await request('/api/corporation/'+path,{session:viewer.session})).status,403);
 assert.equal((await request('/api/corporation/sync',{session:viewer.session,method:'POST',body:{}})).status,403);
},fakeCat,{verifyCorporation:async()=>({id:668298004,role:'Director'}),eve:{publicGet:async()=>({name:'Station'})},corpNetwork:async url=>new Response(JSON.stringify(new URL(url).pathname.endsWith('/assets')?[{item_id:1,type_id:1,location_id:60003760,location_flag:'CorpSAG1',quantity:1}]:[]),{headers:{'content-type':'application/json','cache-control':'max-age=3600'}})}));

test('Market history is account private and the settings switch stops collection',()=>fixture(async({db,user,request})=>{
 const a=user(1501,'Trader'),b=user(1502,'Other');db.prepare('UPDATE characters SET scopes=? WHERE id=1501').run('["esi-markets.read_character_orders.v1"]');
 const calls=[],sync=syncService(db,{request:async path=>{if(!path.includes('/orders'))throw Error('Unrelated');calls.push(path);return {pages:1,data:[]};},get:async()=>{throw Error('Unrelated');}},fakeCat);
 await request('/api/settings',{session:a.session,method:'POST',body:{market:false}});sync.queue(a.uid,1501,true);await sync.tick();assert.equal(calls.length,0);
 await request('/api/settings',{session:a.session,method:'POST',body:{market:true}});sync.queue(a.uid,1501,true);await sync.tick();assert.equal(calls.length,2);
 const own=await(await request('/api/operations/market',{session:a.session})).json(),other=await(await request('/api/operations/market',{session:b.session})).json();assert.equal(own[0].id,1501);assert.deepEqual(own[0].data.active,[]);assert.equal(other[0].data,null);
}));


test('normal login, linking and mining reconnect request the complete unified scope set',()=>fixture(async({user,request})=>{
 const {SCOPES}=await import('../lib/eve.mjs'),{CORP_SCOPES}=await import('../lib/corp.mjs'),u=user(100,'Main');
 for(const path of ['/auth/login','/auth/login?link=1','/auth/login?link=1&mining=1&character=100']){
  const r=await request(path,{session:u.session});assert.equal(r.status,302);const scopes=new URL(r.headers.get('location')).searchParams.get('scope').split(' ');
  assert.deepEqual(new Set(scopes),new Set(SCOPES));for(const scope of CORP_SCOPES)assert(scopes.includes(scope));assert.equal(scopes.length,new Set(scopes).size);
 }
}));

test('normal CEO/director login registers corporation access using the linked character token provider',async()=>{
 const {SCOPES}=await import('../lib/eve.mjs');let tokenCharacter=null;
 await fixture(async({db,request,identity,corp})=>{
  identity({id:100,name:'New Director',owner:'owner-100',expires:Date.now()+3600000,scopes:SCOPES});
  const start=await request('/auth/login'),url=new URL(start.headers.get('location')),cookie=start.headers.get('set-cookie').split(';')[0];
  const response=await request('/auth/callback?code=normal&state='+url.searchParams.get('state'),{cookie});assert.equal(response.status,302);
  const u=db.prepare('SELECT * FROM users WHERE main_id=100').get(),grant=db.prepare('SELECT * FROM corp_authorizations WHERE user_id=?').get(u.id);
  assert.equal(grant.character_id,100);assert.equal(grant.role,'Director');assert.deepEqual(cryptoBox(key).open(grant.tokens),{linked_character_id:100});
  db.prepare('UPDATE characters SET expires=0 WHERE id=100').run();
  assert.equal(await corp.access(u.id,true),true);assert.equal(tokenCharacter,100);
  assert.equal(db.prepare('SELECT character_id FROM corporation_connections').get().character_id,100);
 },fakeCat,{verifyCorporation:async()=>({id:668298004,name:'Sacred Templars',role:'Director'}),eve:{token:async c=>{tokenCharacter=c.id;return 'personal-refreshed';}}});
});

test('ordinary members connect normally, keep another director grant, and remove their own lost or unlinked grant',async()=>{
 const {SCOPES}=await import('../lib/eve.mjs');let isDirector=true;
 await fixture(async({db,user,request,identity,corp})=>{
  const u=user(100,'Main');let session=u.session;
  const connect=async id=>{
   identity({id,name:'Pilot '+id,owner:'owner-'+id,expires:Date.now()+3600000,scopes:SCOPES});
   const start=await request('/auth/login?link=1',{session}),url=new URL(start.headers.get('location'));
   const cookie=start.headers.get('set-cookie').split(';')[0]+'; tools_session='+session;
   const r=await request('/auth/callback?code=link&state='+url.searchParams.get('state'),{cookie});assert.equal(r.status,302);
   session=r.headers.get('set-cookie').match(/tools_session=([^;, ]+)/)[1];
  };
  await connect(200);assert.equal(db.prepare('SELECT character_id FROM corp_authorizations').get().character_id,200);
  isDirector=false;await connect(300);assert.equal(db.prepare('SELECT character_id FROM corp_authorizations').get().character_id,200);
  await connect(200);assert.equal(db.prepare('SELECT count(*) n FROM corp_authorizations').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM corporation_connections').get().n,0);
  isDirector=true;await connect(200);assert.equal(await corp.access(u.uid,true),true);
  assert.equal((await request('/api/characters/200',{session,method:'DELETE',body:{}})).status,200);assert.equal(await corp.access(u.uid),false);
 },fakeCat,{verifyCorporation:async()=>{if(!isDirector)throw Object.assign(Error('Not director'),{status:403});return {id:668298004,name:'Sacred Templars',role:'Director'};},eve:{token:async()=> 'personal'}});
});

test('temporary corporation verification failure does not block ordinary login',async()=>{
 const {SCOPES}=await import('../lib/eve.mjs');
 await fixture(async({db,request,identity})=>{
  identity({id:100,name:'Member',owner:'owner-100',expires:Date.now()+3600000,scopes:SCOPES});
  const start=await request('/auth/login'),url=new URL(start.headers.get('location'));
  const r=await request('/auth/callback?code=normal&state='+url.searchParams.get('state'),{cookie:start.headers.get('set-cookie').split(';')[0]});
  assert.equal(r.status,302);assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM corp_authorizations').get().n,0);
 },fakeCat,{verifyCorporation:async()=>{throw Object.assign(Error('ESI offline'),{status:502});}});
});


test('scope notices and den notifications stay account-owned and respect disabled dens',()=>fixture(async({db,user,request})=>{
 const a=user(1601,'Owner'),b=user(1602,'Other');
 const chars=await(await request('/api/characters',{session:a.session})).json();assert(chars[0].missing_scopes.includes('esi-characters.read_titles.v1'));assert.equal(chars[0].tokens,undefined);
 db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(1601,'dens',JSON.stringify([{id:1,evolution:{anarchy:{level:'Level2',amount:40}},operations:[]}]),Date.now(),Date.now()+3600000);
 assert.equal((await(await request('/api/notifications',{session:a.session})).json()).length,1);assert.deepEqual(await(await request('/api/notifications',{session:b.session})).json(),[]);assert.equal((await request('/api/notifications')).status,401);
 await request('/api/settings',{session:a.session,method:'POST',body:{dens:false}});assert.deepEqual(await(await request('/api/notifications',{session:a.session})).json(),[]);
}));

test('admin role/title group requirements are scoped to STEMP and validated',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),a=user(1701,'Applicant'),post=(body,session=admin.session)=>request('/api/admin/groups',{session,method:'POST',body});
 const group={name:'Members',mode:'restricted',rules:[{kind:'role',id:'Director'},{kind:'title',id:5}],pages:['corp-moons']};
 assert.equal((await post(group,a.session)).status,403);assert.equal((await post(group)).status,200);
 const g=db.prepare('SELECT * FROM access_groups WHERE id NOT IN (SELECT group_id FROM contributor_groups)').get();assert(JSON.parse(g.rules).every(r=>r.corporation_id===668298004));assert.equal((await post({...group,rules:[{kind:'role',id:'<script>'}]})).status,400);
 const apply=()=>request('/api/groups/'+g.id+'/apply',{session:a.session,method:'POST',body:{}});assert.equal((await apply()).status,400);
 for(const [kind,data] of [['roles',{corporation_id:668298004,roles:['Director']}],['titles',{corporation_id:668298004,titles:[{title_id:5}]}]])db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(1701,kind,JSON.stringify(data),Date.now(),Date.now()+3600000);
 assert.equal((await apply()).status,200);
}));


test("admin rebalance minimizes moves, preserves jobs and is idempotent",async()=>{
 await fixture(async({db,user,request})=>{
  const owner=user(100,"Owner"),other=user(101,"Member");
  for(let i=102;i<113;i++)user(i,"Pilot "+i);
  db.prepare('UPDATE character_buckets SET minute=20,next_due=1234').run();
  db.prepare("INSERT INTO jobs(character_id,status) VALUES(100,'running'),(101,'queued')").run();
  const before=db.prepare('SELECT * FROM jobs ORDER BY character_id').all();
  assert.equal((await request('/api/admin/esi/rebalance',{session:other.session,body:{},method:'POST'})).status,403);
  const result=await request('/api/admin/esi/rebalance',{session:owner.session,body:{},method:'POST'});
  assert.equal(result.status,200);assert.deepEqual(await result.json(),{moved:10,total:13});
  const counts=[0,10,20,30,40,50].map(m=>db.prepare('SELECT count(*) n FROM character_buckets WHERE minute=?').get(m).n);
  assert.deepEqual(counts,[2,2,3,2,2,2]);
  assert.deepEqual(db.prepare('SELECT * FROM jobs ORDER BY character_id').all(),before);
  for(const b of db.prepare('SELECT * FROM character_buckets').all()){
   if(b.minute===20)assert.equal(b.next_due,1234);
   else {assert.ok(b.next_due>Date.now());assert.equal(new Date(b.next_due).getUTCMinutes(),b.minute);}
  }
  const schedule=db.prepare('SELECT * FROM character_buckets ORDER BY character_id').all();
  assert.deepEqual(await (await request('/api/admin/esi/rebalance',{session:owner.session,body:{},method:'POST'})).json(),{moved:0,total:13});
  assert.deepEqual(db.prepare('SELECT * FROM character_buckets ORDER BY character_id').all(),schedule);
 });
});


test('all members can see links and sidebar font size is validated and account-private',async()=>{
 await fixture(async({db,user,request})=>{
  const a=user(101,'Member A'),b=user(102,'Member B');
  db.prepare('INSERT INTO external_links(name,description,url) VALUES(?,?,?)').run('Public Link','For all members','https://example.com/');
  assert.equal((await(await request('/api/links',{session:a.session})).json()).length,1);
  const me=await(await request('/api/me',{session:a.session})).json();assert.equal(me.corporation,true);assert.deepEqual(me.corporate_pages,['corp-projects']);assert.equal(me.links.length,1);
  assert.equal((await request('/api/admin/links',{session:a.session})).status,403);
  for(const value of ['tiny',null,18])assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{font_size:value}})).status,400);
  for(const value of ['normal','small','large','extra-large'])assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{font_size:value}})).status,200);
  assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{'admin-links':false}})).status,200);
  assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{overview_guide_dismissed:true}})).status,200);
  const savedSettings=await(await request('/api/me',{session:a.session})).json();
  assert.equal(savedSettings.preferences.overview_guide_dismissed,true);
  assert.equal(savedSettings.preferences.font_size,'extra-large');
  assert.equal(savedSettings.preferences['admin-links'],false);
  assert.equal((await(await request('/api/me',{session:b.session})).json()).preferences.font_size,undefined);
  for(const value of [9,21,12.5,'16',null])assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{sidebar_font_size:value}})).status,400);
  assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{sidebar_font_size:16}})).status,200);
  assert.equal((await(await request('/api/me',{session:a.session})).json()).preferences.sidebar_font_size,16);
  assert.equal((await(await request('/api/me',{session:b.session})).json()).preferences.sidebar_font_size,undefined);
 });
});


test('appearance themes persist per account and reject unknown theme values',async()=>{
 await fixture(async({user,request})=>{
  const a=user(101,'A'),b=user(102,'B');
  for(const theme of ['cyberpunk','chrome','dracula','nord','solarized','oled','nebula'])assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{theme}})).status,200);
  for(const theme of ['invalid','<script>',null,{},true])assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{theme}})).status,400);
  assert.equal((await(await request('/api/me',{session:a.session})).json()).preferences.theme,'nebula');
  assert.equal((await(await request('/api/me',{session:b.session})).json()).preferences.theme,undefined);
 });
});


test('owner-confirmed account wipe removes private records and preserves other accounts',async()=>{
 await fixture(async({db,user,request})=>{
  const owner=user(100,'Owner'),target=user(200,'Delete Me'),other=user(300,'Keep Me');
  db.prepare("UPDATE users SET admin=1 WHERE id=?").run(other.uid);
  db.prepare("INSERT INTO characters SELECT 201,user_id,'Alt',owner_hash,tokens,scopes,expires,reconnect FROM characters WHERE id=200").run();
  db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(200,'wallet-history','{}',1,2);db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(300,'skills','{}',1,2);
  db.prepare("INSERT INTO jobs(character_id) VALUES(200)").run();db.prepare("INSERT INTO sync_errors VALUES(200,'wallet-history','error')").run();
  db.prepare("INSERT INTO esi_cache VALUES(200,'/wallet','{}',0)").run();db.prepare("INSERT INTO corp_http_cache VALUES(200,'/private','{}',0)").run();
  db.prepare("INSERT INTO documents VALUES('target-fit',?,'fitting','Fit','body',1,0),('target-plan',?,'plan','Plan','body',0,0),('other-plan',?,'plan','Keep','body',0,0)").run(target.uid,target.uid,other.uid);
  db.prepare("INSERT INTO fitting_plans VALUES(?,'target-fit','target-plan')").run(target.uid);db.prepare("INSERT INTO fitting_plans VALUES(?,'target-fit','other-plan')").run(other.uid);
  db.prepare("INSERT INTO document_tags VALUES('target-fit','Private Tag')").run();
  db.prepare('INSERT INTO user_logins VALUES(?,1)').run(target.uid);db.prepare('INSERT INTO user_activity VALUES(?,1)').run(target.uid);
  db.prepare("INSERT INTO page_preferences VALUES(?,'{}')").run(target.uid);db.prepare("INSERT INTO pi_settings VALUES(?,'{}')").run(target.uid);
  db.prepare('INSERT INTO pi_shares VALUES(?,?,200)').run(target.uid,other.uid);
  db.prepare("INSERT INTO access_groups(id,name,icon,description,mode,rules,pages) VALUES(1001,'Group','G','','approval','[]','[]')").run();db.prepare("INSERT INTO group_members VALUES(1001,?,'approved')").run(target.uid);
  db.prepare("INSERT INTO fitting_imports VALUES(?,200,1,'target-fit','Saved')").run(target.uid);
  db.prepare("INSERT INTO oauth VALUES('delete-flow','browser',?,NULL,'verifier',9999999999999)").run(target.uid);db.prepare("INSERT INTO oauth_mining VALUES('delete-flow',200)").run();
  db.prepare('INSERT INTO inspections VALUES(?,?)').run(hash(other.session),target.uid);db.prepare('INSERT INTO inspections VALUES(?,?)').run(hash(target.session),other.uid);
  db.prepare("INSERT INTO corp_authorizations VALUES(?,200,'Delete Me','owner-200',668298004,'encrypted','[]',0,'Director',0)").run(target.uid);
  db.prepare("INSERT INTO corporation_connections VALUES(668298004,'Corp',200,'Delete Me','owner-200','encrypted',0,'Director')").run();
  db.prepare("INSERT INTO public_cache VALUES('/tools/corp-data/pilots','{}',0),('/shared-public','{}',0)").run();
  db.exec('CREATE TABLE invites(hash TEXT PRIMARY KEY,created_by INTEGER,expires INTEGER,used_by INTEGER)');
  db.prepare("INSERT INTO invites VALUES('made',?,0,NULL),('used',?,0,?),('keep',?,0,NULL)").run(target.uid,owner.uid,target.uid,other.uid);
  const del=(session,id,main)=>request('/api/admin/users/'+id,{session,method:'DELETE',body:main===undefined?{}:{confirm_main_id:main}});
  assert.equal((await del(other.session,target.uid,200)).status,403);
  assert.equal((await del(owner.session,owner.uid,100)).status,400);
  assert.equal((await del(owner.session,target.uid)).status,400);assert.equal((await del(owner.session,target.uid,201)).status,400);
  const result=await del(owner.session,target.uid,200);assert.equal(result.status,200);assert.deepEqual(await result.json(),{deleted:true,characters:2});
  for(const table of ['jobs','sync_errors','esi_cache','corp_http_cache','fitting_plans','document_tags','user_logins','page_preferences','pi_settings','pi_shares','group_members','fitting_imports','oauth','oauth_mining','inspections','corp_authorizations','corporation_connections'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM characters').get().n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM snapshots').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,1);assert.ok(db.prepare("SELECT 1 FROM documents WHERE id='other-plan'").get());
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM user_activity WHERE user_id=?').get(target.uid).n,0);
  assert.ok(db.prepare("SELECT 1 FROM public_cache WHERE path='/shared-public'").get());assert.equal(db.prepare("SELECT 1 FROM public_cache WHERE path='/tools/corp-data/pilots'").get(),undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM invites').get().n,1);assert.ok(db.prepare("SELECT 1 FROM invites WHERE hash='keep'").get());
  assert.equal((await request('/api/me',{session:target.session})).status,401);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 });
});


test('an in-flight sync cannot restore a deleted account snapshot or sync error',async()=>{
 await fixture(async({db,user,request})=>{
  const owner=user(100,'Owner'),target=user(200,'Delete While Syncing');
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const sync=syncService(db,{get:async path=>{if(path.endsWith('/skills')){entered();await gate;return {skills:[]};}return path.endsWith('/skillqueue')?[]:{};}},fakeCat);
  sync.queue(target.uid,200,true);const running=sync.tick();await started;
  try{assert.equal((await request('/api/admin/users/'+target.uid,{session:owner.session,method:'DELETE',body:{confirm_main_id:200}})).status,200);}finally{release();}
  await running;
  for(const table of ['characters','snapshots','sync_errors','jobs','esi_cache'])assert.equal(db.prepare('SELECT count(*) n FROM '+table+(table==='characters'?' WHERE id=200':" WHERE character_id=200")).get().n,0,table);
 });
});


test('fitting workbench saves private copies, protects ownership and rejects other-account pilot checks',()=>fixture(async({db,user,request})=>{
 const a=user(7101,'Builder'),b=user(7102,'Other');
 assert.equal((await request('/api/fitting-workbench/source')).status,401);
 const source=await request('/api/fitting-workbench/source',{session:a.session});assert.equal(source.status,200);assert.match(source.headers.get('content-disposition'),/tools-fitting-source.zip/);assert.ok((await source.arrayBuffer()).byteLength>1000);
 const license=await request('/api/fitting-workbench/license',{session:a.session});assert.equal(license.status,200);assert.match(await license.text(),/GNU AFFERO GENERAL PUBLIC LICENSE/);
 const fit={ship_id:1,name:'Workbench Test',items:[]};
 const create=await request('/api/fitting-workbench/save',{session:a.session,method:'POST',body:{fit}});assert.equal(create.status,200);const {id}=await create.json();
 assert.equal(db.prepare('SELECT shared FROM documents WHERE id=?').get(id).shared,0);
 assert.equal((await request('/api/fitting-workbench/documents/'+id,{session:b.session})).status,404);
 assert.equal((await request('/api/fitting-workbench/save',{session:b.session,method:'POST',body:{id,fit}})).status,404);
 assert.equal((await request('/api/fitting-workbench/preview',{session:a.session,method:'POST',body:{fit,pilot:7102}})).status,404);
 const own=await(await request('/api/fitting-workbench/documents/'+id,{session:a.session})).json();assert.equal(own.mine,true);assert.equal(own.fit.name,'Workbench Test');
 await request('/api/documents/'+id,{session:a.session,method:'PATCH',body:{shared:true}});
 const shared=await(await request('/api/fitting-workbench/documents/'+id,{session:b.session})).json();assert.equal(shared.mine,false);
 assert.equal((await request('/api/fitting-workbench/save',{session:b.session,method:'POST',body:{id,fit}})).status,403);
 assert.equal((await request('/api/fitting-workbench/save',{session:a.session,method:'POST',body:{id,fit:{...fit,name:'Edited'}}})).status,200);
 assert.equal(db.prepare('SELECT shared FROM documents WHERE id=?').get(id).shared,1);
 assert.equal((await request('/api/documents/'+id,{session:a.session,method:'DELETE',body:{}})).status,200);assert.equal(db.prepare('SELECT 1 FROM fitting_workspaces WHERE document_id=?').get(id),undefined);
}, {...fakeCat,type:id=>({id,name:'Test Hull',category_id:6,attributes:{}}),named:()=>1}));


test('fitting ammo browser filters by weapon and size before limiting search results',()=>fixture(async({user,request})=>{
 const a=user(7201,'Ammo Pilot');
 const get=async suffix=>await request('/api/fitting-workbench/items?category=charges&'+suffix,{session:a.session});
 const missiles=await(await get('module=19739')).json();assert.ok(missiles.some(t=>t.id===202));assert.ok(missiles.every(t=>t.category===8&&/Cruise/.test(t.name)));
 assert.deepEqual(await(await get('module=19739&q=Antimatter')).json(),[]);
 const medium=await(await get('module=3130&q=Antimatter')).json();assert.ok(medium.some(t=>t.id===230));assert.ok(!medium.some(t=>t.id===222));
 assert.equal((await get('module=-1')).status,400);
 assert.equal((await request('/api/fitting-workbench/items?category=ships&module=19739',{session:a.session})).status,400);
 assert.equal((await request('/api/fitting-workbench/items?category=charges&module=19739')).status,401);
}));


test('new corporation pages and material planning reject ungranted accounts',()=>fixture(async({user,request})=>{
 const account=user(7301,'No grants');for(const route of ['contracts','market','blueprints','standings'])assert.equal((await request('/api/corporation/'+route,{session:account.session})).status,403);
 assert.equal((await request('/api/material-planner/corporation',{session:account.session})).status,403);
 const own=await request('/api/material-planner/personal',{session:account.session});assert.equal(own.status,200);assert.deepEqual((await own.json()).blueprints,[]);
 const settings=await request('/api/settings',{session:account.session,method:'POST',body:{standings:false}});assert.equal(settings.status,200);assert.equal((await settings.json()).standings,false);
}));
test('saving EVE fittings enforces pilot ownership, scope and the actual POST payload',()=>fixture(async({db,user,request})=>{
 const owner=user(7302,'Fit owner'),other=user(7303,'Other');
 const fit={ship_id:587,name:'Export test',items:[{id:2048,section:'Low slots',quantity:1}]};
 assert.equal((await request('/api/fitting-workbench/eve',{session:owner.session,method:'POST',body:{pilot:7303,fit}})).status,404);
 assert.equal((await request('/api/fitting-workbench/eve',{session:owner.session,method:'POST',body:{pilot:7302,fit}})).status,403);
 db.prepare('UPDATE characters SET scopes=? WHERE id=7302').run('["esi-fittings.write_fittings.v1"]');
 const sent=await request('/api/fitting-workbench/eve',{session:owner.session,method:'POST',body:{pilot:7302,fit}});assert.equal(sent.status,200);assert.equal((await sent.json()).fitting_id,123);
}, {type:id=>id===587?{id,name:'Rifter',category_id:6,attributes:{}}:id===2048?{id,name:'Damage Control II',category_id:7,attributes:{}}:null,named:()=>null,close(){},search:()=>[]}, {eve:{request:async(path,pilot,method,body)=>{assert.equal(path,'/characters/7302/fittings');assert.equal(pilot.id,7302);assert.equal(method,'POST');assert.equal(body.items[0].flag,'LoSlot0');return {data:{fitting_id:123}};}}}));

test('corporation display preferences are private, permission-aware and leave sync and grants unchanged',()=>fixture(async({db,user,request})=>{
 const owner=user(7401,'Page owner'),other=user(7402,'Other');
 const before=await(await request('/api/settings',{session:owner.session})).json();assert.deepEqual(before.corporate_pages,{'corp-projects':'Projects'});
 db.prepare('INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES(?,?,?,?,?,?)').run('Wallet viewers','W','','auto','[]','["corp-wallet","corp-assets"]');const group=db.prepare('SELECT id FROM access_groups WHERE name=?').get('Wallet viewers').id;
 db.prepare('INSERT INTO group_members VALUES(?,?,?)').run(group,owner.uid,'approved');
 const available=await(await request('/api/settings',{session:owner.session})).json();assert.deepEqual(Object.keys(available.corporate_pages),['corp-wallet','corp-projects','corp-assets']);
 const save=await request('/api/settings',{session:owner.session,method:'POST',body:{'corp-wallet':false,'corp-assets':false}});assert.equal(save.status,200);
 const me=await(await request('/api/me',{session:owner.session})).json();assert(me.corporate_pages.includes('corp-wallet'));assert.equal(me.preferences['corp-wallet'],false);
 const settings=await(await request('/api/settings',{session:other.session})).json();assert.equal(settings.preferences['corp-wallet'],undefined);assert.deepEqual(settings.corporate_pages,{'corp-projects':'Projects'});
 const {syncEnabled}=await import('../lib/management.mjs');for(const kind of ['skills','wallet','wallet-history','industry','assets','standings'])assert.equal(syncEnabled(db,owner.uid,kind),true);
 assert.equal((await request('/api/settings',{session:owner.session,method:'POST',body:{'corp-wallet':'off'}})).status,400);
}));


test('notification dismissals persist across syncs and remain account owned',()=>fixture(async({db,user,request})=>{
 const a=user(9901,'Clear owner'),b=user(9902,'Other owner');
 const data=JSON.stringify([{id:1,evolution:{anarchy:{level:'Level2',amount:40}},operations:[]}]);
 for(const id of [9901,9902])db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(id,'dens',data,Date.now(),Date.now()+3600000);
 const list=async session=>(await(await request('/api/notifications',{session})).json());
 const alerts=await list(a.session),other=await list(b.session);
 assert.equal(alerts.length,1);
 const clear=keys=>request('/api/notifications/dismiss',{session:a.session,method:'POST',body:{keys}});
 assert.equal((await clear(['invalid'])).status,400);
 assert.deepEqual((await(await clear([other[0].id])).json()).dismissed,[]);
 assert.equal((await clear([alerts[0].id])).status,200);
 db.prepare("UPDATE snapshots SET updated=? WHERE character_id=9901").run(Date.now()+1000);
 assert.deepEqual(await list(a.session),[]);assert.equal((await list(b.session)).length,1);
}));


test('verified corporation roles survive transient ESI failures without granting unverified users',async()=>{
 let failure=null;
 await fixture(async({db,user,corp})=>{
  const director=user(200,'Director');connectCorpFixture(db,director.uid,200);
  const original=db.prepare('SELECT role,verified FROM corp_authorizations WHERE user_id=?').get(director.uid);
  for(const error of [Object.assign(Error('Downtime'),{status:502}),new TypeError('fetch failed'),Object.assign(Error('Rate limited'),{status:503,transient:true})]){
   failure=error;assert.equal(await corp.access(director.uid,true),true);
   assert.deepEqual(db.prepare('SELECT role,verified FROM corp_authorizations WHERE user_id=?').get(director.uid),original);
  }
  failure=Object.assign(Error('Invalid token'),{status:401});assert.equal(await corp.access(director.uid,true),false);
  failure=null;assert.equal(await corp.access(director.uid,true),true);
  failure=Object.assign(Error('Confirmed ordinary member'),{status:403,corporationRoleDenied:true});assert.equal(await corp.access(director.uid,true),false);
  assert.equal(db.prepare('SELECT role FROM corp_authorizations WHERE user_id=?').get(director.uid).role,'Revoked');
  failure=Object.assign(Error('Downtime'),{status:502});assert.equal(await corp.access(director.uid,true),false);
  const outsider=user(300,'Member');assert.equal(await corp.access(outsider.uid,true),false);
 },fakeCat,{verifyCorporation:async()=>{if(failure)throw failure;return {id:668298004,role:'Director'};}});
});


test('admin whitelist accepts verified pilots and alliances alongside existing corporations',async()=>{
 await fixture(async({db,user,request})=>{
  const owner=user(100,'Owner');
  for(const kind of ['pilot','alliance']){
   assert.equal((await request('/api/admin/whitelist',{session:owner.session,method:'POST',body:{kind,entity_id:900}})).status,200);
  }
  const entries=await (await request('/api/admin/whitelist',{session:owner.session})).json();
  assert.ok(entries.some(row=>row.kind==='corporation'));
  assert.ok(entries.some(row=>row.kind==='pilot'&&row.entity_id===900));
  assert.ok(entries.some(row=>row.kind==='alliance'&&row.entity_id===900));
  assert.equal((await request('/api/admin/whitelist/pilot/900',{session:owner.session,method:'DELETE',body:{}})).status,200);
  assert.equal(db.prepare("SELECT count(*) n FROM login_whitelist_entities WHERE kind='pilot'").get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM login_whitelist_entities WHERE kind='alliance'").get().n,1);
  assert.equal((await request('/api/admin/whitelist',{session:owner.session,method:'POST',body:{kind:'invalid',entity_id:123}})).status,400);
 },fakeCat,{eve:{publicGet:async()=>({name:'Verified entry',alliance_id:900})}});
});


test('recruit signup requires consent, preserves normal membership rules and restricts applicant access',async()=>{
 await fixture(async({request,db,identity})=>{
  assert.equal((await request('/Recruit')).status,200);
  assert.equal((await request('/auth/login?recruit=1')).status,400);
  const begin=await request('/auth/login?recruit=1&consent=1'),url=new URL(begin.headers.get('location')),cookie=begin.headers.get('set-cookie').split(';')[0];
  identity({id:900,name:'Applicant',owner:'recruit-owner',scopes:[],expires:Date.now()+3600000});
  const callback=await request('/auth/callback?code=test&state='+url.searchParams.get('state'),{cookie});assert.equal(callback.status,302);assert.equal(callback.headers.get('location'),'/Recruit');
  const sessionCookie=callback.headers.get('set-cookie').split(/,(?= tools_session=)/).find(x=>x.includes('tools_session='));
  const token=/tools_session=([^;]+)/.exec(sessionCookie||callback.headers.get('set-cookie'))[1];
  const me=await (await request('/api/me',{session:token})).json();assert.equal(me.recruit,true);assert.equal(me.admin,false);assert.equal(me.corporation,false);
  assert.equal((await request('/api/characters',{session:token})).status,200);
  for(const path of ['/api/admin/users','/api/corporation/wallet','/api/recruitment'])assert.equal((await request(path,{session:token})).status,403,path);
  assert.equal(db.prepare('SELECT count(*) n FROM recruitment_applications').get().n,1);
 },fakeCat,{membershipLookup:async()=>({corporation_id:999})});
});
test('Recruitment group grants inspect only applicants and all inspection remains read-only',()=>fixture(async({db,user,request})=>{
 const staff=user(200,'Recruiter'),applicant=user(300,'Applicant'),member=user(400,'Member');
 db.prepare('INSERT INTO recruitment_applications(user_id,created,consented) VALUES(?,?,?)').run(applicant.uid,Date.now(),Date.now());
 assert.equal((await request('/api/recruitment',{session:staff.session})).status,403);
 const group=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Recruiters','◇','','auto','[]','[\"recruitment\"]')").run().lastInsertRowid);
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,staff.uid);
 assert.equal((await request('/api/recruitment',{session:staff.session})).status,200);
 assert.equal((await request('/api/inspect',{session:staff.session,method:'POST',body:{user_id:member.uid}})).status,403);
 assert.equal((await request('/api/inspect',{session:staff.session,method:'POST',body:{user_id:applicant.uid},origin:'https://evil.test'})).status,403);
 assert.equal((await request('/api/inspect',{session:staff.session,method:'POST',body:{user_id:applicant.uid}})).status,200);
 const me=await (await request('/api/me',{session:staff.session})).json();assert.equal(me.inspect.name,'Applicant');assert.equal(me.admin,false);
 assert.equal((await request('/api/inspect/pilot-check?character=300',{session:staff.session})).status,200);
 for(const kind of ['pilot-check','pilot-combat']){const result=await request('/api/inspect/'+kind+'?character=all',{session:staff.session});assert.equal(result.status,200);const data=await result.json();assert.deepEqual(data.pilots.map(p=>p.id),[300]);assert.ok(!data.pilots.some(p=>p.id===400));}
 assert.equal((await request('/api/inspect/pilot-check?character=400',{session:staff.session})).status,404);
 assert.equal((await request('/api/characters/300/sync',{session:staff.session,method:'POST',body:{}})).status,403);
 for(const path of ['/api/corporation/wallet','/api/material-planner/corporation','/api/documents','/api/pi/shared'])assert.equal((await request(path,{session:staff.session})).status,403,path);
 assert.equal((await request('/api/inspect',{session:staff.session,method:'POST',body:{exit:true}})).status,200);
 db.prepare('DELETE FROM group_members WHERE group_id=?').run(group);
 assert.equal((await request('/api/inspect',{session:staff.session,method:'POST',body:{user_id:applicant.uid}})).status,403);
}));


test('admins can grant the distinct Recruitment management permission through group configuration',()=>fixture(async({user,request})=>{
 const owner=user(100,'Owner');
 const response=await request('/api/admin/groups',{session:owner.session,method:'POST',body:{name:'Recruiters',icon:'◇',description:'Review recruits',mode:'approval',rules:[],pages:['recruitment']}});assert.equal(response.status,200);
 const groups=await (await request('/api/admin/groups',{session:owner.session})).json();assert.equal(groups.management_pages.recruitment,'Recruitment');assert.ok(groups.groups.some(g=>g.name==='Recruiters'&&g.pages.includes('recruitment')));
}));

 test('recruit mains and alts carry over to normal membership on the same account',async()=>{
 let corporation=999;
 await fixture(async({request,db,identity})=>{
  async function login(id,path,session){
   identity({id,name:'Pilot '+id,owner:'owner-'+id,scopes:[],expires:Date.now()+3600000});
   const begin=await request(path,{session}),state=new URL(begin.headers.get('location')).searchParams.get('state');
   const cookie=begin.headers.get('set-cookie').split(';')[0]+(session?'; tools_session='+session:'');
   const response=await request('/auth/callback?code=test&state='+state,{cookie});
   assert.equal(response.status,302);
   return /tools_session=([^;]+)/.exec(response.headers.get('set-cookie')||'')?.[1]||session;
  }
  let token=await login(900,'/auth/login?recruit=1&consent=1');
  const initial=await (await request('/api/me',{session:token})).json();assert.equal(initial.recruit,true);
  token=await login(901,'/auth/login?link=1&group=main',token);
  token=await login(902,'/auth/login?link=1&group=alt&parent=901',token);
  const before=db.prepare('SELECT id,user_id FROM characters ORDER BY id').all();assert.equal(before.length,3);assert.equal(new Set(before.map(c=>c.user_id)).size,1);
  assert.equal(db.prepare('SELECT parent_id FROM character_groups WHERE character_id=902').get().parent_id,901);
  corporation=668298004;
  token=await login(900,'/auth/login');
  const member=await (await request('/api/me',{session:token})).json();assert.equal(member.recruit,false);assert.equal(member.main_id,900);assert.equal(member.admin,false);
  assert.deepEqual(db.prepare('SELECT id,user_id FROM characters ORDER BY id').all(),before);
  assert.equal(db.prepare('SELECT parent_id FROM character_groups WHERE character_id=902').get().parent_id,901);
  assert.equal((await request('/api/groups',{session:token})).status,200);
 },fakeCat,{membershipLookup:async()=>({corporation_id:corporation})});
});

test('short links normalize domains, reject reserved and duplicate slugs and redirect publicly',()=>fixture(async({user,request})=>{
 const admin=user(100,'Admin'),member=user(200,'Member');
 const save=body=>request('/api/admin/links',{session:admin.session,method:'POST',body});
 assert.equal((await save({name:'Google',url:'google.com',slug:'Google'})).status,200);
 const response=await request('/Google');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://google.com/');
 assert.equal((await request('/google')).status,302);
 assert.equal((await save({name:'Duplicate',url:'https://example.com',slug:'GOOGLE'})).status,400);
 for(const slug of ['api','auth','Recruit','health','bad/path'])assert.equal((await save({name:'Bad',url:'google.com',slug})).status,400);
 assert.equal((await save({name:'Bad',url:'javascript:alert(1)',slug:'bad'})).status,400);
 assert.equal((await request('/api/admin/links',{session:member.session,method:'POST',body:{name:'Bad',url:'google.com',slug:'bad'}})).status,403);
}));
test('admin accounts cannot be inspected, and promotion ends existing inspections',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),a=user(200,'Admin A'),b=user(300,'Admin B');db.prepare('UPDATE users SET admin=1 WHERE id=?').run(a.uid);
 assert.equal((await request('/api/inspect',{session:owner.session,method:'POST',body:{user_id:a.uid}})).status,403);
 assert.equal((await request('/api/inspect',{session:a.session,method:'POST',body:{user_id:b.uid}})).status,200);
 db.prepare('UPDATE users SET admin=1 WHERE id=?').run(b.uid);
 const me=await(await request('/api/me',{session:a.session})).json();assert.equal(me.main_id,200);assert.equal(me.inspect,null);
 assert.equal((await request('/api/inspect',{session:a.session,method:'POST',body:{user_id:b.uid}})).status,403);
}));
test('Discord administration is private, setup cannot be hidden before connecting and mappings validate',()=>fixture(async({user,request})=>{
 const owner=user(100,'Owner'),member=user(200,'Member');
 assert.equal((await request('/api/admin/discord',{session:member.session})).status,403);
 assert.equal((await request('/api/admin/discord/sync-pilots',{session:member.session,method:'POST',body:{}})).status,403);
 assert.equal((await request('/api/admin/discord/sync-pilots',{session:owner.session,method:'POST',body:{}})).status,400);
 assert.equal((await request('/api/admin/discord/hide-guide',{session:owner.session,method:'POST',body:{}})).status,400);
 assert.equal((await request('/api/discord/connect',{session:member.session,method:'POST',body:{},origin:'https://evil.test'})).status,403);
 assert.equal((await request('/api/admin/groups',{session:owner.session,method:'POST',body:{name:'Dreads',icon:'◇',description:'',mode:'auto',rules:[],pages:[],discord_role_id:'123456789012345678'}})).status,200);
 const groups=await(await request('/api/admin/groups',{session:owner.session})).json();assert.equal(groups.groups.find(g=>g.discord_role_id).discord_role_id,'123456789012345678');
 assert.equal((await request('/api/admin/groups',{session:owner.session,method:'POST',body:{name:'Bad',icon:'◇',mode:'auto',rules:[],pages:[],discord_role_id:'not-a-role'}})).status,400);
}));

test('Users whitelist cleanup is owner-only, freshly verified and never treats ESI failure as denial',async()=>{
 let denied=true;
 await fixture(async({db,request,user,usersReview})=>{
 const owner=user(100,'Owner'),target=user(200,'Outside'),admin=user(300,'Admin');db.prepare('UPDATE users SET admin=1 WHERE id=?').run(admin.uid);
 assert.equal((await request('/api/admin/users/whitelist-review',{session:owner.session,method:'POST',body:{}})).status,202);await usersReview.tick();
 const users=await(await request('/api/admin/users',{session:owner.session})).json();assert.equal(users.find(u=>u.id===target.uid).whitelist.status,'denied');assert.equal(users.find(u=>u.id===admin.uid).whitelist.status,'protected');assert.equal(users[0].discord,null);
 const remove=actor=>request('/api/admin/users/'+target.uid+'/whitelist-remove',{session:actor.session,method:'DELETE',body:{confirm_main_id:200}});
 assert.equal((await remove(admin)).status,403);denied=false;assert.equal((await remove(owner)).status,400);assert.ok(db.prepare('SELECT id FROM users WHERE id=?').get(target.uid));denied=true;assert.equal((await remove(owner)).status,200);assert.equal(db.prepare('SELECT id FROM users WHERE id=?').get(target.uid),undefined);
 },fakeCat,{membershipLookup:async id=>({corporation_id:id===200&&denied?999:668298004})});
});

test('custom pages enforce draft and Group visibility on both navigation and direct API access',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),member=user(200,'Member'),outsider=user(300,'Outsider');
 const group=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Readers','◇','','approval','[]','[]')").run().lastInsertRowid);
 db.prepare("INSERT INTO group_members VALUES(?,?,'pending')").run(group,member.uid);
 const draft={name:'FAQ',body:'## Welcome\n**Hello** [Link](https://example.com)',section:'pages',after:'end',position:10,published:false,visibility:'groups',groups:[group]};
 const save=body=>request('/api/admin/pages',{session:admin.session,method:'POST',body});
 assert.equal((await request('/api/admin/pages',{session:member.session})).status,403);assert.equal((await request('/api/admin/pages',{session:member.session,method:'POST',body:draft})).status,403);
 let response=await save(draft);assert.equal(response.status,200);const id=(await response.json()).id;
 assert.equal((await request('/api/pages/'+id,{session:member.session})).status,404);assert.equal((await request('/api/pages/'+id,{session:admin.session})).status,200);
 await save({...draft,id,published:true});assert.equal((await request('/api/pages/'+id,{session:member.session})).status,404);
 db.prepare("UPDATE group_members SET status='approved' WHERE group_id=? AND user_id=?").run(group,member.uid);
 const page=await request('/api/pages/'+id,{session:member.session});assert.equal(page.status,200);assert.match((await page.json()).html,/<h2>Welcome<\/h2>/);
 let me=await(await request('/api/me',{session:member.session})).json();assert.ok(me.pages.some(p=>p.id===id));assert.ok(!('body' in me.pages[0]));
 assert.equal((await request('/api/pages/'+id,{session:outsider.session})).status,404);me=await(await request('/api/me',{session:outsider.session})).json();assert.equal(me.pages.length,0);
 db.prepare('DELETE FROM access_groups WHERE id=?').run(group);assert.equal((await request('/api/pages/'+id,{session:member.session})).status,404);
 assert.equal((await save({...draft,id,published:true,groups:[],visibility:'all',body:'<script>alert(1)</script>'})).status,200);const everyone=await(await request('/api/pages/'+id,{session:outsider.session})).json();assert.doesNotMatch(everyone.html,/<script>/);assert.match(everyone.html,/&lt;script&gt;/);
 assert.equal((await request('/api/pages/'+id)).status,401);
 assert.equal((await request('/api/admin/pages/'+id,{session:admin.session,method:'DELETE',body:{}})).status,200);assert.equal((await request('/api/pages/'+id,{session:member.session})).status,404);
}));
test('custom page placement and content limits validate and inspection cannot edit or read global pages',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),target=user(200,'Target'),body={name:'FAQ',body:'Text',section:'personal',after:'wallet',position:10,published:true,visibility:'all',groups:[]};
 const save=body=>request('/api/admin/pages',{session:admin.session,method:'POST',body});
 for(const b of [{...body,section:'admin'},{...body,after:'admin-users'},{...body,visibility:'groups'},{...body,body:'x'.repeat(12001)}])assert.equal((await save(b)).status,400);
 const id=(await(await save(body)).json()).id;await request('/api/inspect',{session:admin.session,method:'POST',body:{user_id:target.uid}});
 assert.equal((await request('/api/pages/'+id,{session:admin.session})).status,403);assert.equal((await save({...body,id})).status,403);
}));

test('recruits can read all-signed-in pages but cannot inherit restricted Group pages',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'),recruit=user(200,'Recruit');db.prepare('INSERT INTO recruitment_applications(user_id,created,consented) VALUES(?,?,?)').run(recruit.uid,1,1);
 const group=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Old Group','◇','','auto','[]','[]')").run().lastInsertRowid);db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,recruit.uid);
 const base={name:'FAQ',body:'Recruitment help',section:'pages',after:'end',position:1,published:true,visibility:'all',groups:[]},save=body=>request('/api/admin/pages',{session:admin.session,method:'POST',body});
 const all=(await(await save(base)).json()).id,restricted=(await(await save({...base,name:'Private',visibility:'groups',groups:[group]})).json()).id;
 const me=await(await request('/api/me',{session:recruit.session})).json();assert.equal(me.recruit,true);assert.deepEqual(me.pages.map(p=>p.id),[all]);assert.equal((await request('/api/pages/'+all,{session:recruit.session})).status,200);assert.equal((await request('/api/pages/'+restricted,{session:recruit.session})).status,404);
 },fakeCat,{membershipLookup:async id=>({corporation_id:id===200?999:668298004})}));

test('Search Pilots finds custom ship names, nested module locations and enforces its own permission',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),pilot=user(200,'Pilot'),viewer=user(300,'Viewer'),protectedAdmin=user(400,'Protected Admin');db.prepare('UPDATE users SET admin=1 WHERE id=?').run(protectedAdmin.uid);
 const save=(id,items)=>db.prepare("INSERT INTO snapshots VALUES(?,'assets',?,?,?,NULL)").run(id,JSON.stringify({items,locations:{6001:'Jita Station'},names_status:'complete',names_checked:Date.now()}),Date.now(),Date.now()+10000);
 const ship={item_id:9001,type_id:1,custom_name:'AIR',is_singleton:true,quantity:1,root_location_id:6001,location_id:6001},module={item_id:9002,type_id:2,quantity:1,root_location_id:6001,location_id:9001};
 save(200,[ship,module]);save(400,[{...ship,item_id:9004}]);save(100,[{...ship,item_id:9005}]);
 let response=await request('/api/corporation/pilot-assets?type=Gnosis&name=AIR&exact=1',{session:owner.session});assert.equal(response.status,200);let data=await response.json();assert.equal(data.total,2);assert.deepEqual(data.rows.map(r=>r.character).sort(),['Owner','Pilot']);assert.equal(data.protected_pilots,1);assert.ok(data.rows.every(r=>r.type==='Gnosis'&&r.name==='AIR'));
 assert.equal((await request('/api/corporation/pilot-assets?q=AIR',{session:viewer.session})).status,403);
 const group=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Searchers','◇','','auto','[]','[\"corp-search-pilots\"]')").run().lastInsertRowid);db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,viewer.uid);
 response=await request('/api/corporation/pilot-assets?category=modules&location=AIR',{session:viewer.session});assert.equal(response.status,200);data=await response.json();assert.equal(data.total,1);assert.equal(data.rows[0].character,'Pilot');assert.equal(data.rows[0].container,'AIR');assert.equal(data.rows[0].location,'Jita Station');assert.equal(data.rows[0].type,'Damage Control II');
 assert.equal((await request('/api/corporation/assets',{session:viewer.session})).status,403);
 db.prepare('DELETE FROM group_members WHERE group_id=?').run(group);assert.equal((await request('/api/corporation/pilot-assets?q=AIR',{session:viewer.session})).status,403);
 await request('/api/inspect',{session:owner.session,method:'POST',body:{user_id:pilot.uid}});assert.equal((await request('/api/corporation/pilot-assets?q=AIR',{session:owner.session})).status,403);
},{...fakeCat,type:id=>({id,name:id===1?'Gnosis':'Damage Control II',category_id:id===1?6:7})}));

test('document library keeps private documents and pilot evidence account scoped, creates private minimum plans and hides revoked links',()=>fixture(async({db,user,request})=>{
 const a=user(100,'Main'),b=user(200,'Other'),insert=db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)');
 insert.run('library-fit',a.uid,'fitting','Fleet Fit',JSON.stringify('[Test ship, Test]'),1,1);
 insert.run('library-secret',b.uid,'plan','Secret',JSON.stringify([{id:1,level:5}]),0,1);
 const get=async(path,session=a.session)=>await(await request(path,{session})).json();
 assert.equal((await get('/api/document-library')).some(d=>d.id==='library-secret'),false);
 assert.equal((await request('/api/document-library?pilot=200',{session:a.session})).status,404);
 assert.equal((await request('/api/documents/library-secret/create-plan',{session:a.session,method:'POST',body:{}})).status,404);
 const created=await request('/api/documents/library-fit/create-plan',{session:a.session,method:'POST',body:{}});assert.equal(created.status,200);const {id}=await created.json();
 const plan=await get('/api/documents/'+id);assert.equal(plan.owner,a.uid);assert.equal(plan.shared,0);assert.equal(plan.body.find(r=>r.id===1).level,3);assert.equal(plan.linkedFittings[0].id,'library-fit');
 assert.equal((await request('/api/documents/'+id,{session:b.session})).status,404);
 let fit=await get('/api/documents/library-fit');assert.equal(fit.linkedPlan,id);assert.equal(fit.readiness[0].ready,null);
 await request('/api/documents/'+id,{session:a.session,method:'PATCH',body:{shared:true}});
 assert.equal((await request('/api/documents/library-fit/plan',{session:b.session,method:'POST',body:{plan:id}})).status,200);
 await request('/api/documents/'+id,{session:a.session,method:'PATCH',body:{shared:false}});
 fit=await get('/api/documents/library-fit',b.session);assert.equal(fit.linkedPlan,null);
 assert.equal((await get('/api/document-library',b.session)).find(d=>d.id==='library-fit').linkedPlan,null);
 db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(100,'skills',JSON.stringify({skills:{skills:[{skill_id:1,active_skill_level:2,trained_skill_level:3,skillpoints_in_skill:8000}]},attributes:{intelligence:20,memory:20},queue:[{skill_id:1,finished_level:4}]}),Date.now(),0);
 const evidence=(await get('/api/document-library?pilot=100')).find(d=>d.id==='library-fit').readiness;assert.equal(evidence.state,'inactive');assert.equal(evidence.total,1);assert.equal(evidence.rows,undefined);
 const detail=await get('/api/documents/library-fit');assert.equal(detail.readiness[0].rows[0].source,'Fitting minimum');assert.equal(detail.readiness[0].rows[0].queued,true);
}, {...fakeCat,named:()=>99,type:id=>id===99?{id:99,name:'Test ship',category_id:6,attributes:{182:1,277:3}}:fakeCat.type(id)}));

test('Links stay hidden from recruits and recruit inspection while members retain access',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),member=user(200,'Member'),recruit=user(300,'Recruit');
 for(const account of [member,recruit])db.prepare('INSERT INTO recruitment_applications(user_id,created,consented) VALUES(?,?,?)').run(account.uid,Date.now(),Date.now());
 db.prepare('INSERT INTO external_links(name,description,url,slug) VALUES(?,?,?,?)').run('Member Link','Member resources','https://example.com/','MemberLink');
 const me=async session=>(await request('/api/me',{session})).json();
 assert.equal((await me(recruit.session)).recruit,true);assert.deepEqual((await me(recruit.session)).links,[]);
 assert.equal((await request('/api/links',{session:recruit.session})).status,403);assert.equal((await request('/MemberLink',{session:recruit.session})).status,403);
 assert.equal((await me(member.session)).recruit,false);assert.equal((await me(member.session)).links.length,1);assert.equal((await request('/api/links',{session:member.session})).status,200);assert.equal((await request('/MemberLink',{session:member.session})).status,302);
 assert.equal((await request('/MemberLink')).status,302,'existing public short links retain their public redirect');
 assert.equal((await request('/api/inspect',{session:owner.session,method:'POST',body:{user_id:recruit.uid}})).status,200);
 assert.deepEqual((await me(owner.session)).links,[]);assert.equal((await request('/api/links',{session:owner.session})).status,403);assert.equal((await request('/MemberLink',{session:owner.session})).status,403);
 assert.equal((await request('/api/inspect',{session:owner.session,method:'POST',body:{exit:true}})).status,200);assert.equal((await me(owner.session)).links.length,1);
},fakeCat,{membershipLookup:async id=>({corporation_id:id===300?999:668298004})}));

test('a recruit becomes a full member without logging out, loses the recruit flag and delegated recruit inspection, and retains all account data',async()=>{
 let eligible=false,outage=false;
 await fixture(async({db,user,request,recruitMembership})=>{
  const owner=user(100,'Owner'),staff=user(200,'Recruiter'),applicant=user(300,'Applicant');
  db.prepare("INSERT INTO recruitment_applications(user_id,status,created,consented,notes) VALUES(?,'accepted',1,2,'Keep these notes')").run(applicant.uid);
  db.prepare("INSERT INTO characters VALUES(301,?,'Alt','alt-owner','unused','[]',0,0)").run(applicant.uid);db.prepare('INSERT INTO character_groups VALUES(301,300)').run();
  db.prepare('INSERT INTO external_links(name,description,url,slug) VALUES(?,?,?,?)').run('Member portal','Members','https://example.com/','Portal');
  const group=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Recruiters','◇','','auto','[]','[\"recruitment\"]')").run().lastInsertRowid);db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,staff.uid);
  const me=async session=>(await request('/api/me',{session})).json();assert.equal((await me(applicant.session)).recruit,true);assert.equal((await request('/api/links',{session:applicant.session})).status,403);
  assert.equal((await request('/api/inspect',{session:staff.session,method:'POST',body:{user_id:applicant.uid}})).status,200);
  outage=true;await recruitMembership.tick();assert.equal(db.prepare('SELECT status FROM recruitment_applications WHERE user_id=?').get(applicant.uid).status,'accepted');outage=false;
  eligible=true;
  // The background checker waits between failed checks; move its clock forward instead of bypassing verification.
  const future=Date.now()+300001,original=Date.now;Date.now=()=>future;try{await recruitMembership.tick();}finally{Date.now=original;}
  const member=await me(applicant.session);assert.equal(member.recruit,false);assert.equal(member.admin,false);assert.equal(member.owner,false);assert.equal(member.links.length,1);
  assert.equal((await request('/api/documents',{session:applicant.session})).status,200);assert.equal((await request('/api/admin/users',{session:applicant.session})).status,403);
  const app=db.prepare('SELECT * FROM recruitment_applications WHERE user_id=?').get(applicant.uid);assert.equal(app.status,'joined');assert(app.joined_at>0);assert.equal(app.notes,'Keep these notes');assert.equal(db.prepare('SELECT COUNT(*) n FROM characters WHERE user_id=?').get(applicant.uid).n,2);assert.equal(db.prepare('SELECT parent_id FROM character_groups WHERE character_id=301').get().parent_id,300);
  const users=await(await request('/api/admin/users',{session:owner.session})).json();assert.equal(users.find(u=>u.id===applicant.uid).recruit,false);
  assert.equal((await request('/api/inspect/pilot-check?character=300',{session:staff.session})).status,403);assert.equal((await request('/api/inspect',{session:staff.session,method:'POST',body:{user_id:applicant.uid}})).status,403);
  assert.equal((await request('/api/recruitment/'+applicant.uid,{session:staff.session,method:'POST',body:{status:'reviewing',notes:'Reopen'}})).status,409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_members WHERE user_id=?").get(applicant.uid).n,0);
 },fakeCat,{membershipLookup:async id=>{if(id===300&&outage)throw Error('ESI unavailable');return {corporation_id:id===300&&!eligible?999:668298004};}});
});

test('members using recruit signup go straight to normal access without a new application',()=>fixture(async({request,db,identity})=>{
 async function login(){
  identity({id:900,name:'Member',owner:'member-owner',scopes:[],expires:Date.now()+3600000});
  const begin=await request('/auth/login?recruit=1&consent=1'),state=new URL(begin.headers.get('location')).searchParams.get('state'),cookie=begin.headers.get('set-cookie').split(';')[0];
  const result=await request('/auth/callback?code=test&state='+state,{cookie});assert.equal(result.status,302);assert.equal(result.headers.get('location'),'/');
  return /tools_session=([^;]+)/.exec(result.headers.get('set-cookie'))[1];
 }
 let token=await login();assert.equal(db.prepare('SELECT COUNT(*) n FROM recruitment_applications').get().n,0);
 const uid=db.prepare('SELECT id FROM users WHERE main_id=900').get().id;
 db.prepare("INSERT INTO recruitment_applications(user_id,status,created,consented,notes) VALUES(?,'reviewing',1,2,'Keep history')").run(uid);
 token=await login();const application=db.prepare('SELECT * FROM recruitment_applications WHERE user_id=?').get(uid);assert.equal(application.status,'joined');assert(application.joined_at>0);assert.equal(application.notes,'Keep history');
 const me=await(await request('/api/me',{session:token})).json();assert.equal(me.recruit,false);assert.equal(me.admin,false);assert.equal((await request('/api/groups',{session:token})).status,200);assert.equal((await request('/api/admin/users',{session:token})).status,403);
}));

test('real membership lookup uses affiliation rather than a stale character profile for recruit promotion',async()=>{
 let mode='wrong-pilot';const calls=[];
 await fixture(async({user,db,request})=>{
  const recruit=user(300,'New corp member');db.prepare("INSERT INTO recruitment_applications(user_id,created,consented) VALUES(?,1,2)").run(recruit.uid);
  let response=await request('/api/me',{session:recruit.session});assert.equal(response.status,503);assert.equal(db.prepare('SELECT status FROM recruitment_applications WHERE user_id=?').get(recruit.uid).status,'applied');
  mode='joined';response=await request('/api/me',{session:recruit.session});assert.equal(response.status,200);const me=await response.json();assert.equal(me.recruit,false);assert.equal(me.admin,false);assert.equal(db.prepare('SELECT status FROM recruitment_applications WHERE user_id=?').get(recruit.uid).status,'joined');assert.equal((await request('/api/groups',{session:recruit.session})).status,200);assert.equal((await request('/api/admin/users',{session:recruit.session})).status,403);
  assert(calls.length>=2);assert(calls.every(call=>call.path==='/characters/affiliation'&&call.method==='POST'&&call.character===null));
 },fakeCat,{membershipLookup:undefined,eve:{request:async(path,character,method,ids)=>{calls.push({path,character,method});assert.deepEqual(ids,[300]);if(path==='/characters/affiliation')return {data:[{character_id:mode==='wrong-pilot'?999:300,corporation_id:668298004}]};return {data:{corporation_id:1000169}};},publicGet:async()=>({})}});
});

test('individual pilot whitelist entries are cleaned on verified membership, rejection and pilot/account deletion',async t=>{
 let joined=false;
 await fixture(async({db,user,request,recruitMembership})=>{
  const owner=user(100,'Owner'),applicant=user(300,'Applicant'),oldMember=user(400,'Already joined'),unrelated=user(500,'Unrelated exception'),rejected=user(600,'Rejected'),oldRejected=user(700,'Previously rejected');
  db.prepare('UPDATE sessions SET expires=?').run(Date.now()+10000000);
  const add=id=>db.prepare("INSERT INTO login_whitelist_entities VALUES('pilot',?,'Temporary pilot')").run(id),has=id=>Boolean(db.prepare("SELECT 1 FROM login_whitelist_entities WHERE kind='pilot' AND entity_id=?").get(id));
  for(const id of [300,400,500,600,700])add(id);
  for(const [account,status] of [[applicant,'applied'],[oldMember,'joined'],[rejected,'applied'],[oldRejected,'rejected']])db.prepare('INSERT INTO recruitment_applications(user_id,status,created,consented) VALUES(?,?,1,2)').run(account.uid,status);
  const corporations=db.prepare('SELECT * FROM login_whitelist').all();db.prepare("INSERT INTO login_whitelist_entities VALUES('alliance',12345,'Unrelated alliance')").run();
  assert.equal((await request('/api/me',{session:applicant.session})).status,200);assert.equal(db.prepare('SELECT status FROM recruitment_applications WHERE user_id=?').get(applicant.uid).status,'applied','a pilot exception alone must not prove corp membership');
  await recruitMembership.tick();assert(has(300));assert(!has(400),'clean up existing joined applications too');assert(!has(700));assert(has(500));
  joined=true;const future=Date.now()+300001;t.mock.method(Date,'now',()=>future);await recruitMembership.tick();assert(!has(300));assert.equal(db.prepare('SELECT status FROM recruitment_applications WHERE user_id=?').get(applicant.uid).status,'joined');const me=await(await request('/api/me',{session:applicant.session})).json();assert.equal(me.recruit,false);assert.equal(me.admin,false);
  assert.equal((await request('/api/recruitment/'+rejected.uid,{session:owner.session,method:'POST',body:{status:'rejected',notes:'Application rejected'}})).status,200);assert(!has(600));assert(db.prepare('SELECT 1 FROM users WHERE id=?').get(rejected.uid));assert.equal((await request('/api/me',{session:rejected.session})).status,403);
  db.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)').run(301,applicant.uid,'Alt','alt-owner','sealed','[]',Date.now()+60000);add(301);assert.equal((await request('/api/characters/301',{session:applicant.session,method:'DELETE',body:{}})).status,200);assert(!has(301));assert(has(500));
  db.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)').run(501,unrelated.uid,'Other alt','other-owner','sealed','[]',Date.now()+60000);add(501);assert.equal((await request('/api/admin/users/'+unrelated.uid,{session:owner.session,method:'DELETE',body:{confirm_main_id:500}})).status,200);assert(!has(500));assert(!has(501));
  assert.deepEqual(db.prepare('SELECT * FROM login_whitelist').all(),corporations);assert(db.prepare("SELECT 1 FROM login_whitelist_entities WHERE kind='alliance' AND entity_id=12345").get());
 },fakeCat,{membershipLookup:async id=>({corporation_id:id===600||id===700||(id===300&&!joined)?999:668298004,alliance_id:23456})});
});

test('recruits see and apply only to opted-in groups without acquiring corporation or staff access',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),recruit=user(300,'Applicant'),member=user(400,'Member'),other=user(500,'Other applicant');
 for(const account of [recruit,other])db.prepare('INSERT INTO recruitment_applications(user_id,created,consented) VALUES(?,1,2)').run(account.uid);
 const save=body=>request('/api/admin/groups',{session:owner.session,method:'POST',body}),base={icon:'◇',description:'Group description',mode:'auto',rules:[],pages:[]};
 assert.equal((await save({...base,name:'Main group'})).status,200);
 assert.equal((await save({...base,name:'Recruit group',recruit_visible:true,pages:['recruitment','corp-wallet']})).status,200);
 assert.equal((await save({...base,name:'Approval recruit group',recruit_visible:true,mode:'approval'})).status,200);
 assert.equal((await save({...base,name:'Bad visibility',recruit_visible:'true'})).status,400);
 const groups=db.prepare('SELECT * FROM access_groups WHERE id NOT IN (SELECT group_id FROM contributor_groups) ORDER BY id').all(),[hidden,visible,approval]=groups;
 assert.equal(hidden.recruit_visible,0);assert.equal(visible.recruit_visible,1);
 const list=async session=>{const response=await request('/api/groups',{session});assert.equal(response.status,200);return response.json();};
 assert.deepEqual((await list(recruit.session)).map(g=>g.name),['Approval recruit group','Recruit group']);assert.equal((await list(member.session)).length,4);
 assert.equal((await request('/api/groups/'+hidden.id+'/apply',{session:recruit.session,method:'POST',body:{}})).status,404);
 assert.equal((await request('/api/groups/'+visible.id+'/apply',{session:recruit.session,method:'POST',body:{}})).status,200);
 assert.equal((await request('/api/groups/'+approval.id+'/apply',{session:recruit.session,method:'POST',body:{}})).status,200);
 assert.equal(db.prepare('SELECT status FROM group_members WHERE group_id=? AND user_id=?').get(visible.id,recruit.uid).status,'approved');assert.equal(db.prepare('SELECT status FROM group_members WHERE group_id=? AND user_id=?').get(approval.id,recruit.uid).status,'pending');
 const me=await(await request('/api/me',{session:recruit.session})).json();assert.equal(me.recruit,true);assert.equal(me.recruiter,false);assert.equal(me.corporation,false);assert.deepEqual(me.corporate_pages,[]);
 for(const path of ['/api/admin/groups','/api/recruitment','/api/corporation/wallet'])assert.equal((await request(path,{session:recruit.session})).status,403,path);
 assert.equal((await request('/api/inspect',{session:recruit.session,method:'POST',body:{user_id:other.uid}})).status,403);
 assert.equal((await save({...base,id:visible.id,name:'Recruit group',recruit_visible:false})).status,200);
 assert.deepEqual((await list(recruit.session)).map(g=>g.name),['Approval recruit group']);assert.equal((await request('/api/groups/'+visible.id+'/apply',{session:recruit.session,method:'POST',body:{}})).status,404);
 assert.equal((await request('/api/inspect',{session:owner.session,method:'POST',body:{user_id:recruit.uid}})).status,200);assert.deepEqual((await list(owner.session)).map(g=>g.name),['Approval recruit group']);assert.equal((await request('/api/groups/'+approval.id+'/apply',{session:owner.session,method:'POST',body:{}})).status,403);
},fakeCat,{membershipLookup:async id=>({corporation_id:[300,500].includes(id)?999:668298004})}));

test('Auto Enrol is admin configured, verifies the edition corporation, grants without applying and cannot bypass manual rejection',()=>fixture(async({db,user,request,groupEnrolment})=>{
 const owner=user(100,'Owner'),member=user(200,'Silent Uk'),outsider=user(300,'Other Pilot');
 db.prepare("INSERT INTO login_whitelist_entities(kind,entity_id,name) VALUES('pilot',300,'Other Pilot')").run();
 const body={name:'Corp Members',description:'Confirmed corp members',icon:'◇',mode:'auto-enrol',rules:[{kind:'corporation',id:123}],pages:['corp-moons']};
 assert.equal((await request('/api/admin/groups',{session:member.session,method:'POST',body})).status,403);
 assert.equal((await request('/api/admin/groups',{session:owner.session,method:'POST',body:{...body,rules:[]}})).status,400);
 assert.equal((await request('/api/admin/groups',{session:owner.session,method:'POST',body})).status,200);
 const group=db.prepare('SELECT * FROM access_groups WHERE id NOT IN (SELECT group_id FROM contributor_groups)').get();assert.equal(JSON.parse(group.rules)[0].id,668298004);assert.equal(JSON.parse(group.rules)[0].name,'Member of STEMP');
 await groupEnrolment.check(member.uid);const me=await(await request('/api/me',{session:member.session})).json();assert.ok(me.corporate_pages.includes('corp-moons'));assert.equal(db.prepare('SELECT status FROM group_members WHERE group_id=? AND user_id=?').get(group.id,member.uid).status,'approved');
 await request('/api/me',{session:outsider.session});assert.equal(db.prepare('SELECT status FROM group_members WHERE group_id=? AND user_id=?').get(group.id,outsider.uid),undefined);
 assert.equal((await request('/api/admin/groups/'+group.id+'/member',{session:owner.session,method:'POST',body:{user_id:member.uid,status:'rejected'}})).status,200);
 assert.equal((await request('/api/groups/'+group.id+'/apply',{session:member.session,method:'POST',body:{}})).status,403);
 assert.ok(!(await(await request('/api/me',{session:member.session})).json()).corporate_pages.includes('corp-moons'));
 const list=await(await request('/api/admin/groups',{session:owner.session})).json();assert.ok(list.requests.some(r=>r.name==='Silent Uk'&&JSON.parse(r.pilot_names).includes('Silent Uk')));
 assert.equal((await request('/api/admin/groups/'+group.id+'/member',{session:owner.session,method:'POST',body:{user_id:member.uid,status:'approved'}})).status,200);
 assert.ok((await(await request('/api/me',{session:member.session})).json()).corporate_pages.includes('corp-moons'));
},fakeCat,{membershipLookup:async id=>({corporation_id:id===300?999:668298004})}));

test('sidebar switches cover personal, corporate, Links and only accessible custom pages without changing access or sync',()=>fixture(async({db,user,request})=>{
 const a=user(200,'Display owner'),b=user(300,'Other');
 db.prepare("INSERT INTO site_pages VALUES(1,'FAQ','Visible text','pages','end',1,1,'all',1)").run();
 db.prepare("INSERT INTO site_pages VALUES(2,'Private page','Private text','pages','end',2,1,'groups',1)").run();
 db.prepare("INSERT INTO access_groups(id,name,icon,description,mode,rules,pages) VALUES(1001,'Roster readers','◇','','auto','[]','[\"corp-members\",\"corp-pilots\"]')").run();db.prepare("INSERT INTO group_members VALUES(1001,?,'approved')").run(a.uid);
 const available=await(await request('/api/settings',{session:a.session})).json();assert.deepEqual(available.display_pages,['clones','wallet','contracts','plans','fittings']);assert.deepEqual(available.custom_pages.map(p=>p.id),[1]);assert.deepEqual(Object.keys(available.corporate_pages),['corp-members','corp-pilots','corp-projects']);
 const changes={clones:false,wallet:false,contracts:false,plans:false,fittings:false,'corp-members':false,'corp-pilots':false,'links-section':false,'page-1':false};
 assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:changes})).status,200);
 const me=await(await request('/api/me',{session:a.session})).json();for(const [key,value] of Object.entries(changes))assert.equal(me.preferences[key],value);assert.ok(me.corporate_pages.includes('corp-members'));assert.ok(me.pages.some(p=>p.id===1));
 assert.equal((await request('/api/pages/1',{session:a.session})).status,200);assert.equal((await request('/api/links',{session:a.session})).status,200);
 for(const body of [{'page-2':false},{'page-9999':false},{'links-section':'off'}])assert.equal((await request('/api/settings',{session:a.session,method:'POST',body})).status,400);
 const other=await(await request('/api/settings',{session:b.session})).json();assert.deepEqual(other.preferences,{});
 const {syncEnabled}=await import('../lib/management.mjs');for(const kind of ['wallet','wallet-history','clones','contracts','skills','assets'])assert.equal(syncEnabled(db,a.uid,kind),true);
 assert.equal((await request('/api/settings',{session:a.session,method:'POST',body:{'page-1':true,'links-section':true}})).status,200);
}));

test('existing sessions survive repeated ESI membership failures and restart, then reset after recovery',async t=>{
 const {whitelistService}=await import('../lib/whitelist.mjs'),dir=mkdtempSync(join(tmpdir(),'whitelist-grace-')),db=openStore(dir);let now=1000000,calls=0,fail=false,corporation=668298004;
 t.mock.method(Date,'now',()=>now);const lookup=async()=>{calls++;if(fail)throw Error('ESI downtime');return {corporation_id:corporation};};let service=whitelistService(db,lookup);const check=()=>service.check(100,false,{allowGrace:true});
 try{
  assert.equal(await check(),668298004);now+=300001;fail=true;
  assert.deepEqual(await Promise.all([check(),check(),check()]),[null,null,null]);assert.equal(calls,2);assert.equal(db.prepare('SELECT failures FROM login_membership_checks').get().failures,1);
  for(let n=0;n<3;n++)assert.equal(await check(),null);assert.equal(calls,2);
  service=whitelistService(db,lookup);assert.equal(await check(),null);assert.equal(calls,2);
  await assert.rejects(service.check(100,true),e=>e.status===503);await assert.rejects(service.check(100,true,{membershipOnly:true,allowGrace:true}),e=>e.status===503);
  now+=1200001;assert.equal(await check(),null);assert.equal(db.prepare('SELECT failures FROM login_membership_checks').get().failures,2);assert.equal(db.prepare('SELECT retry_at FROM login_membership_checks').get().retry_at,now+1200000);const secondCalls=calls;assert.equal(await check(),null);assert.equal(calls,secondCalls);
  now+=1200001;fail=false;assert.equal(await check(),668298004);assert.equal(db.prepare('SELECT failures FROM login_membership_checks').get().failures,0);
  now+=300001;fail=true;assert.equal(await check(),null);
  now+=1200001;fail=false;corporation=999;await assert.rejects(check(),e=>e.status===403);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('membership outage access requires previous verification and still honours removed whitelist rules',async t=>{
 const {whitelistService}=await import('../lib/whitelist.mjs'),dir=mkdtempSync(join(tmpdir(),'whitelist-grace-bounds-')),db=openStore(dir);let now=1000000,fail=false;t.mock.method(Date,'now',()=>now);
 const lookup=async()=>{if(fail)throw Error('offline');return {corporation_id:668298004};},service=whitelistService(db,lookup);
 try{
  await service.check(100);now+=7*86400000;fail=true;assert.equal(await service.check(100,false,{allowGrace:true}),null);
  await assert.rejects(service.check(200,false,{allowGrace:true}),e=>e.status===503);
  fail=false;await service.check(300);db.prepare('DELETE FROM login_whitelist WHERE corporation_id=?').run(668298004);now+=300001;fail=true;await assert.rejects(service.check(300,false,{allowGrace:true}),e=>e.status===503);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('membership downtime keeps existing sessions usable through repeated failures without promoting recruits on stale proof',async t=>{
 let now=Date.now(),failed=false;t.mock.method(Date,'now',()=>now);
 await fixture(async({db,user,request})=>{
  const a=user(200,'Verified member');db.prepare('UPDATE sessions SET expires=? WHERE user_id=?').run(now+86400000,a.uid);assert.equal((await request('/api/me',{session:a.session})).status,200);
  db.prepare('INSERT INTO recruitment_applications(user_id,created,consented) VALUES(?,1,2)').run(a.uid);
  now+=90*60000;failed=true;for(let i=0;i<3;i++)assert.equal((await request('/api/me',{session:a.session})).status,200);
  assert.equal(db.prepare('SELECT status FROM recruitment_applications WHERE user_id=?').get(a.uid).status,'applied');
  now+=19*60000;assert.equal((await request('/api/me',{session:a.session})).status,200);
  now+=60001;assert.equal((await request('/api/me',{session:a.session})).status,200);now+=3*3600000;assert.equal((await request('/api/me',{session:a.session})).status,200);assert.ok(db.prepare('SELECT 1 FROM sessions WHERE user_id=?').get(a.uid));
 },fakeCat,{membershipLookup:async()=>{if(failed)throw Error('ESI downtime');return {corporation_id:668298004};}});
});

test('admins manually add registered accounts to hidden groups while self-service discovery and applications stay blocked',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),member=user(200,'Member'),recruit=user(300,'Recruit');db.prepare('INSERT INTO recruitment_applications(user_id,created,consented) VALUES(?,1,2)').run(recruit.uid);
 const body={name:'Private Staff',icon:'◇',description:'Admin-managed group',mode:'approval',rules:[],pages:['corp-moons'],hidden:true,recruit_visible:true},save=b=>request('/api/admin/groups',{session:owner.session,method:'POST',body:b});
 assert.equal((await save({...body,hidden:'yes'})).status,400);assert.equal((await save(body)).status,200);const group=db.prepare('SELECT * FROM access_groups WHERE id NOT IN (SELECT group_id FROM contributor_groups)').get();assert.equal(group.is_hidden,1);
 for(const session of [member.session,recruit.session]){assert.deepEqual((await(await request('/api/groups',{session})).json()).filter(g=>g.name!=='Calendar Organisers'),[]);assert.equal((await request('/api/groups/'+group.id+'/apply',{session,method:'POST',body:{}})).status,404);assert.equal((await request('/api/admin/groups/'+group.id+'/member',{session,method:'POST',body:{user_id:member.uid,status:'approved'}})).status,403);}
 const admin=await(await request('/api/admin/groups',{session:owner.session})).json();assert.equal(admin.groups.some(g=>g.hidden),true);assert.ok(admin.users.some(u=>u.id===member.uid));
 const add=(uid,status='approved')=>request('/api/admin/groups/'+group.id+'/member',{session:owner.session,method:'POST',body:{user_id:uid,status}});
 assert.equal((await add(member.uid)).status,200);assert.equal((await add(member.uid)).status,200);assert.equal(db.prepare('SELECT count(*) n FROM group_members WHERE group_id=? AND user_id=?').get(group.id,member.uid).n,1);
 assert.deepEqual((await(await request('/api/groups',{session:member.session})).json()).filter(g=>g.name!=='Calendar Organisers'),[]);assert.ok((await(await request('/api/me',{session:member.session})).json()).corporate_pages.includes('corp-moons'));
 assert.equal((await add(999999)).status,404);assert.equal((await add(String(member.uid))).status,400);
 const {hidden,...legacy}=body;assert.equal((await save({...legacy,id:group.id})).status,200);assert.equal(db.prepare('SELECT is_hidden FROM access_groups WHERE id=?').get(group.id).is_hidden,1);
 assert.equal((await add(member.uid,'rejected')).status,200);assert.ok(!(await(await request('/api/me',{session:member.session})).json()).corporate_pages.includes('corp-moons'));
 assert.equal((await save({...body,id:group.id,hidden:false})).status,200);assert.ok((await(await request('/api/groups',{session:member.session})).json()).some(g=>g.id===group.id));
 assert.equal((await save({...body,id:group.id,mode:'restricted',rules:[{kind:'skill',id:1,level:5}]})).status,200);assert.equal((await add(member.uid)).status,400);assert.equal(db.prepare('SELECT status FROM group_members WHERE group_id=? AND user_id=?').get(group.id,member.uid).status,'rejected');
},fakeCat,{membershipLookup:async id=>({corporation_id:id===300?999:668298004})}));

let releaseAffiliation;const slowAffiliation=new Promise(resolve=>{releaseAffiliation=resolve;});

test('a stalled alt affiliation lookup cannot hold the workspace or grant unverified automatic access',()=>fixture(async({db,user,request,groupEnrolment})=>{
 const a=user(200,'Workspace member');assert.equal((await request('/api/me',{session:a.session})).status,200);
 db.prepare("INSERT INTO characters SELECT 201,user_id,'Slow alt',owner_hash,tokens,scopes,expires,reconnect FROM characters WHERE id=200").run();
 db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Corp Members','◇','','auto-enrol',?,'[\"corp-moons\"]')").run(JSON.stringify([{kind:'corporation',id:668298004}]));
 let timer;try{
  const response=await Promise.race([request('/api/me',{session:a.session}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1000);})]);assert.ok(response,'Workspace must not wait for alt verification');assert.equal(response.status,200);assert.ok(!(await response.json()).corporate_pages.includes('corp-moons'));
 }finally{clearTimeout(timer);releaseAffiliation({corporation_id:668298004});await groupEnrolment.check(a.uid);}
 assert.ok((await(await request('/api/me',{session:a.session})).json()).corporate_pages.includes('corp-moons'));
},fakeCat,{membershipLookup:async id=>id===201?slowAffiliation:{corporation_id:668298004}}));

test('admin workspace navigation does not wait for unrelated director verification',()=>fixture(async({user,request,corp})=>{
 const owner=user(100,'Owner');let calls=0;corp.access=async()=>{calls++;return false;};const response=await request('/api/me',{session:owner.session});assert.equal(response.status,200);const me=await response.json();assert.equal(me.admin,true);assert.ok(me.corporate_pages.includes('corp-moons'));assert.equal(calls,0);
}));


test('slow ESI verification stops blocking existing sessions but persists confirmed removal when it completes',async()=>{
 const {whitelistService}=await import('../lib/whitelist.mjs'),dir=mkdtempSync(join(tmpdir(),'whitelist-slow-')),db=openStore(dir);let release,slow=false;
 const service=whitelistService(db,async()=>slow?await new Promise(resolve=>{release=resolve;}):{corporation_id:668298004});
 try{
  await service.check(100);service.invalidate();slow=true;
  assert.equal(await service.check(100,false,{allowGrace:true}),null);
  assert.equal(db.prepare('SELECT corporation_id FROM login_membership_checks WHERE character_id=100').get().corporation_id,668298004);
  release({corporation_id:999});await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(service.check(100,false,{allowGrace:true}),e=>e.status===403);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});


test('character refresh metadata marks paused syncs and hides only their errors',()=>fixture(async({db,user,request})=>{
 const a=user(200,'Member');db.prepare('INSERT INTO page_preferences VALUES(?,?)').run(a.uid,JSON.stringify({dens:false,standings:false,market:false,pi:false,industry:false,blueprints:true}));
 for(const kind of ['dens','standings','market','pi','industry','skills']){db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(200,kind,'{}',1,2);db.prepare('INSERT INTO sync_errors VALUES(?,?,?)').run(200,kind,'HTTP 503');}
 const rows=await(await request('/api/characters',{session:a.session})).json(),c=rows.find(c=>c.id===200);
 assert.equal(c.snapshots.find(s=>s.kind==='dens').sync_enabled,false);assert.equal(c.snapshots.find(s=>s.kind==='pi').sync_enabled,false);assert.equal(c.snapshots.find(s=>s.kind==='industry').sync_enabled,true);assert.equal(c.snapshots.find(s=>s.kind==='skills').sync_enabled,true);
 assert.deepEqual(c.errors.map(e=>e.kind).sort(),['industry','skills']);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_errors WHERE character_id=200').get().n,6);
}));


test('standard large tower rates are available without sovereignty data and saved stock yields a timer immediately',()=>fixture(async({db,user,request})=>{
 const {structureRate}=await import('../lib/corp-fuel.mjs'),{fuelDeadlines}=await import('../public/structure-timers.mjs'),owner=user(100,'Owner'),tower={id:999,kind:'POS',type_name:'Minmatar Control Tower',name:'Example tower',state:'online',fuel:16200,inventory_at:Date.now(),rate:30};
 assert.equal(structureRate(tower,[],()=>null,null),40);assert.equal(structureRate(tower,[],()=>null,false),40);assert.equal(structureRate(tower,[],()=>null,true),40);for(const [suffix,rate] of [['',40],[' Medium',20],[' Small',10]])
  for(const sovereignty of [true,false,null])
   assert.equal(structureRate({...tower,type_name:'Caldari Control Tower'+suffix},[],()=>null,sovereignty),rate);
 assert.equal(structureRate({...tower,state:'offline'},[],()=>null,null),null);assert.equal(structureRate({...tower,type_name:'Unknown Tower'},[],()=>null,null),null);
 db.prepare('INSERT INTO corp_snapshots VALUES(?,?,?)').run(668298004,JSON.stringify([tower]),Date.now());
 const data=await(await request('/api/corporation/structures',{session:owner.session})).json(),saved=data.structures.find(s=>s.id===999);assert.equal(saved.rate,40);assert.equal(fuelDeadlines(saved)[0].at,tower.inventory_at+405*3600000);assert.equal(saved.fuel,16200);
}));

test('Moon Surveys allows granted members to preview and add scans without opening write access to other corporation routes',()=>fixture(async({db,request,user})=>{
 const account=user(7302,'Moon survey contributor'),path='/api/corporation/surveys/import';
 const scan='Tarta VI - Moon 1\tZeolites\t1\t45490\t30005205\t40329101\t40329103';
 const post=(save,route=path)=>request(route,{session:account.session,method:'POST',body:{scan,save}});
 assert.equal((await post(true)).status,403);
 const group=db.prepare('INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES(?,?,?,?,?,?)').run('Moon surveys','','','open','{}','["corp-surveys"]').lastInsertRowid;
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,account.uid);
 let response=await post(false);
 assert.equal(response.status,200);
 assert.equal((await response.json()).addable,1);
 assert.equal(db.prepare('SELECT count(*) n FROM member_moon_scans').get().n,0);
 response=await post(true);
 assert.equal(response.status,200);
 assert.equal((await response.json()).addable,1);
 const listing=await (await request('/api/corporation/surveys?q=Tarta%20VI%20-%20Moon%201',{session:account.session})).json();
 assert.equal(listing.rows.find(row=>row.moon_id===40329103)?.ores[0].name,'Zeolites');
 assert.equal((await post(true,'/api/corporation/sync')).status,403);
},{...fakeCat,type:id=>id===45490?{id,name:'Zeolites'}:fakeCat.type(id)}));

test('notification switches mute individual kinds per account and do not disable their pages',()=>fixture(async({db,user,request})=>{
 const a=user(9903,'Muted PI'),b=user(9904,'Other owner'),now=Date.now();
 for(const id of [9903,9904]){
  db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(id,'pi',JSON.stringify([{planet_id:1,pins:[{pin_id:2,extractor_details:{},expiry_time:new Date(now-1000).toISOString()}]}]),now,now+3600000);
  db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(id,'dens',JSON.stringify([{id:1,reinforcement_timer:{end:new Date(now+3600000).toISOString()}}]),now,now+3600000);
 }
 const list=async session=>(await(await request('/api/notifications',{session})).json()).map(a=>a.kind);
 const change=body=>request('/api/settings',{session:a.session,method:'POST',body});
 assert.deepEqual(await list(a.session),['den-reinforced','pi-extractor']);
 assert.equal((await change({'notify-pi-extractor':'false'})).status,400);
 const response=await change({'notify-pi-extractor':false});
 assert.equal(response.status,200);
 assert.notEqual((await response.json()).pi,false);
 assert.deepEqual(await list(a.session),['den-reinforced']);
 assert.deepEqual(await list(b.session),['den-reinforced','pi-extractor']);
 assert.equal((await change({'notify-pi-extractor':true})).status,200);
 assert.deepEqual(await list(a.session),['den-reinforced','pi-extractor']);
}));

test('corporation overview attention never exposes a page without its grant',()=>fixture(async({db,user,request,corp})=>{
 const account=user(7360,'Overview viewer');
 corp.overview=async()=>({corporation:{name:'Test'}});
 const addGroup=pages=>{const group=db.prepare('INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES(?,?,?,?,?,?)').run('Overview access','','','open','{}',JSON.stringify(pages)).lastInsertRowid;db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,account.uid);};
 addGroup(['corp-overview']);
 const data={updated:Date.now(),active:[{issued:new Date(Date.now()-86400000).toISOString(),duration:2}]};
 db.prepare('INSERT INTO public_cache VALUES(?,?,?)').run('/tools/corp-data/market',JSON.stringify(data),Date.now()+3600000);
 let response=await request('/api/corporation/overview',{session:account.session});assert.equal(response.status,200);
 let body=await response.json();assert.equal(body.attention.rows.length,0);assert.equal(body.attention.coverage.length,0);
 addGroup(['corp-market']);
 body=await(await request('/api/corporation/overview',{session:account.session})).json();assert.equal(body.attention.rows[0].page,'corp-market');assert.equal(body.attention.rows[0].count,1);
}));

test('Users account sync queues only the selected account and deduplicates existing jobs',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'), target=user(7610,'Target'), other=user(7611,'Other');
 db.prepare('INSERT INTO characters SELECT 7612,user_id,?,owner_hash,tokens,scopes,expires,reconnect FROM characters WHERE id=7610').run('Target alt');
 const path=`/api/admin/users/${target.uid}/sync`;
 const post=(url,account)=>request(url,{session:account.session,method:'POST',body:{}});
 assert.equal((await post(path,other)).status,403);
 assert.equal((await post('/api/admin/users/99999/sync',owner)).status,404);
 assert.deepEqual(await (await post(path,owner)).json(),{characters:2,queued:2});
 assert.deepEqual(await (await post(path,owner)).json(),{characters:2,queued:0});
 assert.deepEqual(db.prepare('SELECT character_id FROM jobs ORDER BY character_id').all().map(row=>row.character_id),[7610,7612]);
}));

test('Corporation Projects shows members the five stats and keeps contributors private',()=>fixture(async({db,user,request,corp})=>{
 const {collectProjects,PROJECT_SCOPE}=await import('../lib/corp-projects.mjs');
 const now=Date.now(), stamp=new Date(now).toISOString(), active='aa000000-0000-0000-0000-000000000001', done='aa000000-0000-0000-0000-000000000002';
 const member=user(7531,'Corp member'), outsider=user(7532,'Other corporation');
 db.prepare('INSERT OR IGNORE INTO login_whitelist(corporation_id) VALUES(?)').run(12345);
 const collect=async path=>{
  if(path.includes('state=All')&&path.endsWith('after=0'))return {projects:[{id:active,state:'Active',name:'Bring Tritanium',last_modified:stamp,progress:{current:25,desired:100},reward:{initial:1000,remaining:750}}],cursor:{after:'page2'}};
  if(path.includes('state=All'))return {projects:[{id:done,state:'Completed',name:'Build ships',last_modified:stamp,progress:{current:100,desired:100}}]};
  if(path.includes('/contributors'))return {contributors:[{id:7531,contributed:10},{id:9999,contributed:5}]};
  if(path.endsWith(active))return {configuration:{deliver_item:{docking_locations:[{station_id:60003760}],items:[{type_id:34}]}},details:{description:'Deliver to Jita'},contribution:{participation_limit:40,reward_per_contribution:10}};
  if(path.endsWith(done))return {details:{finished:stamp}};
  throw Error(path);
 };
 const snapshot=await collectProjects({id:668298004,request:collect,location:async()=> 'Jita IV – Moon 4',now});
 corp.projects=async()=>({...snapshot,updated:now});
 const get=(path,account)=>request(path,{session:account.session});
 const account=await(await get('/api/me',member)).json();
 assert.ok(account.corporate_pages.includes('corp-projects'));
 const response=await get('/api/corporation/projects',member);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.deepEqual(data.stats,{personal:300,shared:750,active:1,today:new Date(now).getUTCDate()===new Date(stamp).getUTCDate()?1:0,week:snapshot.rows.length-1});
 assert.deepEqual(data.rows[0].locations,['Jita IV – Moon 4']);
 assert.equal(data.rows[0].typeId,34);
 assert.equal(data.rows[0].contributors,undefined);
 assert.equal((await get('/api/corporation/projects',outsider)).status,403);
 const login=await get('/auth/login?corporation=1&projects=1',member);
 assert.ok(new URL(login.headers.get('location')).searchParams.get('scope').split(' ').includes(PROJECT_SCOPE));
 const normal=await get('/auth/login',member);
 assert.ok(!new URL(normal.headers.get('location')).searchParams.get('scope').split(' ').includes(PROJECT_SCOPE));
},fakeCat,{membershipLookup:async id=>({corporation_id:id===7532?12345:668298004})}));

test('Timerboard is optional and combines permitted ESI timers with manually pasted timers',()=>fixture(async({db,user,request,corp})=>{
 const admin=user(100,'Admin'), pilot=user(7481,'Timer pilot');
 const path='/api/timerboard', now=Date.now();
 const at=new Date(Math.ceil((now+3600000)/1000)*1000);
 const expiry=at.toISOString().slice(0,19).replaceAll('-','.').replace('T',' ');
 const detail='04-LQM - P03M01\n15 km\nReinforced until '+expiry;
 const post=(url,account,body)=>request(url,{session:account.session,method:'POST',body});
 const get=account=>request(path,{session:account.session});
 corp.snapshot=()=>({updated:now,structures:[{id:1,name:'Corp Fortizar',kind:'Structure',state:'armor_reinforce',timer:new Date(now+1800000).toISOString()}]});
 assert.equal((await get(pilot)).status,403);
 assert.equal((await post('/api/admin/service-plugins/timerboard',pilot,{enabled:true})).status,403);
 assert.equal((await post('/api/admin/service-plugins/timerboard',admin,{enabled:true})).status,200);
 const timer={stage:'Final',type:'Customs Office',stance:'Hostile',ticker:'test',detail};
 assert.equal((await post(path,pilot,timer)).status,403);
 const calGroup=db.prepare("SELECT group_id FROM contributor_groups WHERE kind='calendar'").get().group_id;
 const event={title:'Corp fleet',kind:'fleet',start:at.toISOString().slice(0,16),audience:'all'};
 assert.equal((await post('/api/calendar',pilot,event)).status,403);
 assert.equal((await post('/api/groups/'+calGroup+'/apply',pilot,{})).status,200);
 assert.equal((await post('/api/calendar',pilot,event)).status,403);
 assert.equal((await post('/api/admin/groups/'+calGroup+'/member',admin,{user_id:pilot.uid,status:'approved'})).status,200);
 assert.equal((await post('/api/corporation/calendar',pilot,event)).status,201);
 assert.equal((await post('/api/corporation/calendar',pilot,{...event,audience:'directors'})).status,403);
 db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(calGroup,pilot.uid);
 const contributor=db.prepare("SELECT group_id FROM contributor_groups WHERE kind='timerboard'").get().group_id;
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(contributor,pilot.uid);
 assert.equal((await post(path,pilot,{...timer,detail:'invalid'})).status,400);
 assert.equal((await post(path,pilot,timer)).status,201);
 assert.equal((await post(path,pilot,{...timer,stage:'Shield'})).status,400);
 const targets=async()=> (await (await get(pilot)).json()).targets;
 assert.deepEqual(await targets(),[]);
 assert.equal((await post(path+'/targets',pilot,{...timer,stage:'Shield',detail:'04-LQM - Test Target'})).status,201);
 const [target]=await targets();
 assert.deepEqual([target.name,target.stage,target.at],['04-LQM - Test Target','Shield',undefined]);
 const remove=account=>request(path+'/targets/'+target.id,{session:account.session,method:'DELETE',body:{}});
 assert.equal((await remove(pilot)).status,403);
 assert.equal((await remove(admin)).status,200);
 assert.deepEqual(await targets(),[]);
 const home=async()=> (await request('/api/home',{session:pilot.session})).json();
 assert.deepEqual((await home()).upcomingTimers.map(row=>[row.title,row.stance,row.at]),[['04-LQM - P03M01','Hostile',at.getTime()]]);
 assert.equal((await post('/api/settings',pilot,{'home-show-upcomingTimers':false})).status,200);
 assert.deepEqual((await home()).upcomingTimers,[]);
 const calendar=async()=> (await (await request('/api/calendar',{session:pilot.session})).json()).events.filter(event=>event.source==='timerboard');
 assert.equal((await calendar())[0].starts,at.getTime());
 assert.equal((await post('/api/admin/service-plugins/timerboard',admin,{enabled:true,audience:'directors'})).status,200);
 assert.equal((await get(pilot)).status,403);
 assert.equal((await get(admin)).status,200);
 assert.deepEqual((await (await get(admin)).json()).timers.map(row=>[row.source,row.stage,row.ticker]),[['ESI','Armor','STEMP/FRT'],['Manual','Final','TEST']]);
 assert.deepEqual(await calendar(),[]);
 assert.deepEqual((await home()).monthCalendar.events.filter(event=>event.source==='timerboard'),[]);
 assert.equal((await post('/api/admin/service-plugins/timerboard',admin,{enabled:true,audience:'group'})).status,400);
 const group=db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Timer pilots','','','auto','[]','[]')").run().lastInsertRowid;
 assert.equal((await post('/api/admin/service-plugins/timerboard',admin,{enabled:true,audience:'group',review_group:group})).status,200);
 assert.equal((await get(pilot)).status,403);
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,pilot.uid);
 assert.equal((await get(pilot)).status,200);
 const page=await request('/api/corporation/calendar',{session:pilot.session});
 assert.equal(page.status,200);
 assert.equal((await page.json()).events.find(event=>event.source==='timerboard').starts,at.getTime());
 assert.equal((await calendar())[0].starts,at.getTime());
 const personal=(await (await get(pilot)).json()).timers;
 assert.deepEqual(personal.map(row=>[row.system,row.name,row.ticker,row.at]),[['04-LQM','04-LQM - P03M01','TEST',at.getTime()]]);
 assert.equal((await get(admin)).status,403);
 const posAt=new Date(at.getTime()+2*86400000);
 const posExpiry=posAt.toISOString().slice(0,19).replaceAll('-','.').replace('T',' ');
 const pos={...timer,type:'POS',stance:'Friendly',detail:'Stevestar 1\n7,802 m\nReinforced until '+posExpiry};
 const missingSystem=await post(path,pilot,pos);
 assert.equal(missingSystem.status,400);
 assert.match((await missingSystem.json()).error,/solar system/);
 assert.equal((await post(path,pilot,{...pos,system:'04-lqm'})).status,201);
 const savedPos=(await (await get(pilot)).json()).timers.find(row=>row.type==='POS');
 assert.deepEqual([savedPos.name,savedPos.system,savedPos.at],['Stevestar 1','04-LQM',posAt.getTime()]);
 assert.equal(savedPos.typeId,16213);
 assert.equal((await post('/api/settings',pilot,{'home-show-upcomingTimers':true})).status,200);
 assert.deepEqual((await home()).upcomingTimers.map(row=>[row.title,row.stance,row.at]),[
  ['04-LQM - P03M01','Hostile',at.getTime()],['Stevestar 1','Friendly',posAt.getTime()]
 ]);
 assert.equal((await home()).upcomingTimers.find(row=>row.title==='Stevestar 1').typeId,16213);
 assert.equal((await (await get(pilot)).json()).canRemoveTimers,false);
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,admin.uid);
 assert.equal((await (await get(admin)).json()).canRemoveTimers,true);
 const deleteTimer=(actor,id)=>request(path+'/timers/'+id,{session:actor.session,method:'DELETE',body:{}});
 assert.equal((await deleteTimer(pilot,savedPos.id)).status,403);
 assert.equal((await deleteTimer(admin,'reinforcement-1')).status,404);
 assert.equal((await deleteTimer(admin,savedPos.id)).status,200);
 assert.equal((await deleteTimer(admin,savedPos.id)).status,404);
 assert.ok(!(await home()).upcomingTimers.some(row=>row.title==='Stevestar 1'));
}));

test('Buyback and Logistics are independently enabled, private and require acceptance of the latest admin quote',()=>fixture(async({user,request})=>{
 const admin=user(100,'Admin'), pilot=user(7531,'Requester'), other=user(7532,'Other pilot');
 const post=(path,account,body)=>request(path,{session:account.session,method:'POST',body});
 const get=(path,account)=>request(path,{session:account.session});
 const buyback='/api/service-plugins/buyback', logistics='/api/service-plugins/logistics';
 const settings='/api/admin/service-plugins/';
 assert.equal((await get(buyback,pilot)).status,403);
 assert.equal((await post(settings+'buyback',pilot,{enabled:true})).status,403);
 assert.equal((await post(settings+'buyback',admin,{enabled:true})).status,200);
 assert.equal((await get(logistics,pilot)).status,403);
 const response=await post(buyback,pilot,{items:'Tritanium\t5,000',location:'Jita IV - Moon 4',notes:'Available tonight'});
 assert.equal(response.status,201);
 const {id}=await response.json(), claim=buyback+'/'+id;
 assert.deepEqual((await (await get(buyback+'?view=queue',other)).json()).requests,[]);
 assert.equal((await post(claim,other,{action:'accept',revision:0})).status,404);
 assert.equal((await post(claim,pilot,{action:'quote',revision:0,quote:30000})).status,409);
 assert.equal((await post(claim,admin,{action:'quote',revision:0,quote:30000,settlement:'contract',note:'Use an item exchange contract'})).status,200);
 assert.equal((await post(claim,admin,{action:'quote',revision:1,quote:32000})).status,200);
 assert.equal((await post(claim,pilot,{action:'accept',revision:1})).status,409);
 assert.equal((await post(claim,admin,{action:'complete',revision:2})).status,409);
 assert.equal((await post(claim,pilot,{action:'accept',revision:2})).status,200);
 assert.equal((await post(claim,admin,{action:'quote',revision:3,quote:33000})).status,409);
 assert.equal((await post(claim,admin,{action:'complete',revision:3,note:'Contract completed'})).status,200);
 const [paid]=(await (await get(buyback,pilot)).json()).requests;
 assert.equal(paid.status,'completed');
 assert.equal(paid.quote,32000);
 assert.equal(paid.closed_by,'Admin');
 assert.equal(paid.details.items,'Tritanium\t5,000');
 assert.equal(paid.settlement,'contract');
 assert.deepEqual((await (await get(buyback+'/payments',pilot)).json()).balance,{count:0,amount:0});
 const {buybackItems}=await import('../public/buyback-items.mjs');
 const inventory='Cruise Missile Launcher I\t\tMissile Launcher Cruise\t\tHigh\t20 m3\t89,849.98 ISK\r\nZydrine<t><right>162<t>Mineral<t><t><t><right>1.62 m3<t><right>167,959.98 ISK';
 assert.deepEqual(buybackItems(inventory),[
  {name:'Cruise Missile Launcher I',quantity:1,volume:'20 m3',cents:8984998},
  {name:'Zydrine',quantity:162,volume:'1.62 m3',cents:16795998}
 ]);
 const ownBuyback=await (await post(buyback,admin,{items:'Zydrine',location:'49-'})).json();
 const ownRequest=`${buyback}/${ownBuyback.id}`;
 assert.equal((await post(ownRequest,pilot,{action:'edit-items',revision:0,items:inventory})).status,404);
 assert.equal((await post(ownRequest,admin,{action:'edit-items',revision:0,items:inventory})).status,200);
 assert.equal((await (await get(buyback+'?view=queue',admin)).json()).requests[0].details.items,inventory);
 assert.equal((await post(ownRequest,admin,{action:'quote',revision:1,quote:200000})).status,200);
 assert.equal((await post(ownRequest,admin,{action:'edit-items',revision:2,items:'Other item'})).status,409);

 assert.equal((await post(settings+'logistics',admin,{enabled:true})).status,200);
 const haul={from:'Jita',to:'Staging',space:'nullsec',volume:1450.5,collateral:50000000};
 assert.equal((await post('/api/logistics/settings',admin,{locations:[{name:'Jita',pickup:true,destination:true},{name:'Staging',pickup:true,destination:true}],maxVolumes:{nullsec:350000,lowsec:350000,empire:350000},pricePerM3:0,collateralPerM3:0})).status,200);
 assert.equal((await post(logistics,pilot,{...haul,to:' jita '})).status,400);
 const created=await post(logistics,pilot,haul);
 assert.equal(created.status,201);
 const job=logistics+'/'+(await created.json()).id;
 assert.equal((await post(job,admin,{action:'quote',revision:0,quote:0})).status,200);
 assert.equal((await post(job,pilot,{action:'accept',revision:1})).status,200);
 assert.equal((await post(job,admin,{action:'complete',revision:2})).status,200);
 assert.equal((await post(settings+'logistics',admin,{enabled:false})).status,200);
 assert.equal((await get(logistics,pilot)).status,403);
 assert.equal((await post(settings+'logistics',admin,{enabled:true})).status,200);
 const [delivered]=(await (await get(logistics,pilot)).json()).requests;
 assert.deepEqual(delivered.details,{...haul,notes:'',estimatedFee:0,pricePerM3:0,collateralPerM3:0});
 assert.equal(delivered.status,'completed');
 assert.equal(delivered.quote,0);
}));

test('Buyback batches received items for payment and shows plugin activity only to the relevant Home viewers',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'), pilot=user(7531,'Requester'), reviewer=user(7532,'Buyback reviewer'), other=user(7533,'Other pilot');
 const post=(path,account,body)=>request(path,{session:account.session,method:'POST',body});
 const get=async(path,account)=>(await request(path,{session:account.session})).json();
 const buyback='/api/service-plugins/buyback', payments=buyback+'/payments';
 const group=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Buyback reviewers','','','manual','[]','[]')").run().lastInsertRowid);
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,reviewer.uid);
 assert.equal((await post('/api/admin/service-plugins/buyback',admin,{enabled:true,review_group:group})).status,200);
 for(const amount of [100,200]) {
  const {id}=await (await post(buyback,pilot,{items:'Tritanium\t2',location:'Jita'})).json();
  assert.equal((await post(`${buyback}/${id}`,reviewer,{action:'quote',quote:amount,revision:0})).status,200);
  assert.ok((await get('/api/home',pilot)).buyback.some(event=>event.title.includes('awaiting your response')));
  assert.equal((await post(`${buyback}/${id}`,pilot,{action:'accept',revision:1})).status,200);
  assert.equal((await post(`${buyback}/${id}`,reviewer,{action:'complete',revision:2})).status,200);
 }
 assert.deepEqual((await get(payments,pilot)).balance,{count:2,amount:300});
 assert.ok((await get('/api/home',pilot)).buyback.some(event=>event.detail==='300 ISK'));
 const {id,amount}=await (await post(payments,pilot,{})).json();
 assert.equal(amount,300);
 assert.equal((await post(payments,pilot,{})).status,409);
 assert.equal((await get(payments+'?view=queue',other)).payments.length,0);
 assert.equal((await get(payments+'?view=queue',reviewer)).payments[0].recipient,7531);
 assert.ok((await get('/api/home',reviewer)).buyback.some(event=>event.title.includes('payment requested')));
 assert.deepEqual((await get('/api/home',other)).buyback,[]);
 const path=`${payments}/${id}`;
 assert.equal((await post(path,reviewer,{action:'paid'})).status,409);
 assert.equal((await post(path,reviewer,{action:'start'})).status,200);
 assert.equal((await post(path,admin,{action:'start'})).status,409);
 assert.equal((await post(path,reviewer,{action:'paid'})).status,200);
 assert.deepEqual((await get(buyback,pilot)).requests.map(row=>row.status),['completed','completed']);
 assert.ok((await get('/api/home',pilot)).buyback.some(event=>event.title==='2 Buyback requests paid'));
 assert.equal((await post('/api/admin/service-plugins/buyback',admin,{enabled:false})).status,200);
 assert.deepEqual((await get('/api/home',pilot)).buyback,[]);
}));

test('Buyback values quantities at Jita and retains settled requests',()=>fixture(async({db,user,request})=>{
 const admin=user(100,'Admin'), pilot=user(7531,'Requester'), other=user(7532,'Other pilot');
 const post=(path,account,body)=>request(path,{session:account.session,method:'POST',body});
 const buyback='/api/service-plugins/buyback';
 await post('/api/admin/service-plugins/buyback',admin,{enabled:true});
 db.prepare('INSERT INTO public_cache VALUES(?,?,?)').run('/tools/jita-market/34',JSON.stringify({id:34,buy:4.15,sell:5.25}),Date.now()+60000);
 const {id}=await (await post(buyback,pilot,{items:'Tritanium\t2\nUnknown\t1',location:'Jita'})).json();
 const path=`${buyback}/${id}`;
 const get=account=>request(path+'/prices',{session:account.session});
 assert.equal((await get(other)).status,404);
 assert.deepEqual((await (await get(pilot)).json()).totals,{buy:{value:8.3,missing:1},sell:{value:10.5,missing:1}});
 const remove=(account,revision)=>request(path,{session:account.session,method:'DELETE',body:{revision}});
 assert.equal((await remove(pilot,0)).status,403);
 assert.equal((await post(path,admin,{action:'decline',revision:0,note:'Outside buyback policy'})).status,200);
 assert.equal((await remove(admin,0)).status,409);
 assert.equal((await remove(admin,1)).status,200);
 assert.equal((await get(admin)).status,404);
 const paid=(await (await post(buyback,pilot,{items:'Tritanium\t2',location:'Jita'})).json()).id;
 const paidPath=`${buyback}/${paid}`;
 await post(paidPath,admin,{action:'quote',revision:0,quote:8});
 await post(paidPath,pilot,{action:'accept',revision:1});
 assert.equal((await request(paidPath,{session:admin.session,method:'DELETE',body:{revision:2}})).status,409);
},{...fakeCat,named:name=>name==='Tritanium'?34:null}));

test('SRP imports an owned loss, prices fittings separately from cargo and protects claim review',()=>{
 const timestamp = new Date().toISOString();
 const mail = {killmail_id:42,killmail_time:timestamp,solar_system_id:30000142,victim:{character_id:7421,ship_type_id:10,items:[
  {item_type_id:11,flag:11,quantity_destroyed:1}, {item_type_id:12,flag:5,quantity_dropped:2}
 ]},zkb:{totalValue:160}};
 return fixture(async({db,user,request,corp})=>{
  const owner = user(100,'Owner'), pilot = user(7421,'Claimant'), reviewer = user(7422,'Reviewer'), outsider = user(7423,'Outsider');
  const group = db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('SRP reviewers','','','manual','[]','[]')").run().lastInsertRowid;
  db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,reviewer.uid);
  const post = (path,account,body) => request(path,{session:account.session,method:'POST',body});
  const get = (path,account) => request(path,{session:account.session});
  const claim = {link:'https://zkillboard.com/kill/42/'};
  assert.equal((await post('/api/srp',pilot,claim)).status,403);
  assert.equal((await post('/api/admin/plugins/srp',outsider,{enabled:true,review_group:group})).status,403);
  assert.equal((await post('/api/admin/plugins/srp',owner,{enabled:true,review_group:group})).status,200);
  assert.equal((await post('/api/srp',outsider,claim)).status,403);
  assert.equal((await post('/api/srp',pilot,claim)).status,201);
  assert.equal((await post('/api/srp',pilot,claim)).status,409);
  let [saved] = (await (await get('/api/srp',pilot)).json()).claims;
  assert.equal(saved.total,160);
  assert.equal(saved.eligible,120);
  assert.equal(saved.insurance.amount,null);
  assert.match(saved.fit,/Skill 11/);
  db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(7421,'wallet-history',JSON.stringify({journal:[{id:1,date:timestamp,ref_type:'insurance_payout',amount:50}]}),1,2);
  assert.equal((await post('/api/srp/42/recheck',outsider,{})).status,404);
  assert.equal((await (await post('/api/srp/42/recheck',pilot,{})).json()).verified,true);
  assert.deepEqual((await (await get('/api/srp?view=review',outsider)).json()).claims,[]);
  [saved] = (await (await get('/api/srp?view=review',reviewer)).json()).claims;
  assert.equal(saved.insurance.amount,50);
  assert.equal(saved.suggested,70);
  assert.equal(saved.insurance_journal,undefined);
  assert.equal((await post('/api/srp/42/review',pilot,{action:'approved',payout:70})).status,403);
  assert.equal((await post('/api/srp/42/review',reviewer,{action:'approved',payout:70})).status,200);
  assert.equal((await post('/api/srp/42/review',reviewer,{action:'paid'})).status,409);
  const remove = (id,account) => request(`/api/srp/${id}`,{session:account.session,method:'DELETE',body:{}});
  assert.equal((await remove(42,owner)).status,409);
  const testClaim = {link:'https://zkillboard.com/kill/43/'};
  assert.equal((await post('/api/srp',pilot,testClaim)).status,201);
  assert.equal((await remove(43,outsider)).status,404);
  assert.equal((await remove(43,reviewer)).status,404);
  assert.equal((await remove(43,pilot)).status,200);
  assert.equal((await post('/api/srp',pilot,testClaim)).status,201);
  assert.equal((await remove(43,owner)).status,200);
  assert.equal((await post('/api/srp',pilot,testClaim)).status,201);
  assert.equal((await post('/api/srp/43/review',reviewer,{action:'declined'})).status,400);
  assert.equal((await post('/api/srp/43/review',reviewer,{action:'declined',decision:'Outside fleet coverage'})).status,200);
  db.prepare('INSERT INTO characters SELECT 7424,user_id,?,owner_hash,tokens,scopes,expires,reconnect FROM characters WHERE id=7421').run('Claimant alt');
  assert.equal((await post('/api/srp',pilot,{link:'https://zkillboard.com/kill/44/'})).status,201);
  for(const [account,view] of [[pilot,'mine'],[reviewer,'review']]) {
   const {sections}=await (await get(`/api/srp?grouped=1&view=${view}`,account)).json();
   assert.deepEqual(sections.pending.claims.map(c=>c.kill_id),[44]);
   assert.deepEqual(sections.rejected.claims.map(c=>[c.kill_id,c.decision]),[[43,'Outside fleet coverage']]);
   assert.deepEqual(sections.accepted.claims.map(c=>[c.kill_id,c.status]),[[42,'approved']]);
  }
  const outsiderSections=(await (await get('/api/srp?grouped=1&view=review',outsider)).json()).sections;
  assert.ok(Object.values(outsiderSections).every(section=>section.claims.length===0));
  assert.equal((await post('/api/srp/44/review',reviewer,{action:'approved',payout:70})).status,200);
  const {sections}=await (await get('/api/srp?grouped=1&view=review',reviewer)).json();
  assert.deepEqual(sections.pending.claims,[]);
  assert.deepEqual(sections.accepted.claims.map(c=>c.status),['approved','approved']);
  const payouts='/api/srp/payouts';
  assert.deepEqual((await (await get(payouts,pilot)).json()).balance,{count:2,amount:140});
  assert.ok((await (await get('/api/home',pilot)).json()).srp.some(event=>event.detail==='140 ISK'));
  const requested=await post(payouts,pilot,{});
  assert.equal(requested.status,201);
  const {id,amount}=await requested.json();
  assert.equal(amount,140);
  assert.ok((await (await get('/api/home',reviewer)).json()).srp.some(event=>event.title==='1 SRP payout requested'));
  assert.deepEqual((await (await get('/api/home',outsider)).json()).srp,[]);
  assert.equal((await post(payouts,pilot,{})).status,409);
  assert.deepEqual((await (await get(payouts+'?view=review',outsider)).json()).payouts,[]);
  const payout=payouts+'/'+id;
  assert.equal((await post(payout,outsider,{action:'start',division:2})).status,403);
  assert.equal((await post(payout,reviewer,{action:'start',division:2})).status,200);
  assert.equal((await post(payout,owner,{action:'start',division:2})).status,409);
  assert.equal((await post(payout,owner,{action:'sent'})).status,409);
  const sent=await (await post(payout,reviewer,{action:'sent'})).json();
  assert.equal(sent.recipient,7421);
  assert.equal(sent.status,'sent');
  const transfer={id:1500,date:new Date(sent.started).toISOString(),second_party_id:7421,amount:-140,ref_type:'corporation_account_withdrawal',reason:sent.reference};
  corp.walletJournal=async division=>{assert.equal(division,2);return {rows:[{...transfer,reason:'Unrelated transfer'}]};};
  assert.equal((await (await post(payout+'/verify',reviewer,{})).json()).verified,false);
  corp.wallets=async()=>({rows:[{division:2,journal:[transfer]}]});
  assert.equal((await get('/api/corporation/wallet',owner)).status,200);
  const verified=(await (await get(payouts,pilot)).json()).payouts[0];
  assert.equal(verified.status,'verified');
  assert.deepEqual(db.prepare('SELECT status FROM srp_claims WHERE kill_id IN (42,44)').all().map(row=>row.status),['paid','paid']);
  for(const kill of [45,46]) assert.equal((await post('/api/srp',owner,{link:`https://zkillboard.com/kill/${kill}/`})).status,201);
  assert.equal((await post('/api/srp/45/review',owner,{action:'approved',payout:70})).status,200);
  assert.equal((await post('/api/srp/46/review',owner,{action:'declined',decision:'Test claim'})).status,200);
  const ownPayout=await (await post(payouts,owner,{})).json();
  assert.equal((await post(`${payouts}/${ownPayout.id}`,owner,{action:'start',division:2})).status,403);
  assert.equal((await post('/api/srp',reviewer,{link:'https://zkillboard.com/kill/47/'})).status,201);
  assert.equal((await post('/api/srp/47/review',reviewer,{action:'approved',payout:70})).status,403);
  assert.equal((await post('/api/admin/plugins/srp',owner,{enabled:false,review_group:group})).status,200);
  assert.equal((await get('/api/srp',pilot)).status,403);
  assert.equal(db.prepare('SELECT status FROM srp_claims WHERE kill_id=42').get().status,'paid');
 },fakeCat,{eve:{publicGet:async()=>[{type_id:10,levels:[{name:'Basic',payout:50}]}]},srpNetwork:async url=>{
  const id=Number(url.split('/').at(-2));
  return Response.json(url.includes('/killID/')?[{...mail,killmail_id:id,victim:{...mail.victim,character_id:({44:7424,45:100,46:100,47:7422})[id] || 7421}}]:{10:100,11:20,12:20});
 }});
});

test('Calendar MTOs are upcoming personal timers and respect Mercenary Dens settings',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Organiser'), pilot=user(7615,'Den pilot');
 const now=Date.now(), expiry=new Date(now+3600000).toISOString();
 const group=db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Calendar','','','auto','[]','[\"corp-calendar\"]')").run().lastInsertRowid;
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,pilot.uid);
 const dens=[{id:50,planet:{name:'Example III'},operations:[{id:11,state:'Started',expires:expiry,definition:{name:{en:'Example operation'}}},{id:12,state:'Available',expires:new Date(now-3600000).toISOString()},{id:13,state:'Completed',expires:expiry}]}];
 db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(7615,'dens',JSON.stringify(dens),now,now+3600000);
 const get=async(path,account)=>(await request(path,{session:account.session})).json();
 const events=async(path,account)=>(await get(path,account)).events.filter(event=>event.kind==='mto');
 const [timer]=await events('/api/corporation/calendar',pilot);
 assert.equal(timer.title,'Example operation · Den pilot');
 assert.equal(timer.starts,Date.parse(expiry));
 assert.deepEqual(await events('/api/calendar',pilot),[timer]);
 assert.deepEqual((await get('/api/home',pilot)).monthCalendar.events.filter(event=>event.kind==='mto'),[timer]);
 assert.deepEqual(await events('/api/corporation/calendar',owner),[]);
 assert.equal((await request('/api/settings',{session:pilot.session,method:'POST',body:{dens:false}})).status,200);
 assert.deepEqual(await events('/api/calendar',pilot),[]);
 assert.deepEqual(await events('/api/corporation/calendar',pilot),[]);
}));

test('operations calendar filters timer sources and restricts event writes to organisers',()=>fixture(async({db,user,request,corp})=>{
 const owner=user(100,'Organiser'),viewer=user(7361,'Calendar viewer'),outsider=user(7362,'Other pilot');
 const endpoint='/api/corporation/calendar', now=Date.now();
 const grant=pages=>{
  const group=db.prepare('INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES(?,?,?,?,?,?)')
   .run('Calendar access','','','auto','[]',JSON.stringify(pages)).lastInsertRowid;
  db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(group,viewer.uid);
 };
 grant(['corp-calendar']);
 corp.snapshot=()=>({updated:now,structures:[{id:1,name:'Private refinery',kind:'Structure',state:'armor_reinforce',timer:new Date(now+86400000).toISOString()}]});
 db.prepare('INSERT INTO public_cache VALUES(?,?,?)').run('/tools/moon-extractions',JSON.stringify({updated:now,rows:[{structure_id:1,moon_id:9,chunk_arrival_time:new Date(now+3600000).toISOString(),natural_decay_time:new Date(now+86400000).toISOString()}]}),0);
 db.prepare('INSERT INTO public_cache VALUES(?,?,?)').run('/tools/corp-data/contracts',JSON.stringify({updated:now,contracts:[{contract_id:2,title:'Private courier',type:'courier',status:'in_progress',date_accepted:new Date(now).toISOString(),days_to_complete:1}]}),0);
 const body={title:'Fleet form-up',kind:'fleet',start:new Date(now+7200000).toISOString().slice(0,16),system:'Example system'};
 assert.equal((await request(endpoint,{session:outsider.session})).status,403);
 assert.equal((await request(endpoint,{session:viewer.session,method:'POST',body})).status,403);
 assert.equal((await request(endpoint,{session:owner.session,method:'POST',body:{...body,fitting:'javascript:alert(1)'}})).status,400);
 const created=await request(endpoint,{session:owner.session,method:'POST',body});
 assert.equal(created.status,201);
 const {id}=await created.json();
 let list=await(await request(endpoint,{session:viewer.session})).json();
 assert.equal(list.canEdit,false);
 assert.deepEqual(list.events.map(e=>e.title),['Fleet form-up']);
 assert.deepEqual(list.coverage,[]);
 grant(['corp-contracts']);
 list=await(await request(endpoint,{session:viewer.session})).json();
 assert.deepEqual(list.events.map(e=>e.title),['Fleet form-up','Private courier']);
 assert.equal(list.events[1].starts,now+86400000);
 list=await(await request(endpoint,{session:owner.session})).json();
 assert.deepEqual(new Set(list.events.map(e=>e.kind)),new Set(['fleet','moon','reinforcement','courier']));
 assert.equal(list.canEdit,true);
 assert.equal((await request(endpoint+'/'+id,{session:owner.session,method:'POST',body:{...body,title:'Updated fleet'}})).status,200);
 assert.equal((await request(endpoint+'/'+id,{session:viewer.session,method:'DELETE',body:{}})).status,403);
 assert.equal((await request(endpoint+'/'+id,{session:owner.session,method:'DELETE',body:{}})).status,200);
 const create=async(session,audience,title)=>{
  const result=await request('/api/calendar',{session,method:'POST',body:{...body,audience,title}});
  assert.equal(result.status,201);
  return (await result.json()).id;
 };
 const publicId=await create(owner.session,'all','Open fleet');
 const directorId=await create(owner.session,'directors','Director briefing');
 const privateId=await create(viewer.session,'private','Private reminder');
 const homeMonth=async session=>(await(await request('/api/home',{session})).json()).monthCalendar.events;
 const visibleIds=async session=>(await homeMonth(session)).filter(event=>event.manual).map(event=>event.id);
 assert.deepEqual(await visibleIds(outsider.session),[publicId]);
 assert.deepEqual(await visibleIds(viewer.session),[publicId,privateId]);
 assert.deepEqual(await visibleIds(owner.session),[publicId,directorId]);
 assert.ok((await homeMonth(viewer.session)).find(event=>event.id===privateId).canEdit);
 const corpView=await(await request(endpoint,{session:viewer.session})).json();
 assert.ok(!corpView.events.some(event=>event.id===directorId));
 assert.equal((await request('/api/calendar',{session:viewer.session,method:'POST',body:{...body,audience:'all'}})).status,403);
 assert.equal((await request('/api/calendar/'+privateId,{session:owner.session,method:'DELETE',body:{}})).status,404);
 assert.equal((await request('/api/calendar/'+directorId,{session:viewer.session,method:'POST',body:{...body,audience:'all'}})).status,403);
 assert.equal((await request('/api/calendar/'+privateId,{session:viewer.session,method:'POST',body:{...body,title:'Updated reminder',audience:'private'}})).status,200);
 assert.equal((await request('/api/calendar/'+privateId,{session:viewer.session,method:'DELETE',body:{}})).status,200);
}));

test('Home uses the signed-in pilot’s saved data and filters hidden events and corporation access',()=>fixture(async({db,user,request,corp})=>{
 const viewer=user(7363,'Home pilot'),owner=user(100,'Director');
 user(7364,'Other pilot');
 const now=Date.now(),end=new Date(now+3600000).toISOString();
 const save=db.prepare('INSERT INTO snapshots(character_id,kind,data,updated,expires) VALUES(?,?,?,?,?)');
 save.run(7363,'skills',JSON.stringify({queue:[{finish_date:end}]}),now,now+3600000);
 save.run(7363,'pi',JSON.stringify([{planet_id:1,info:{name:'Test planet'},pins:[{extractor_details:{},expiry_time:end},{extractor_details:{},expiry_time:end}]},{planet_id:2,info:{name:'Second planet'},pins:[{extractor_details:{},expiry_time:new Date(now+8*3600000).toISOString()}]},{planet_id:3,info:{name:'Tomorrow planet'},pins:[{extractor_details:{},expiry_time:new Date(now+9*3600000).toISOString()}]},{planet_id:4,info:{name:'Expired planet'},pins:[{extractor_details:{},expiry_time:new Date(now-3600000).toISOString()}]}]),now,now+3600000);
 save.run(7364,'skills',JSON.stringify({queue:[]}),now,now+3600000);
 corp.snapshot=()=>({updated:now,structures:[{id:1,name:'Private structure',kind:'Structure',state:'armor_reinforce',timer:end,inventory_at:now,fuel:50,rate:10},
  {id:2,name:'Private Moon Drill',kind:'Moon Drill',state:'hull_reinforce',timer:new Date(now+8*86400000).toISOString()}]});
 const read=async session=>{
  const response=await request('/api/home',{session});
  assert.equal(response.status,200);
  return response.json();
 };
 let feed=await read(viewer.session);
 assert.deepEqual(feed.pilots,[{id:7363,name:'Home pilot'}]);
 assert.deepEqual(feed.skills.map(event=>event.title),['Skill queue ends']);
 assert.deepEqual(feed.pi.map(event=>event.title).sort(),['1 PI planet finished','2 PI planets ending soon']);
 assert.deepEqual(feed.pi.find(event=>event.timeLabel==='Next').items.map(item=>item.title),['Test planet','Second planet']);
 assert.deepEqual(feed.couriers,[]);
 assert.deepEqual(feed.reinforcedDrills,[]);
 const id=db.prepare('INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES(?,?,?,?,?,?)')
  .run('Structures','','','auto','[]','["corp-structures"]').lastInsertRowid;
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(id,viewer.uid);
 feed=await read(viewer.session);
 assert.equal(feed.corpReinforced[0].title,'Structure reinforced');
 assert.deepEqual(feed.reinforcedDrills.map(event=>[event.title,event.detail,event.timeLabel]),[['Moon Drill reinforced','Private Moon Drill','Exits']]);
 assert.equal(feed.reinforcedDrills[0].savedKey,null);
 const markSaved=key=>request('/api/home/structures/saved',{session:viewer.session,method:'POST',body:{key}});
 assert.equal((await markSaved('dashboard-saved-structure:reinforcement-2:'+feed.reinforcedDrills[0].at)).status,404);
 const priorSnapshot=corp.snapshot;
 const exited=now-60000;
 corp.snapshot=()=>({...priorSnapshot(),structures:[...priorSnapshot().structures,{id:3,name:'Saved test structure',kind:'Structure',state:'armor_reinforce',timer:new Date(exited).toISOString()}]});
 const exitedAlert=(await read(viewer.session)).corpReinforced.find(event=>event.detail.includes('Saved test structure'));
 assert.ok(exitedAlert.savedKey);
 assert.equal((await markSaved(exitedAlert.savedKey)).status,200);
 assert.ok(!(await read(viewer.session)).corpReinforced.some(event=>event.savedKey===exitedAlert.savedKey));
 assert.ok((await read(owner.session)).corpReinforced.some(event=>event.savedKey===exitedAlert.savedKey));
 corp.snapshot=priorSnapshot;
 assert.deepEqual(feed.couriers,[]);
 assert.deepEqual(feed.fuel,[]);
 const ownerFeed=await read(owner.session);
 assert.ok(ownerFeed.fuel.some(event=>event.estimated));
 assert.ok(!ownerFeed.skills.some(event=>event.estimated));
 const hidden=await request('/api/settings',{session:viewer.session,method:'POST',body:{'home-show-pi':false,'home-show-corpReinforced':false,'home-show-reinforcedDrills':false}});
 assert.equal(hidden.status,200);
 feed=await read(viewer.session);
 assert.deepEqual(feed.pi,[]);
 assert.deepEqual(feed.corpReinforced,[]);
 assert.deepEqual(feed.reinforcedDrills,[]);
 assert.equal(feed.skills.length,1);
 const preferences=await request('/api/settings',{session:viewer.session,method:'POST',body:{'home-show-pi':true,pi:false,'notify-training-ending':false,'corp-structures':false}});
 assert.equal(preferences.status,200);
 feed=await read(viewer.session);
 assert.deepEqual(feed.corpReinforced,[]);
 assert.deepEqual(feed.couriers,[]);
 assert.deepEqual(feed.skills,[]);
 assert.deepEqual(feed.pi,[]);
 db.prepare('UPDATE characters SET user_id=? WHERE id=?').run(viewer.uid,7364);
 db.prepare('INSERT INTO character_groups VALUES(?,?)').run(7364,7363);
 db.prepare("UPDATE snapshots SET data=? WHERE character_id=? AND kind='skills'").run('{"queue":[]}',7363);
 feed=await read(viewer.session);
 assert.deepEqual(feed.skills.map(event=>[event.pilotId,event.title]),[[7363,'Skill queue empty']]);
}));

test('Dashboard market clear is scoped to fulfilled orders on an owned pilot',()=>fixture(async({request,user,db})=>{
 const owner=user(100,'Owner'),member=user(555,'Market pilot'),now=Date.now();
 const history=[{order_id:123,status:'fulfilled',fulfilled_observed:now},{order_id:124,status:'cancelled',fulfilled_observed:now}];
 db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(555,'market',JSON.stringify({history}),now,now+60000);
 const market=async()=>(await(await request('/api/home',{session:member.session})).json()).market;
 const clear=session=>request('/api/home/market/clear',{session,method:'POST',body:{pilotId:555,ids:[123,124]}});
 assert.equal((await market())[0].items[0].id,123);
 assert.equal((await clear(owner.session)).status,404);
 assert.equal((await clear(member.session)).status,200);
 assert.deepEqual(await market(),[]);
 assert.deepEqual(db.prepare("SELECT event_key FROM notification_dismissals").all().map(row=>row.event_key),['dashboard-market:123']);
}));

test('group images and contributor permissions follow group visibility and membership',()=>fixture(async({request,user,db})=>{
 const owner=user(100,'Owner'),member=user(556,'Member');
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
 const body={name:'Ops',mode:'approval',pages:[],rules:[],create_events:true,create_timers:true,image};
 const save=body=>request('/api/admin/groups',{session:owner.session,method:'POST',body});
 assert.equal((await save({...body,image:'data:image/svg+xml;base64,AAAA'})).status,400);
 assert.equal((await save(body)).status,200);
 const {id}=db.prepare("SELECT id FROM access_groups WHERE name='Ops'").get();
 const groupImage=()=>request('/api/groups/'+id+'/image',{session:member.session});
 const imageResponse=await groupImage();
 assert.equal(imageResponse.headers.get('content-type'),'image/png');
 assert.equal(Buffer.from(await imageResponse.arrayBuffer()).toString('base64'),image.split(',')[1]);
 const event={title:'Weekly fleet',kind:'fleet',start:new Date(Date.now()+7200000).toISOString().slice(0,16),audience:'all',recurrence:'weekly'};
 const create=body=>request('/api/corporation/calendar',{session:member.session,method:'POST',body});
 const target={stage:'Shield',type:'Customs Office',stance:'Hostile',ticker:'TEST',detail:'04-LQM - Example'};
 const createTarget=()=>request('/api/timerboard/targets',{session:member.session,method:'POST',body:target});
 assert.equal((await request('/api/admin/service-plugins/timerboard',{session:owner.session,method:'POST',body:{enabled:true}})).status,200);
 assert.equal((await createTarget()).status,403);
 assert.equal((await create(event)).status,403);
 db.prepare("INSERT INTO group_members VALUES(?,?,'approved')").run(id,member.uid);
 assert.equal((await create({...event,recurrence:'daily'})).status,400);
 assert.equal((await create(event)).status,201);
 assert.equal((await createTarget()).status,201);
 const calendar=await(await request('/api/corporation/calendar',{session:member.session})).json();
 assert.equal(calendar.events.find(row=>row.title===event.title).recurrence,'weekly');
 assert.equal((await save({...body,id,create_events:false,create_timers:false,hidden:true})).status,200);
 assert.equal((await groupImage()).status,404);
 assert.equal((await createTarget()).status,403);
 assert.equal((await create(event)).status,403);
}));

test('Den notification polling respects eligibility and the ESI cache without refreshing the full Den snapshot',()=>fixture(async({user,db})=>{
 user(100,'Den pilot');
 user(101,'No Den');
 const paused=user(102,'Paused');
 const now=Date.now(), scope='esi-characters.read_notifications.v1';
 db.prepare('UPDATE characters SET scopes=?').run(JSON.stringify([scope]));
 db.prepare('INSERT INTO page_preferences VALUES(?,?)').run(paused.uid,JSON.stringify({dens:false}));
 const snapshot=db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)');
 for(const [id,rows] of [[100,[{id:500}]], [101,[]], [102,[{id:600}]]])
  snapshot.run(id,'dens',JSON.stringify(rows),now-3600000,now-1);
 const notice={type:'MercenaryDenAttacked',timestamp:new Date(now-1000).toISOString(),text:'itemID: 500'};
 const paths=[];
 const sync=syncService(db,{get:async path=>{paths.push(path);return [notice];}},fakeCat);
 const path='/characters/100/notifications';
 db.prepare('INSERT INTO esi_cache VALUES(?,?,?,?)').run(100,path,'{}',now+1000);
 await sync.tickDenNotifications(now);
 assert.deepEqual(paths,[]);
 await sync.tickDenNotifications(now+1000);
 const saved=db.prepare("SELECT data,updated,expires FROM snapshots WHERE character_id=100 AND kind='dens'").get();
 assert.equal(JSON.parse(saved.data)[0].attack.at,now-1000);
 assert.equal(saved.updated,now-3600000);
 assert.equal(saved.expires,now-1);
 await sync.tickDenNotifications(now+600999);
 assert.deepEqual(paths,[path]);
 await sync.tickDenNotifications(now+601000);
 assert.deepEqual(paths,[path,path]);
 assert.equal(db.prepare('SELECT checked FROM den_notification_checks WHERE character_id=?').get(100).checked,now+601000);
}));

test('members can leave groups they joined manually',()=>fixture(async({request,user,db})=>{
 const owner=user(100,'Owner'),member=user(557,'Member');
 const response=await request('/api/admin/groups',{session:owner.session,method:'POST',body:{name:'Patrol',mode:'auto',discord_notify:true}});
 assert.equal(response.status,200);
 const group=db.prepare("SELECT id,discord_notify FROM access_groups WHERE name='Patrol'").get();
 assert.equal(group.discord_notify,1);
 const post=action=>request('/api/groups/'+group.id+'/'+action,{session:member.session,method:'POST',body:{}});
 assert.equal((await post('leave')).status,404);
 assert.equal((await post('apply')).status,200);
 assert.equal((await post('apply')).status,200);
 assert.equal((await post('leave')).status,200);
 assert.equal(db.prepare('SELECT status FROM group_members WHERE group_id=? AND user_id=?').get(group.id,member.uid),undefined);
}));

test('corp fitting XML batches save valid copies, report individual errors and deduplicate retries',()=>{
 const types={1:{id:1,name:'Rifter',category_id:6,attributes:{}},2:{id:2,name:'Damage Control II',category_id:7,attributes:{}},3:{id:3,name:'Small Gremlin Compact Energy Neutralizer',category_id:7,attributes:{}}};
 const cat={...fakeCat,type:id=>types[id]||null,named:name=>Number(Object.keys(types).find(id=>types[id].name===name))};
 return fixture(async({db,user,request})=>{
  const owner=user(1301,'Owner'),viewer=user(1302,'Member');
  const fit={name:'Corp Rifter',body:'[Rifter, Corp Rifter]\nDamage Control II'};
  const post=fittings=>request('/api/fittings/corporation-import',{session:owner.session,method:'POST',body:{fittings}});
  const mixed=await post([fit,{name:'Bad',body:'[Unknown, Bad]'}]);
  assert.equal(mixed.status,200);
  const mixedResult=await mixed.json();
  assert.equal(mixedResult.imported.length,1);
  assert.equal(mixedResult.errors.length,1);
  assert.equal(mixedResult.errors[0].index,1);
  assert.match(mixedResult.errors[0].error,/Unknown ship/);
  assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,1);
  const first=await(await post([fit])).json(),id=first.imported[0].id;
  assert.equal(db.prepare('SELECT shared FROM documents WHERE id=?').get(id).shared,1);
  assert.equal(db.prepare('SELECT tag FROM document_tags WHERE document_id=?').get(id).tag,'Corp');
  assert.equal((await request('/api/documents/'+id,{session:viewer.session})).status,200);
  assert.equal((await(await post([fit])).json()).imported[0].id,id);
  await request('/api/documents/'+id,{session:owner.session,method:'DELETE',body:{}});
  assert.notEqual((await(await post([fit])).json()).imported[0].id,id);
  const legacy={name:'Legacy neut',body:'[Rifter, Legacy neut]\nSmall Unstable Power Fluctuator I'};
  const legacyResult=await(await post([legacy])).json();
  assert.equal(legacyResult.errors.length,0);
  const savedLegacy=db.prepare('SELECT body FROM documents WHERE id=?').get(legacyResult.imported[0].id);
  assert.match(JSON.parse(savedLegacy.body),/Small Gremlin Compact Energy Neutralizer/);

 },cat);
});

test('outage reconnection recovery clears flags only after a successful token check',()=>fixture(async({user,db})=>{
 const owner=user(100,'Owner'),now=Date.now();
 db.prepare('UPDATE characters SET reconnect=1 WHERE id=100').run();
 db.prepare("INSERT INTO sync_errors VALUES(100,'skills','ESI returned HTTP 503; previous data retained. Next sync will retry.')").run();
 let attempts=0;
 const sync=syncService(db,{token:async()=>{if(++attempts===1)throw Error('Still unavailable');return 'verified';}},fakeCat);
 await sync.tickReconnects(now);
 assert.equal(db.prepare('SELECT reconnect FROM characters WHERE id=100').get().reconnect,1);
 await sync.tickReconnects(now+1000);
 assert.equal(attempts,1);
 await sync.tickReconnects(now+300000);
 assert.equal(db.prepare('SELECT reconnect FROM characters WHERE id=100').get().reconnect,0);
 assert.equal(db.prepare('SELECT status FROM jobs WHERE character_id=100').get().status,'queued');
 assert.ok(owner.uid);
}));


test('installation setup is owner controlled, preserves live corporation identity and never returns secrets',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),admin=user(901,'Admin'),member=user(902,'Member');
 db.prepare('UPDATE users SET admin=1 WHERE id=?').run(admin.uid);
 assert.equal((await request('/api/admin/installation',{session:member.session})).status,403);
 const read=await(await request('/api/admin/installation',{session:owner.session})).json();
 assert.equal(read.settings.corporationId,668298004);assert.equal(read.owner,100);
 assert.ok(!JSON.stringify(read).includes('ab'.repeat(32)));
 const body={...read.settings,siteName:'Test Tools'};
 assert.equal((await request('/api/admin/installation',{session:admin.session,method:'POST',body})).status,403);
 assert.equal((await request('/api/admin/installation',{session:owner.session,method:'POST',body})).status,200);
 const publicSite=await(await request('/api/installation/public')).json();assert.equal(publicSite.siteName,'Test Tools');assert.deepEqual(Object.keys(publicSite).sort(),['corporationId','siteName']);
 db.prepare('INSERT INTO corp_snapshots VALUES(?,?,?)').run(668298004,'[]',Date.now());
 assert.equal((await request('/api/admin/installation',{session:owner.session,method:'POST',body:{...body,corporationId:999}})).status,409);
 assert.equal(JSON.parse(db.prepare('SELECT data FROM installation_settings').get().data).corporationId,668298004);
 for(let i=0;i<2;i++)assert.equal((await request('/api/admin/installation/groups',{session:owner.session,method:'POST',body:{}})).status,200);
 assert.equal(db.prepare("SELECT count(*) n FROM access_groups WHERE name IN ('Members','Leadership')").get().n,2);
 assert.equal(db.prepare("SELECT pages FROM access_groups WHERE name='Leadership'").get().pages,'[]');
 const members=db.prepare("SELECT id,mode FROM access_groups WHERE name='Members'").get();assert.equal(members.mode,'auto');
 assert.equal((await request('/api/groups/'+members.id+'/apply',{session:member.session,method:'POST',body:{}})).status,200);
}));

test('announcements respect approved groups, expiry, personal reads and deleted group privacy',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),member=user(903,'Member'),other=user(904,'Other');
 const gid=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Readers','x','','approval','[]','[]')").run().lastInsertRowid);
 db.prepare('INSERT INTO group_members VALUES(?,?,?)').run(gid,member.uid,'approved');
 db.prepare('INSERT INTO group_members VALUES(?,?,?)').run(gid,other.uid,'pending');
 const body={title:'Notice <script>',body:'Private message',audience:'group',groupId:gid,expires:Date.now()+3600000};
 assert.equal((await request('/api/admin/announcements',{session:member.session,method:'POST',body})).status,403);
 const created=await request('/api/admin/announcements',{session:owner.session,method:'POST',body});assert.equal(created.status,200);const {id}=await created.json();
 const home=async session=>(await(await request('/api/home',{session})).json()).announcements;
 assert.equal((await home(member.session)).length,1);assert.equal((await home(other.session)).length,0);
 assert.equal((await request('/api/home/announcements/'+id+'/read',{session:other.session,method:'POST',body:{}})).status,404);
 assert.equal((await request('/api/home/announcements/'+id+'/read',{session:member.session,method:'POST',body:{}})).status,200);
 assert.equal((await home(member.session)).length,0);
 db.prepare('DELETE FROM announcement_reads').run();db.prepare('DELETE FROM access_groups WHERE id=?').run(gid);
 assert.equal((await home(member.session)).length,0);
 const everyone=await(await request('/api/admin/announcements',{session:owner.session,method:'POST',body:{...body,audience:'all'}})).json();
 assert.equal((await home(member.session)).length,1);assert.equal((await home(other.session)).length,1);
 db.prepare('UPDATE announcements SET expires=? WHERE id=?').run(Date.now()-1,everyone.id);
 assert.equal((await home(member.session)).length,0);
}));

test('audit logs successful changes without bodies and rejects member reads',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),member=user(905,'Member');
 const body={title:'Audit notice',body:'SECRET-BODY-MUST-NOT-BE-IN-AUDIT',audience:'all',expires:Date.now()+3600000};
 assert.equal((await request('/api/admin/announcements',{session:member.session,method:'POST',body})).status,403);
 assert.equal(db.prepare('SELECT count(*) n FROM audit_events').get().n,0);
 assert.equal((await request('/api/admin/announcements',{session:owner.session,method:'POST',body})).status,200);
 const rows=db.prepare('SELECT * FROM audit_events').all();assert.equal(rows.length,1);assert.equal(rows[0].actor,'Owner');assert.equal(rows[0].action,'Announcement changed');
 assert.ok(!JSON.stringify(rows).includes(body.body));
 assert.equal((await request('/api/admin/audit',{session:member.session})).status,403);
 assert.equal((await(await request('/api/admin/audit?q=Announcement',{session:owner.session})).json()).rows.length,1);
}));

test('Dashboard action list isolates pilot problems and administrator queues',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),member=user(906,'Member'),other=user(907,'Other');
 db.prepare('UPDATE characters SET reconnect=1 WHERE id=906').run();
 const gid=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Approvals','x','','approval','[]','[]')").run().lastInsertRowid);
 db.prepare('INSERT INTO group_members VALUES(?,?,?)').run(gid,member.uid,'pending');
 const home=async session=>(await(await request('/api/home',{session})).json()).needsAction;
 const mine=await home(member.session);assert.ok(mine.some(row=>row.title.includes('reconnection')));assert.ok(!mine.some(row=>row.title.includes('group request')));
 assert.ok(!(await home(other.session)).some(row=>row.title.includes('reconnection')));
 assert.ok((await home(owner.session)).some(row=>row.title.includes('group request')));
 db.prepare('INSERT INTO page_preferences VALUES(?,?)').run(member.uid,JSON.stringify({'home-show-needsAction':false}));
 assert.deepEqual(await home(member.session),[]);
}));

test('a generic installation uses its configured corporation in branding, whitelist and group rules',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner');
 assert.equal(db.prepare('SELECT corporation_id FROM login_whitelist').get().corporation_id,99001);
 assert.equal(db.prepare('SELECT count(*) n FROM login_whitelist').get().n,1);
 const me=await(await request('/api/me',{session:owner.session})).json();assert.equal(me.installation.corporationId,99001);assert.equal(me.installation.siteName,'Example Tools');
 const response=await request('/api/admin/groups',{session:owner.session,method:'POST',body:{name:'Corp Members',mode:'restricted',rules:[{kind:'corporation',id:668298004}]}});
 assert.equal(response.status,200);
 const rules=JSON.parse(db.prepare("SELECT rules FROM access_groups WHERE name='Corp Members'").get().rules);assert.equal(rules[0].id,99001);
},fakeCat,{corporationId:99001,corporationName:'Example Corp',siteName:'Example Tools',corporationTicker:'EX',allianceTicker:'',membershipLookup:async()=>({corporation_id:99001})}));


test('an unconnected installation applies corporation and whitelist changes only after restart',()=>fixture(async({db,user,request})=>{
 user(100,'Owner');
 const {installationStore}=await import('../lib/installation.mjs');
 const running={owner:100},settings=installationStore(db,running),old=settings.read();
 const changed=settings.save({...old,corporationId:99002,corporationName:'New Corp',ticker:'NEW',allianceTicker:''});
 assert.equal(changed.restartRequired,true);assert.equal(running.corporationId,old.corporationId);
 assert.ok(db.prepare('SELECT 1 FROM login_whitelist WHERE corporation_id=?').get(old.corporationId));
 assert.equal((await request('/auth/login')).status,503);
 const restarted={owner:100};installationStore(db,restarted);
 assert.equal(restarted.corporationId,99002);
 assert.ok(db.prepare('SELECT 1 FROM login_whitelist WHERE corporation_id=99002').get());
 assert.equal(db.prepare('SELECT 1 FROM login_whitelist WHERE corporation_id=?').get(old.corporationId),undefined);
}));


test('admins edit announcements in place and only content changes reset personal reads',()=>fixture(async({db,user,request})=>{
 const owner=user(100,'Owner'),member=user(920,'Reader');
 const body={title:'Original',body:'Message',audience:'all',expires:Date.now()+3600000};
 const created=await(await request('/api/admin/announcements',{session:owner.session,method:'POST',body})).json(),id=created.id;
 const edit=(payload,session=owner.session)=>request('/api/admin/announcements/'+id,{session,method:'POST',body:payload});
 const read=()=>request('/api/home/announcements/'+id+'/read',{session:member.session,method:'POST',body:{}});
 assert.equal((await read()).status,200);
 assert.equal((await edit({...body,title:'Forbidden'},member.session)).status,403);
 assert.equal(db.prepare('SELECT title FROM announcements WHERE id=?').get(id).title,'Original');
 assert.equal((await edit({...body,expires:body.expires+3600000})).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM announcement_reads WHERE announcement_id=?').get(id).n,1);
 assert.equal((await edit({...body,title:'Updated',body:'New message'})).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM announcements').get().n,1);
 assert.equal(db.prepare('SELECT count(*) n FROM announcement_reads WHERE announcement_id=?').get(id).n,0);
 assert.equal(db.prepare('SELECT title FROM announcements WHERE id=?').get(id).title,'Updated');
 const feed=await(await request('/api/home',{session:member.session})).json();assert.equal(feed.announcements[0].title,'Updated');
 assert.equal((await edit({...body,expires:Date.now()-1})).status,400);
 assert.equal((await request('/api/admin/announcements/99999',{session:owner.session,method:'POST',body})).status,404);
 const group=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Private notice','x','','approval','[]','[]')").run().lastInsertRowid);
 assert.equal((await edit({...body,audience:'group',groupId:group})).status,200);
 assert.equal((await(await request('/api/home',{session:member.session})).json()).announcements.length,0);
}));


test('Installation Setup has a personal visibility toggle while Users stays visible',()=>fixture(async({user,request})=>{
 const owner=user(100,'Owner'),other=user(921,'Other');
 const settings=await(await request('/api/settings',{session:owner.session})).json();
 assert.equal(settings.admin_pages['admin-installation'],'Installation Setup');assert.equal(settings.admin_pages['admin-users'],undefined);
 assert.equal((await request('/api/settings',{session:owner.session,method:'POST',body:{'admin-installation':false}})).status,200);
 assert.equal((await(await request('/api/me',{session:owner.session})).json()).preferences['admin-installation'],false);
 assert.equal((await(await request('/api/me',{session:other.session})).json()).preferences['admin-installation'],undefined);
 assert.equal((await request('/api/admin/installation',{session:owner.session})).status,200);
 assert.equal((await request('/api/settings',{session:owner.session,method:'POST',body:{'admin-users':false}})).status,400);
 const {adminNav}=await import('../public/settings-options.mjs');assert.equal(adminNav.at(-1)[0],'admin-audit');
}));


test('announcement visibility moves to corporation settings without widening publishing access',()=>fixture(async({user,request})=>{
 const owner=user(100,'Owner'),member=user(922,'Member');
 const settings=await(await request('/api/settings',{session:owner.session})).json();
 assert.equal(settings.corporate_pages['admin-announcements'],'Announcements');assert.equal(settings.admin_pages['admin-announcements'],undefined);
 const other=await(await request('/api/settings',{session:member.session})).json();assert.equal(other.corporate_pages['admin-announcements'],undefined);
 assert.equal((await request('/api/admin/announcements',{session:member.session})).status,403);
 assert.equal((await request('/api/settings',{session:owner.session,method:'POST',body:{'admin-announcements':false}})).status,200);
 const {adminNav}=await import('../public/settings-options.mjs');assert.ok(!adminNav.some(([id])=>id==='admin-announcements'));assert.equal(adminNav.at(-1)[0],'admin-audit');
}));


test('Logistics approval group gates courier queues and admins alone control routes and rates',()=>fixture(async({db,user,request,corp})=>{
 const owner=user(100,'Owner'),pilot=user(951,'Pilot'),hauler=user(952,'Hauler');
 const call=(path,who,body)=>request(path,{session:who.session,...(body?{method:'POST',body}:{})});
 const enable=enabled=>call('/api/admin/service-plugins/logistics',owner,{enabled});
 assert.equal((await call('/api/logistics',pilot)).status,403);
 assert.equal((await enable(true)).status,200);
 const group=db.prepare("SELECT review_group FROM service_plugin_settings WHERE plugin='logistics'").get().review_group;
 assert.equal(db.prepare('SELECT mode FROM access_groups WHERE id=?').get(group).mode,'approval');
 assert.ok((await(await call('/api/groups',pilot)).json()).some(g=>g.id===group));
 assert.equal((await call('/api/logistics/settings',hauler)).status,403);
 assert.equal((await call('/api/logistics/pending',pilot)).status,403);
 assert.equal((await call('/api/groups/'+group+'/apply',hauler,{})).status,200);
 assert.equal(db.prepare('SELECT status FROM group_members WHERE group_id=? AND user_id=?').get(group,hauler.uid).status,'pending');
 assert.equal((await call('/api/logistics/pending',hauler)).status,403);
 db.prepare("UPDATE group_members SET status='approved' WHERE group_id=? AND user_id=?").run(group,hauler.uid);
 assert.equal((await call('/api/logistics/settings',hauler)).status,403);
 assert.equal((await request('/api/logistics')).status,401);
 assert.equal((await request('/api/logistics/pending')).status,401);
 const settings={locations:[{name:'Jita 4-4',pickup:true,destination:false},{name:'Big Docky',pickup:false,destination:true}],maxVolumes:{nullsec:350000,lowsec:100000,empire:200000},pricePerM3:2.5,collateralPerM3:10};
 assert.equal((await call('/api/logistics/settings',hauler,settings)).status,403);
 assert.equal((await call('/api/logistics/settings',owner,settings)).status,200);
 const haul={from:'Jita 4-4',to:'Big Docky',space:'nullsec',volume:100.5,collateral:1};
 assert.equal((await call('/api/service-plugins/logistics',pilot,{...haul,from:'Elsewhere'})).status,400);
 assert.equal((await call('/api/service-plugins/logistics',pilot,{...haul,space:'lowsec',volume:100001})).status,400);
 assert.equal((await call('/api/service-plugins/logistics',pilot,haul)).status,201);
 const mine=await(await call('/api/service-plugins/logistics',pilot)).json();
 assert.equal(mine.requests[0].details.collateral,1005);assert.equal(mine.requests[0].details.estimatedFee,252);
 assert.equal((await(await call('/api/service-plugins/logistics?view=queue',hauler)).json()).requests.length,1);
 corp.contracts=async()=>({updated:Date.now(),contracts:[{contract_id:1,type:'courier',assignee_id:668298004,status:'outstanding',date_expired:'2099-01-01',volume:100,reward:500,collateral:1000,issuer_id:3,start_location_id:4,end_location_id:5},{contract_id:2,type:'courier',assignee_id:668298004,status:'in_progress',acceptor_id:6},{contract_id:3,type:'item_exchange',assignee_id:668298004,status:'outstanding'},{contract_id:4,type:'courier',assignee_id:123,status:'outstanding'}],names:{3:'Sender',6:'Hauler'},locations:{4:'Jita',5:'Staging'}});
 const pending=await(await call('/api/logistics/pending',hauler)).json();assert.deepEqual(pending.contracts.map(r=>r.id),[1,2]);assert.equal(pending.contracts[0].issuer,'Sender');
 db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(group,hauler.uid);
 assert.equal((await call('/api/logistics/pending',hauler)).status,403);
 assert.equal((await enable(false)).status,200);assert.equal((await call('/api/logistics',owner)).status,403);
 assert.ok(!(await(await call('/api/groups',pilot)).json()).some(g=>g.id===group));
 assert.equal((await enable(true)).status,200);assert.equal(db.prepare("SELECT review_group FROM service_plugin_settings WHERE plugin='logistics'").get().review_group,group);
 assert.deepEqual((await(await call('/api/logistics',pilot)).json()).settings,settings);
}));


test('Logistics courier claims are exclusive, completion is owned and ESI verification remains distinct',()=>fixture(async({db,user,request,corp})=>{
 const owner=user(100,'Owner'),a=user(971,'Hauler A'),b=user(972,'Hauler B'),outsider=user(973,'Other');
 const post=(path,who,body)=>request(path,{session:who.session,method:'POST',body});
 await post('/api/admin/service-plugins/logistics',owner,{enabled:true});
 const group=db.prepare("SELECT review_group FROM service_plugin_settings WHERE plugin='logistics'").get().review_group;
 for(const who of [a,b])db.prepare('INSERT INTO group_members VALUES(?,?,?)').run(group,who.uid,'approved');
 let status='outstanding';corp.contracts=async()=>({updated:Date.now(),contracts:[{contract_id:771,type:'courier',assignee_id:668298004,status,start_location_id:1,end_location_id:2,reward:500000,date_expired:'2099-01-01'}],locations:{1:'Actual pickup',2:'Actual drop'}});
 const settings={locations:[{name:'Pickup',locationId:1,pickup:true,destination:true},{name:'Drop',locationId:2,pickup:true,destination:true}],maxVolumes:{nullsec:350000,lowsec:350000,empire:350000},pricePerM3:999,collateralPerM3:0,pricingMode:'isotopes',routes:[{from:'Pickup',to:'Drop',isotopes:1000,isotopePrice:500}]};
 assert.equal((await post('/api/logistics/settings',owner,settings)).status,200);
 const path='/api/logistics/couriers/771',list=async who=>(await(await request('/api/logistics/pending',{session:who.session})).json()).contracts;
 assert.equal((await list(a))[0].expectedReward,500000);
 assert.equal((await post(path,outsider,{action:'claim'})).status,403);
 const claims=await Promise.all([post(path,a,{action:'claim'}),post(path,b,{action:'claim'})]);assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
 const winner=claims[0].status===200?a:b,other=winner===a?b:a;
 assert.equal((await post(path,other,{action:'complete'})).status,409);
 assert.equal((await post(path,winner,{action:'release'})).status,200);
 assert.equal((await post(path,other,{action:'claim'})).status,200);
 assert.equal((await post(path,other,{action:'complete'})).status,200);
 let row=(await list(other))[0];assert.equal(row.workflowStatus,'completed');assert.equal(row.verified,false);assert.equal(row.completedBy,other===a?'Hauler A':'Hauler B');
 assert.equal((await post(path,winner,{action:'claim'})).status,409);
 status='finished';row=(await list(other))[0];assert.equal(row.verified,true);assert.equal(row.workflowStatus,'completed');
 assert.equal((await post('/api/logistics/couriers/999',a,{action:'claim'})).status,404);
}));


test('Logistics location search is admin-only and uses corporation snapshots plus known courier locations',()=>fixture(async({db,user,request,corp})=>{
 const owner=user(100,'Owner'),member=user(981,'Member');
 await request('/api/admin/service-plugins/logistics',{session:owner.session,method:'POST',body:{enabled:true}});
 corp.snapshot=()=>({updated:123,structures:[{id:1000000000081,name:'Example - Docking Structure',system:'Example',kind:'Structure',type_name:'Keepstar'}]});
 assert.equal((await request('/api/logistics/locations?q=Example',{session:member.session})).status,403);
 assert.equal((await request('/api/logistics/locations?q=x',{session:owner.session})).status,400);
 const data=await(await request('/api/logistics/locations?q=Example',{session:owner.session})).json();assert.equal(data.results[0].id,1000000000081);assert.equal(data.results[0].name,'Example - Docking Structure');assert.equal(data.structuresUpdated,123);
 const station=await(await request('/api/logistics/locations?q=Jita%204-4',{session:owner.session})).json();assert.ok(station.results.some(r=>r.id===60003760));
 db.prepare('INSERT INTO public_cache VALUES(?,?,?)').run('/tools/corp-data/contracts',JSON.stringify({locations:{1000000000082:'Example Courier Citadel'}}),Date.now()+3600000);
 const cached=await(await request('/api/logistics/locations?q=Courier',{session:owner.session})).json();assert.ok(cached.results.some(r=>r.id===1000000000082));
 await request('/api/admin/service-plugins/logistics',{session:owner.session,method:'POST',body:{enabled:false}});
 assert.equal((await request('/api/logistics/locations?q=Example',{session:owner.session})).status,403);
}));
