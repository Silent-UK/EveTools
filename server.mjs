import {runtimeConfig} from './lib/runtime-config.mjs';
import {installationStore} from './lib/installation.mjs';
import {communityWorkspace,auditMiddleware} from './lib/community-workspace.mjs';
import {dashboardAttacks} from './lib/dashboard-attacks.mjs';
import {eveServerStatus} from './lib/eve-server-status.mjs';
import {homeFeed,savedStructureKey,fulfilledMarketOrder} from './lib/home-feed.mjs';
import {PROJECT_SCOPE,projectsForPilot} from './lib/corp-projects.mjs';
import {homePluginEvents} from './lib/home-plugin-events.mjs';
import {servicePluginRoutes} from './lib/service-plugins.mjs';
import {shipReplacement} from './lib/ship-replacement.mjs';
import {timerboardRoutes} from './lib/timerboard.mjs';
import {operationCalendar} from './lib/operation-calendar.mjs';
import {corporationAttention} from './lib/corp-attention.mjs';
import {regionForSystem} from './lib/moon-scan-upload.mjs';
import systemNames from './lib/system-names.json' with {type:'json'};
import {safetyInventory} from './lib/asset-safety.mjs';
import {groupEnrolmentService} from './lib/group-enrolment.mjs';
import {recruitMembershipService} from './lib/recruit-membership.mjs';
import {documentLibraryRoutes,skillEvidence} from './lib/document-library.mjs';
import {characterDashboard} from './lib/character-dashboard.mjs';
import {personalAlerts} from './public/personal-alerts.mjs';
import {pilotAssetSearch} from './lib/pilot-asset-search.mjs';
import {sitePagesStore,sitePageRoutes,visibleSitePages} from './lib/site-pages.mjs';
import {usersReviewService} from './lib/users-review.mjs';
import {discordService,discordRoutes} from './lib/discord.mjs';
import {discordPublishing} from './lib/discord-publishing.mjs';
import {recruitmentService,recruitmentRoutes} from './lib/recruitment.mjs';
import {recruitAccount,restrictedRecruitPath,recruitInspectPath,recruitLinksHidden} from './lib/recruitment-store.mjs';
import {whitelistRoutes} from './lib/whitelist-routes.mjs';
import {materialRoutes} from './lib/material-routes.mjs';
import {fittingWorkbenchRoutes} from './lib/fitting-workbench-routes.mjs';
import {wipeAccount,removePilotWhitelist} from './lib/accounts.mjs';
import {isSiteAdmin} from './lib/admin.mjs';
import {fittingImportRoutes} from './lib/fitting-import-routes.mjs';
import {managementRoutes} from './lib/management-routes.mjs';
import {managementStore,preferences,syncEnabled,grants,groupCanContribute,CORPORATE_PAGES} from './lib/management.mjs';
import miningRecipes from './lib/mining-recipes.json' with {type:'json'};
import {whitelistService,characterAffiliation} from "./lib/whitelist.mjs";
import {industrySlotLimits} from "./public/industry-dashboard-model.mjs";
import {assetMatches} from "./public/asset-tree.mjs";
import {corporationService} from "./lib/corp-management.mjs";
import {CORP_SCOPES,STEMP_ID,verifyCorporation} from "./lib/corp.mjs";
import {defaultPISettings,validatePISettings,combinedProduction,combinedVolumes,jitaPricing} from "./lib/pi.mjs";
import {validSubscriptionDate} from "./public/subscription.mjs";
import { fittingView } from "./lib/fitting-view.mjs";
import skillGroups from "./lib/skill-groups.json" with { type: "json" };
import express from "express";
import helmet from "helmet";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import {
  openStore,
  transaction,
  ownedCharacter,
  visibleDocument,
} from "./lib/store.mjs";
import {
  random,
  hash,
  cryptoBox,
  cookies,
  assertOrigin,
} from "./lib/security.mjs";
import { catalog } from "./lib/catalog.mjs";
import { SCOPES, exchange, verifyToken, eveClient } from "./lib/eve.mjs";
import { syncService, piSummary } from "./lib/sync.mjs";
import {
  importSkillText,
  expandPlan,
  comparePlan,
  parseFitting,
  requirements,
} from "./lib/plans.mjs";
export function createApp(config) {
  const db = config.db || openStore(config.data),
    installation=installationStore(db,config),
    cat = config.cat || catalog(config.data),
    box = cryptoBox(config.key),
    eve = config.eve || eveClient(db, box, config),
    sync = syncService(db, eve, cat),
    corp = corporationService(db,box,config,cat,eve);
  managementStore(db);
  sitePagesStore(db);
  const recruitment=recruitmentService(db,eve,cat,config);
  const whitelist=whitelistService(db,config.membershipLookup || (id=>characterAffiliation(eve,id)),id=>eve.publicGet("/corporations/"+id));
  const groupChanged=(...args)=>publishing.queueGroupEvent(...args);
  const groupEnrolment=groupEnrolmentService(db,whitelist,groupChanged);
  const discord=discordService(db,box,config,whitelist,{get corporationId(){return config.corporationId;},lookup:id=>characterAffiliation(eve,id)});
  const usersReview=usersReviewService(db,whitelist,config);
  const recruitMembership=recruitMembershipService(db,whitelist,{onJoined:(user,now)=>db.prepare("UPDATE user_whitelist_reviews SET status='allowed',checked=?,message='Membership confirmed; normal member access' WHERE user_id=?").run(now,user)});
  const ownerUser=db.prepare("SELECT id FROM users WHERE main_id=?").get(config.owner);
  const legacy=db.prepare("SELECT * FROM corporation_connections WHERE corporation_id=?").get(config.corporationId);
  if(ownerUser&&legacy)db.prepare("INSERT OR IGNORE INTO corp_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)").run(ownerUser.id,legacy.character_id,legacy.character_name,legacy.owner_hash,config.corporationId,legacy.tokens,JSON.stringify(["esi-characters.read_corporation_roles.v1"]),0,legacy.role,0);
  db.exec("CREATE TABLE IF NOT EXISTS inspections(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE)");
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "https://images.evetech.net"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.post("/api/admin/groups",express.json({limit:"768kb"}));
  app.use(express.json({ limit: "64kb" }));
  const cookieOptions = {
    httpOnly: true,
    secure: config.base.startsWith("https:"),
    sameSite: "lax",
    path: "/",
  };
  const rate = new Map();
  app.use("/auth", (req, res, next) => {
    const ip = req.socket.remoteAddress,
      now = Date.now(),
      r = rate.get(ip);
    if (r && r.until > now) {
      if (++r.count > 100)
        return res
          .status(429)
          .send("Too many login attempts; try again shortly");
    } else rate.set(ip, { until: now + 60000, count: 1 });
    if (rate.size > 10000) rate.clear();
    next();
  });
  app.use((req, res, next) => {
    const session = cookies(req).tools_session;
    req.session = session
      ? db
          .prepare(
            "SELECT s.*,u.name,u.main_id,u.admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?",
          )
          .get(hash(session), Date.now())
      : null;
    if (req.path.toLowerCase().startsWith("/api") || req.path.toLowerCase().startsWith("/auth"))
      res.set("Cache-Control", "no-store");
    next();
  });
  app.get(/^\/([A-Za-z][A-Za-z0-9_-]{0,59})$/, async(req,res,next)=>{const slug=req.params[0];if(['recruit','health'].includes(slug.toLowerCase()))return next();const link=db.prepare("SELECT url FROM external_links WHERE slug=? COLLATE NOCASE AND slug<>''").get(slug);if(!link)return next();if(req.session){const inspected=db.prepare('SELECT target_id FROM inspections WHERE session_id=?').get(req.session.id);if(inspected&&recruitAccount(db,inspected.target_id))return res.status(403).send('Links are available to members only.');if(recruitAccount(db,req.session.user_id)){try{await whitelist.check(req.session.main_id);}catch(error){return res.status(error.status||503).send('Links are available to members only.');}}}return res.redirect(302,link.url);});
  app.post('/api/inspect', (req,res)=>{
    if(!req.session)return res.sendStatus(401);
    if(!recruitment.canReview(req.session))return res.sendStatus(403);
    try{assertOrigin(req,config.base);}catch{return res.sendStatus(403);}
    if(!req.is('application/json'))return res.sendStatus(415);
    if(req.body.exit===true){db.prepare('DELETE FROM inspections WHERE session_id=?').run(req.session.id);return res.json({ok:true});}
    const target=db.prepare('SELECT id,main_id FROM users WHERE id=?').get(Number(req.body.user_id)||0);
    if(!target)return res.sendStatus(404);
    if(!recruitment.canInspect(req.session,target.id))return res.sendStatus(403);
    if(target.main_id===config.owner)return res.status(400).json({error:'Already viewing your own account'});
    db.prepare('INSERT INTO inspections VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET target_id=excluded.target_id').run(req.session.id,target.id);
    res.json({ok:true});
  });
  app.get('/api/installation/public',(_req,res)=>res.json({siteName:config.siteName,corporationId:config.corporationId}));
  const serverStatus=eveServerStatus(config.statusNetwork||fetch);
  app.get('/api/eve-status',async(_req,res)=>res.json(await serverStatus.read()));
  app.use(async(req,res,next)=>{
    const path=req.path.toLowerCase();
    if(!req.session || !(path.startsWith('/api/')||path.startsWith('/auth/')) || path==='/api/logout')return next();
    try {const membership=await whitelist.check(req.session.main_id,false,{allowGrace:true});req.loginCorporation=membership;if(membership!==null)recruitMembership.verified(req.session.user_id,req.session.main_id);
      if(path.startsWith('/api/'))db.prepare('INSERT INTO user_activity VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen WHERE user_activity.last_seen<excluded.last_seen-60000').run(req.session.user_id,Date.now());
      next();}
    catch(e) {
      if(e.status===403&&recruitAccount(db,req.session.user_id)){req.recruit=true;if(restrictedRecruitPath(path))return next();return res.status(403).json({error:'Recruit accounts can connect and sync their own pilots; member pages require normal membership access.'});}
      if(e.status===403){db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.session.user_id);res.clearCookie('tools_session',cookieOptions);}
      if(path.startsWith('/api/'))return res.status(e.status).json({error:e.message});
      res.status(e.status).type('text').send(e.message);
    }
  });
  app.use((req,res,next)=>{
    if(!req.session)return next();
    const target=db.prepare('SELECT u.* FROM inspections i JOIN users u ON u.id=i.target_id WHERE i.session_id=?').get(req.session.id);
    if(!target)return next();
    if(!recruitment.canInspect(req.session,target.id)){db.prepare('DELETE FROM inspections WHERE session_id=?').run(req.session.id);return next();}
    if(req.path.toLowerCase()==='/auth'||req.path.toLowerCase().startsWith('/auth/'))return res.status(403).send('Exit Inspect before connecting characters.');
    if(req.path.toLowerCase().startsWith('/api')&&!['GET','HEAD'].includes(req.method))return res.status(403).json({error:'Inspect is read-only. Exit Inspect to make changes.'});
    const recruitmentOnly=!isSiteAdmin(req.session,config.owner);
    if(recruitmentOnly&&req.path.toLowerCase().startsWith('/api')&&!recruitInspectPath(req.path.toLowerCase()))return res.status(403).json({error:'Recruitment inspection is limited to applicant-owned character data.'});
    req.inspect={name:target.name,main_id:target.main_id,recruitment_only:recruitmentOnly};
    req.session={...req.session,user_id:target.id,name:target.name,main_id:target.main_id,admin:0};
    next();
  });
  app.get("/health", (_req, res) => res.json({ ok: true, version: "1.0.0-demo.1" }));
  app.use((req,res,next)=>{if(config.corporationId!==installation.read().corporationId&&(req.path.startsWith('/api/corporation')||req.path==='/auth/login'||req.path==='/auth/callback'))return res.status(503).json({error:'Restart Tools to activate the saved corporation identity before connecting or syncing.'});next();});
  app.get("/auth/login", (req, res) => {
    if (!config.client || !config.secret)
      return res.status(503).send("EVE login is not configured yet.");
    const corporation=req.query.corporation === "1",mining=req.query.mining === "1",projects=corporation&&(req.query.projects==='1'||JSON.parse(db.prepare("SELECT scopes FROM corp_authorizations WHERE user_id=?").get(req.session?.user_id??null)?.scopes||"[]").includes(PROJECT_SCOPE));
    if(mining && (!req.session||corporation))return res.sendStatus(400);
    const miningCharacter=mining?ownedCharacter(db,req.session.user_id,req.query.character):null;
    if(corporation && !req.session)return res.sendStatus(401);
    const linking = corporation || mining || req.query.link === "1";
    const recruit=req.query.recruit==='1';
    if(recruit&&(linking||req.query.consent!=='1'))return res.status(400).send('Read and accept the recruitment inspection notice before signing up.');
    if (linking && !req.session)
      return res
        .status(401)
        .send("Sign in with your main before linking an alt.");
    const groupMode = linking ? req.query.group : null;
    let groupParent = null;
    if(groupMode != null) {
      if(!["main","alt"].includes(groupMode))return res.status(400).send("Choose Main or Alt");
      if(groupMode === "alt") {
        const parent=ownedCharacter(db,req.session.user_id,req.query.parent);
        const parentId=db.prepare("SELECT parent_id FROM character_groups WHERE character_id=?").get(parent.id)?.parent_id || req.session.main_id;
        if(parentId!==parent.id)return res.status(400).send("Choose a main character for this alt");
        groupParent=parent.id;
      }
    }
    const state = random(),
      browser = random(),
      verifier = random();
    db.prepare("DELETE FROM oauth WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO oauth VALUES(?,?,?,?,?,?)").run(
      hash(state),
      hash(browser),
      linking ? req.session.user_id : null,
      recruit?'recruit':projects?'corp-projects':null,
      verifier,
      Date.now() + 600000,
    );
    if(mining)db.prepare("INSERT INTO oauth_mining VALUES(?,?)").run(hash(state),miningCharacter.id);
    if(corporation)db.prepare("INSERT INTO oauth_corporations VALUES(?)").run(hash(state));
    if(groupMode)db.prepare("INSERT INTO oauth_character_groups VALUES(?,?,?)").run(hash(state),groupMode,groupParent);
    res.cookie("tools_oauth", browser, { ...cookieOptions, maxAge: 600000 });
    const url = new URL("https://login.eveonline.com/v2/oauth/authorize");
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: config.client,
      redirect_uri: config.base + "/auth/callback",
      scope: (projects?[...CORP_SCOPES,PROJECT_SCOPE,'esi-universe.read_structures.v1']:corporation?CORP_SCOPES:SCOPES).join(" "),
      state,
      code_challenge: Buffer.from(hash(verifier), "hex").toString("base64url"),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(k, v);
    res.redirect(url.href);
  });
  app.get("/auth/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "",
      browser = cookies(req).tools_oauth || "";
    const flow = db
      .prepare("SELECT * FROM oauth WHERE state=? AND browser=? AND expires>?")
      .get(hash(state), hash(browser), Date.now());
    if (!flow)
      return res.status(400).send("Login expired or invalid. Start again.");
    const corporation=!!db.prepare("SELECT 1 FROM oauth_corporations WHERE state=?").get(hash(state));
    if(corporation && !req.session)return res.sendStatus(401);
    const miningFlow=db.prepare("SELECT character_id FROM oauth_mining WHERE state=?").get(hash(state));
    const grouping=db.prepare("SELECT mode,parent_id FROM oauth_character_groups WHERE state=?").get(hash(state));
    db.prepare("DELETE FROM oauth WHERE state=?").run(hash(state));
    res.clearCookie("tools_oauth", cookieOptions);
    if (flow.user_id && req.session?.user_id !== flow.user_id)
      return res
        .status(403)
        .send("The account linking session changed. Sign in again.");
    if (typeof req.query.code !== "string")
      return res.status(400).send("EVE login was cancelled.");
    const token = await (config.exchange || exchange)(config, {
        grant_type: "authorization_code",
        code: req.query.code,
        code_verifier: flow.verifier,
        redirect_uri: config.base + "/auth/callback",
      }),
      id = await (config.verifyToken || verifyToken)(
        token.access_token,
        config.client,
        corporation&&flow.invite==='corp-projects'?[...CORP_SCOPES,PROJECT_SCOPE,'esi-universe.read_structures.v1']:corporation?CORP_SCOPES:SCOPES,
      );
    if(miningFlow && id.id!==miningFlow.character_id)throw Object.assign(Error('Choose the pilot whose mining access you are connecting.'),{status:403});
    if(corporation) {
      const verifiedCorp=await (config.verifyCorporation||verifyCorporation)(token.access_token,id.id,config.corpNetwork||fetch);
      if(verifiedCorp.id!==config.corporationId||!["CEO","Director"].includes(verifiedCorp.role))throw Object.assign(Error("Corporation Management is for the configured corporation’s CEOs and Directors."),{status:403});
      db.prepare("INSERT INTO corp_authorizations VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET character_id=excluded.character_id,character_name=excluded.character_name,owner_hash=excluded.owner_hash,corporation_id=excluded.corporation_id,tokens=excluded.tokens,scopes=excluded.scopes,expires=excluded.expires,role=excluded.role,verified=excluded.verified").run(req.session.user_id,id.id,id.name,id.owner,verifiedCorp.id,box.seal(token),JSON.stringify(id.scopes),id.expires,verifiedCorp.role,Date.now());
      corp.connected(req.session.user_id);
      const corpInfo=verifiedCorp;
      if(req.session.main_id===config.owner)db.prepare("INSERT INTO corporation_connections VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(corporation_id) DO UPDATE SET name=excluded.name,character_id=excluded.character_id,character_name=excluded.character_name,owner_hash=excluded.owner_hash,tokens=excluded.tokens,verified=excluded.verified,role=excluded.role").run(corpInfo.id,corpInfo.name,id.id,id.name,id.owner,box.seal(token),Date.now(),corpInfo.role);
      if(flow.invite==='corp-projects')db.prepare("UPDATE public_cache SET expires=0 WHERE path='/tools/corp-data/projects'").run();
      return res.redirect(flow.invite==='corp-projects'?'/#corp-projects':"/#corp-structures");
    }
    let memberLogin=false,corporateLogin=false;
    if(!flow.user_id){try{const membership=await whitelist.check(id.id,true);memberLogin=true;corporateLogin=membership!==null;}catch(e){const applicant=db.prepare("SELECT a.status FROM recruitment_applications a JOIN users u ON u.id=a.user_id WHERE u.main_id=? AND a.status NOT IN ('rejected','withdrawn','joined')").get(id.id);if(e.status!==403||!(flow.invite==='recruit'||applicant))throw e;}}
    let automaticCorp=null,automaticDenied=false;
    if(id.scopes.includes('esi-characters.read_corporation_roles.v1')){
      try{
        const verified=await (config.verifyCorporation||verifyCorporation)(token.access_token,id.id,config.corpNetwork||fetch);
        if(verified.id===config.corporationId&&['CEO','Director'].includes(verified.role))automaticCorp=verified;
        else automaticDenied=true;
      }catch(e){if(e.status===403)automaticDenied=true;}
    }
    const user = transaction(db, () => {
      const existing = db
        .prepare("SELECT * FROM characters WHERE id=?")
        .get(id.id);
      if (existing && existing.owner_hash !== id.owner)
        throw Object.assign(
          Error(
            "Character ownership changed. Contact the administrator before linking.",
          ),
          { status: 403 },
        );
      if (flow.user_id && existing && existing.user_id !== flow.user_id)
        throw Object.assign(
          Error("Character is already linked to another Tools account."),
          { status: 409 },
        );
      let uid = flow.user_id;
      if (!uid && existing) {
        const u = db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(existing.user_id);
        if (u.main_id !== id.id)
          throw Object.assign(Error("Sign in with your main character."), {
            status: 403,
          });
        uid = u.id;
      }
      if (!uid) {
        uid = Number(
          db
            .prepare("INSERT INTO users(main_id,name,admin) VALUES(?,?,?)")
            .run(id.id, id.name, id.id === config.owner ? 1 : 0)
            .lastInsertRowid,
        );

      }
      db.prepare(
        "INSERT INTO characters VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,tokens=excluded.tokens,scopes=excluded.scopes,expires=excluded.expires,reconnect=0",
      ).run(
        id.id,
        uid,
        id.name,
        id.owner,
        box.seal(token),
        JSON.stringify(id.scopes),
        id.expires,
      );
      if(flow.user_id && grouping && !existing) {
        const parent=grouping.mode==="main"?id.id:grouping.parent_id;
        if(grouping.mode==="alt") {
          const main=ownedCharacter(db,uid,parent);
          const loginMain=db.prepare("SELECT main_id FROM users WHERE id=?").get(uid).main_id;
          if((db.prepare("SELECT parent_id FROM character_groups WHERE character_id=?").get(main.id)?.parent_id||loginMain)!==main.id)
            throw Object.assign(Error("The selected main changed. Add the character again."),{status:400});
        }
        db.prepare("INSERT INTO character_groups VALUES(?,?)").run(id.id,parent);
      }
      if(flow.invite==='recruit'&&!memberLogin)db.prepare("INSERT OR IGNORE INTO recruitment_applications(user_id,created,consented) VALUES(?,?,?)").run(uid,Date.now(),Date.now());
      return uid;
    });
    if(corporateLogin)recruitMembership.verified(user,id.id);
    const existingProjectGrant=db.prepare('SELECT scopes FROM corp_authorizations WHERE user_id=?').get(user);
    if(automaticCorp && !JSON.parse(existingProjectGrant?.scopes || '[]').includes(PROJECT_SCOPE)){
      const reference=box.seal({linked_character_id:id.id});
      transaction(db,()=>{
        db.prepare("INSERT INTO corp_authorizations VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET character_id=excluded.character_id,character_name=excluded.character_name,owner_hash=excluded.owner_hash,corporation_id=excluded.corporation_id,tokens=excluded.tokens,scopes=excluded.scopes,expires=excluded.expires,role=excluded.role,verified=excluded.verified").run(user,id.id,id.name,id.owner,automaticCorp.id,reference,JSON.stringify(id.scopes),id.expires,automaticCorp.role,Date.now());
        const owner=db.prepare('SELECT main_id FROM users WHERE id=?').get(user);
        if(owner.main_id===config.owner)db.prepare("INSERT INTO corporation_connections VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(corporation_id) DO UPDATE SET name=excluded.name,character_id=excluded.character_id,character_name=excluded.character_name,owner_hash=excluded.owner_hash,tokens=excluded.tokens,verified=excluded.verified,role=excluded.role").run(automaticCorp.id,automaticCorp.name||config.corporationName,id.id,id.name,id.owner,reference,Date.now(),automaticCorp.role);
      });
      corp.connected(user);
    }else if(automaticDenied){
      // An ordinary linked alt must not replace another pilot's valid director grant.
      transaction(db,()=>{
        db.prepare('DELETE FROM corp_authorizations WHERE user_id=? AND character_id=?').run(user,id.id);
        db.prepare('DELETE FROM corporation_connections WHERE character_id=? AND owner_hash=?').run(id.id,id.owner);
      });
      corp.invalidate(user);
    }
    if(flow.user_id || !db.prepare("SELECT 1 FROM snapshots WHERE character_id=? LIMIT 1").get(id.id))sync.queue(user,id.id,true);
    const session = random();
    if (req.session)
      db.prepare("DELETE FROM sessions WHERE id=?").run(req.session.id);
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(session),
      user,
      Date.now() + 7 * 86400000,
    );
    res.cookie("tools_session", session, {
      ...cookieOptions,
      maxAge: 7 * 86400000,
    });
    if(!flow.user_id)db.prepare("INSERT INTO user_logins VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_login=excluded.last_login").run(user,Date.now());
    res.redirect(miningFlow?"/#mining":flow.invite==='recruit'&&!memberLogin?"/Recruit":"/");
  });
  app.use("/api", (req, res, next) => {
    if (!req.session)
      return res
        .status(401)
        .json({ error: "Sign in with your main character" });
    if (!["GET", "HEAD"].includes(req.method)) {
      try {
        assertOrigin(req, config.base);
      } catch (e) {
        return res.status(403).json({ error: e.message });
      }
      if (!req.is("application/json"))
        return res.status(415).json({ error: "Use JSON" });
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Use a JSON object.'});
    }
    next();
  });
  app.use('/api',(req,res,next)=>{if(!req.inspect)groupEnrolment.schedule(req.session.user_id);next();});
  fittingImportRoutes(app,{db,eve,cat});
  fittingWorkbenchRoutes(app,{db,eve,cat,simulate:config.fittingSimulator});
  sitePageRoutes(app,{db,config});
  discordRoutes(app,{discord,config});
  const marketPI=jitaPricing(db,eve,true);
  const services=servicePluginRoutes(app,{db,config,cat,jitaQuotes:marketPI,contracts:()=>corp.contracts({ttl:300000}),structures:()=>corp.snapshot()});
  const servicePluginStates=async req=>({...services.pluginStates(req),timerboard:await timerboard.visible(req)});
  db.exec('CREATE TABLE IF NOT EXISTS contributor_groups (kind TEXT PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE)');
  const contributorGroup=db.prepare('SELECT group_id FROM contributor_groups WHERE kind=?');
  for(const [kind,name,icon,description,pages] of [
   ['timerboard','Timerboard Contributors','◷','Apply to add timers and targets.','[]'],
   ['calendar','Calendar Organisers','▦','Apply to add corporation calendar events.','["corp-calendar"]']
  ])if(!contributorGroup.get(kind))transaction(db,()=>{
   const id=db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES(?,?,?,'approval','[]',?)").run(name,icon,description,pages).lastInsertRowid;
   db.prepare('INSERT INTO contributor_groups VALUES(?,?)').run(kind,id);
  });
  for(const [kind,flag] of [['calendar','create_events'],['timerboard','create_timers']]){
   db.prepare('UPDATE access_groups SET '+flag+'=(id=?) WHERE '+flag+' IS NULL').run(contributorGroup.get(kind).group_id);
  }
  const contributor=(kind,user)=>groupCanContribute(db,user,kind);
  const groupAvailable=(group,req)=>(group.id!==contributorGroup.get('timerboard')?.group_id||services.available(req,'timerboard'))&&(group.id!==services.logisticsGroup()||services.available(req,'logistics'));
  app.use(auditMiddleware(db,installation));
  const srp=shipReplacement(app,{db,cat,eve,config,discord,corp});
  recruitmentRoutes(app,{db,recruitment,config});
  managementRoutes(app,{db,eve,corp,cat,config,whitelist,discord,groupEnrolment,projectsAccess,groupAvailable,groupChanged});
  const community=communityWorkspace(app,{db,config,installation,srp,services,recruitment});
  materialRoutes(app,{db,cat,corp,grants,admin:req=>isSiteAdmin(req.session,config.owner)});
  async function projectsAccess(req) {
   if(req.recruit || req.inspect)return false;
   if(isSiteAdmin(req.session,config.owner))return true;
   if(req.loginCorporation!==null)return req.loginCorporation===config.corporationId;
   let timer;
   try{return await Promise.race([whitelist.corporation(req.session.main_id).then(id=>id===config.corporationId).catch(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),750);})]);}
   finally{clearTimeout(timer);}
  }
  app.get('/api/corporation/projects',async(req,res)=>{
   if(!await projectsAccess(req))return res.status(403).json({error:'Projects are available to corporation members.'});
   const snapshot=await corp.projects();
   res.json({...projectsForPilot(snapshot,req.session.main_id),canConnect:isSiteAdmin(req.session,config.owner)||await corp.access(req.session.user_id)});
  });
  app.get("/api/me", async (req,res)=>{const projects=await projectsAccess(req);const director=req.recruit||req.inspect?.recruitment_only||isSiteAdmin(req.session,config.owner)?false:await corp.access(req.session.user_id),pages=req.recruit||req.inspect?.recruitment_only?[]:grants(db,req.session.user_id).filter(p=>Object.hasOwn(CORPORATE_PAGES,p));res.json({installation:{siteName:config.siteName,corporationId:config.corporationId,corporationName:config.corporationName},pages:visibleSitePages(db,req,config),recruit:Boolean(req.recruit),recruiter:!req.inspect&&recruitment.canReview(req.session),name:req.session.name,main_id:req.session.main_id,srp:srp.available(req),service_plugins:await servicePluginStates(req),inspect:req.inspect||null,admin:isSiteAdmin(req.session,config.owner),owner:req.session.main_id===config.owner,director,corporation:isSiteAdmin(req.session,config.owner)||director||projects||pages.length>0,corporate_pages:isSiteAdmin(req.session,config.owner)||director?Object.keys(CORPORATE_PAGES).filter(page=>page!=='corp-projects'||projects):[...pages.filter(page=>page!=='corp-projects'),...(projects?['corp-projects']:[])],preferences:preferences(db,req.session.user_id),links:recruitLinksHidden(db,req)?[]:db.prepare("SELECT * FROM external_links ORDER BY name").all()});});
  const calendar=operationCalendar(db,corp);
  async function calendarAccess(req){
   const user=req.session.user_id;
   const organiser=isSiteAdmin(req.session,config.owner)||await corp.access(user);
   const allowed=organiser?Object.keys(CORPORATE_PAGES):grants(db,user);
   return {user:req.inspect?null:user,organiser,allowed,canEdit:!req.inspect,contributor:!req.inspect&&!req.recruit&&contributor('calendar',user)};
  }
  const timerboard=timerboardRoutes(app,{member:projectsAccess,canRemoveTimers:req=>isSiteAdmin(req.session,config.owner),canContribute:req=>contributor('timerboard',req.session.user_id),db,services,calendar,calendarAccess,cat,corporationName:config.corporationName,corporationOwner:[config.corporationTicker,config.allianceTicker].filter(Boolean).join('/')});
  const publishing=discordPublishing(app,{db,discord,config,calendar,corp,timerboard,timerboardEnabled:()=>services.available({},'timerboard')});
  function homeCalendar(access,prefs,now,showTimers){
   const allowed=access.allowed.filter(page=>prefs[page]!==false);
   const data=calendar.list(allowed,access.canEdit,now,{...access,mto:prefs.dens!==false});
   data.events=data.events.filter(event=>{
    if(event.manual)return event.audience==='private'||prefs['corp-calendar']!==false;
    return access.organiser||!['fuel','gas'].includes(event.kind);
   });
   if(showTimers)data.events.push(...timerboard.calendarEvents(now));
   data.events.sort((a,b)=>a.starts-b.starts);
   return data;
  }
  app.get('/api/home',async(req,res)=>{
   if(req.recruit||req.inspect?.recruitment_only)return res.sendStatus(403);
   const access=await calendarAccess(req),prefs=preferences(db,req.session.user_id),now=Date.now();
   const showTimers=await timerboard.visible(req,access);
   const calendarData=homeCalendar(access,prefs,now,false);
   const feed=homeFeed(db,req.session.user_id,prefs,calendarData,now);
   feed.attacks=access.allowed.includes('corp-structures')&&prefs['corp-structures']!==false?dashboardAttacks(db,corp.snapshot(),calendarData.events,now):[];
   const timers=showTimers&&prefs['home-show-upcomingTimers']!==false
    ?timerboard.dashboardReinforcements(now,[...feed.reinforcedOffices,...feed.corpReinforced,...feed.reinforcedDrills])
    :[];
   if(showTimers){
    feed.monthCalendar.events.push(...timerboard.calendarEvents(now));
    feed.monthCalendar.events.sort((a,b)=>a.starts-b.starts);
   }
   const pluginEvents=homePluginEvents(db,req,prefs,srp,services,timers,now);
   res.json({...feed,...pluginEvents,...community.dashboard(req,pluginEvents)});
  });
  app.post('/api/home/attacks/clear',async(req,res)=>{
   if(req.recruit||req.inspect)return res.sendStatus(403);
   const access=await calendarAccess(req),prefs=preferences(db,req.session.user_id),now=Date.now();
   if(!access.allowed.includes('corp-structures')||prefs['corp-structures']===false)return res.sendStatus(403);
   const events=dashboardAttacks(db,corp.snapshot(),homeCalendar(access,prefs,now,false).events,now);
   const alert=events.find(event=>event.attackKey===req.body.key);
   if(!alert)return res.sendStatus(404);
   db.prepare('INSERT OR IGNORE INTO dashboard_attack_dismissals VALUES(?,?)').run(alert.attackKey,now);
   res.json({ok:true});
  });
  app.post('/api/home/structures/saved',async(req,res)=>{
   if(req.recruit||req.inspect)return res.sendStatus(403);
   const {key}=req.body;
   if(typeof key!=='string'||!key||key.length>160)return res.sendStatus(400);
   const user=req.session.user_id,access=await calendarAccess(req),now=Date.now();
   const events=homeCalendar(access,preferences(db,user),now,false).events;
   if(!events.some(event=>savedStructureKey(event,now)===key))return res.status(404).json({error:'This structure alert is no longer available to mark as saved.'});
   db.prepare('INSERT OR IGNORE INTO notification_dismissals VALUES(?,?,?)').run(user,key,now);
   res.json({ok:true});
  });
  app.post(['/api/home/completed-contracts/clear','/api/home/market/clear'],(req,res)=>{
   const market=req.path==='/api/home/market/clear';
   if(req.recruit||req.inspect)return res.sendStatus(403);
   const {pilotId,ids}=req.body;
   if(!Number.isSafeInteger(pilotId)||!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>!Number.isSafeInteger(id)||id<=0))
    return res.status(400).json({error:market?'Invalid fulfilled market orders.':'Invalid completed contracts.'});
   const user=req.session.user_id;
   const snapshot=db.prepare("SELECT s.data FROM snapshots s JOIN characters c ON c.id=s.character_id WHERE c.user_id=? AND c.id=? AND s.kind=?").get(user,pilotId,market?'market':'contracts');
   if(!snapshot)return res.sendStatus(404);
   const data=JSON.parse(snapshot.data);
   const available=new Set(market?(data.history||[]).filter(fulfilledMarketOrder).map(order=>order.order_id):
    (data.contracts||[]).filter(c=>['finished','finished_issuer','finished_contractor'].includes(c.status)).map(c=>c.contract_id));
   const keyPrefix=market?'dashboard-market:':'dashboard-contract:';
   const save=db.prepare('INSERT OR IGNORE INTO notification_dismissals VALUES(?,?,?)'),now=Date.now();
   transaction(db,()=>{for(const id of new Set(ids))if(available.has(id))save.run(user,keyPrefix+id,now);});
   res.json({ok:true});
  });
  app.get('/api/calendar',async(req,res)=>{
   if(req.recruit||req.inspect?.recruitment_only)return res.sendStatus(403);
   const access=await calendarAccess(req);
   res.json(homeCalendar(access,preferences(db,req.session.user_id),Date.now(),await timerboard.visible(req,access)));
  });
  app.post('/api/calendar',async(req,res)=>{
   if(req.recruit||req.inspect)return res.sendStatus(403);
   res.status(201).json(calendar.save(req.body,undefined,await calendarAccess(req)));
  });
  app.post('/api/calendar/:id',async(req,res)=>{
   if(req.recruit||req.inspect)return res.sendStatus(403);
   res.json(calendar.save(req.body,Number(req.params.id),await calendarAccess(req)));
  });
  app.delete('/api/calendar/:id',async(req,res)=>{
   if(req.recruit||req.inspect)return res.sendStatus(403);
   res.json(calendar.remove(Number(req.params.id),await calendarAccess(req)));
  });
  app.use("/api/corporation",async(req,res,next)=>{
    const director=isSiteAdmin(req.session,config.owner)?false:await corp.access(req.session.user_id),route=req.path.split('/')[1],required=({calendar:'corp-calendar',overview:'corp-overview',members:'corp-members',pilots:'corp-pilots',assets:'corp-assets','pilot-assets':'corp-search-pilots',wallet:'corp-wallet',standings:'corp-standings',contracts:'corp-contracts',market:'corp-market',blueprints:'corp-blueprints',materials:'corp-industry',industry:'corp-industry',structures:'corp-structures',harvest:'corp-moons',surveys:'corp-surveys'})[route];
    const allowed=director||isSiteAdmin(req.session,config.owner)||(required&&grants(db,req.session.user_id).includes(required));
    if(req.method==='POST'&&req.path==='/sync'){
      if(req.recruit||req.inspect||(!director&&!isSiteAdmin(req.session,config.owner)))
        return res.status(403).json({error:'Corporation sync requires site admin or verified CEO or Director access.'});
      return next();
    }
    const scanImport=req.method==='POST'&&req.path==='/surveys/import';
    if(scanImport&&(req.inspect||req.recruit||!allowed))return res.status(403).json({error:'Moon Survey access is required to add scans.'});
    const calendarWrite=route==='calendar'&&['POST','DELETE'].includes(req.method);
    if(route==='calendar'&&req.method==='GET'&&!allowed&&await timerboard.visible(req)){req.corporationDirector=false;return next();}
    if(req.method==='POST'&&req.path==='/calendar'&&!req.inspect&&!req.recruit&&contributor('calendar',req.session.user_id))return next();
    if(route==='calendar'&&(req.recruit||req.inspect?.recruitment_only||!allowed||
      calendarWrite&&(req.inspect||(!director&&!isSiteAdmin(req.session,config.owner)))))
      return res.status(403).json({error:'You do not have permission for this calendar action.'});
    if(!calendarWrite&&!scanImport&&!director&&(!['GET','HEAD'].includes(req.method)||!required||!allowed))return res.status(403).json({error:"You do not have permission to view this corporation page."});
    req.corporationDirector=director;
    next();
  });
  app.get('/api/corporation/calendar',async(req,res)=>{
   const organiser=isSiteAdmin(req.session,config.owner)||req.corporationDirector;
   const allowed=organiser?Object.keys(CORPORATE_PAGES):grants(db,req.session.user_id);
   const now=Date.now(), access={allowed,organiser,user:req.inspect?null:req.session.user_id,contributor:!req.inspect&&contributor('calendar',req.session.user_id)};
   const data=calendar.list(allowed,(organiser||access.contributor)&&!req.inspect,now,{...access,mto:preferences(db,req.session.user_id).dens!==false});
   if(await timerboard.visible(req,access))data.events.push(...timerboard.calendarEvents(now));
   data.events.sort((a,b)=>a.starts-b.starts);
   res.json(data);
  });
  app.post('/api/corporation/calendar',async(req,res)=>res.status(201).json(calendar.save(req.body,undefined,await calendarAccess(req))));
  app.post('/api/corporation/calendar/:id',(req,res)=>res.json(calendar.save(req.body,Number(req.params.id),{user:req.session.user_id,organiser:true})));
  app.delete('/api/corporation/calendar/:id',(req,res)=>res.json(calendar.remove(Number(req.params.id),{user:req.session.user_id,organiser:true})));
  app.get('/api/corporation/overview',async(req,res)=>{
   const allowed=isSiteAdmin(req.session,config.owner)||req.corporationDirector?Object.keys(CORPORATE_PAGES):grants(db,req.session.user_id);
   res.json({...await corp.overview(),attention:corporationAttention(db,corp,allowed)});
  });
  app.get('/api/corporation/pilots',async(req,res)=>res.json(await corp.pilots()));
  app.get('/api/corporation/pilot-assets',(req,res)=>{if(req.inspect)return res.sendStatus(403);res.json(pilotAssetSearch(db,cat,req.session,config,req.query));});
  app.get('/api/corporation/assets',async(req,res)=>res.json(await corp.assets(req.query)));
  app.get('/api/corporation/contracts',async(req,res)=>res.json(await corp.contracts()));
  app.get('/api/corporation/market',async(req,res)=>res.json(await corp.market()));
  app.get('/api/corporation/blueprints',async(req,res)=>res.json(await corp.blueprints()));
  app.get('/api/corporation/standings',async(req,res)=>res.json(await corp.standings()));
  app.get('/api/corporation/wallet',async(req,res)=>{const wallet=await corp.wallets();srp.reconcileWallet(wallet);res.json(wallet);});
  app.get('/api/corporation/members',async(req,res)=>res.json(await corp.members()));
  app.get("/api/corporation/surveys/browser",async(req,res)=>res.json(await corp.surveys(req.query)));
  app.get("/api/corporation/surveys",(req,res)=>res.json(corp.surveyList(req.query)));
  app.post("/api/corporation/surveys/import",(req,res)=>res.json(corp.submitMoonScan(req.body.scan,req.session.user_id,req.body.save===true)));
  app.get("/api/corporation/industry",(req,res)=>res.json(corp.industrySnapshot()));
  app.get("/api/corporation/harvest",async(req,res)=>res.json(await corp.harvest()));
  app.get("/api/corporation/structures",(req,res)=>{
   const snapshot=corp.snapshot(),hulls=new Map();
   const attributes={HiSlot:14,MedSlot:13,LoSlot:12,RigSlot:1137,ServiceSlot:2056,FighterTube:2216};
   const structures=snapshot.structures.map(row=>{
    if(!row.fitting)return row;
    if(!hulls.has(row.type_id)){
     const dogma=cat.type(row.type_id)?.attributes;
     hulls.set(row.type_id,Object.fromEntries(Object.entries(attributes).map(([slot,id])=>[slot,Math.max(0,Math.min(8,Math.floor(Number(dogma?.[id])||0)))])));
    }
    return {...row,fitting:{...row.fitting,slots:hulls.get(row.type_id)}};
   });
   res.json({...snapshot,structures});
  });
  app.post("/api/corporation/sync",(req,res)=>{corp.queue();res.json({ok:true});});
  app.post("/api/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE id=?").run(req.session.id);
    res.clearCookie("tools_session", cookieOptions);
    res.json({ ok: true });
  });
  app.get("/api/characters", (req, res) => {
    const {user_id:user,main_id:main}=req.session;
    const rows=db.prepare(`SELECT c.id,c.name,c.reconnect,c.scopes,g.parent_id,
      sub.expires_on,training.recurring,training.mct_enabled,training.mct_expires_on,j.status AS job,skill.data AS skills,skill.updated AS skills_updated,
      se.message AS skill_error,json_extract(wallet.data,'$.balance') AS balance
      FROM characters c
      LEFT JOIN character_groups g ON g.character_id=c.id
      LEFT JOIN character_subscriptions sub ON sub.character_id=c.id
      LEFT JOIN character_training_time training ON training.character_id=c.id
      LEFT JOIN character_order o ON o.character_id=c.id
      LEFT JOIN jobs j ON j.character_id=c.id
      LEFT JOIN snapshots skill ON skill.character_id=c.id AND skill.kind='skills'
      LEFT JOIN snapshots wallet ON wallet.character_id=c.id AND wallet.kind='wallet'
      LEFT JOIN sync_errors se ON se.character_id=c.id AND se.kind='skills'
      WHERE c.user_id=? ORDER BY (c.id=?) DESC,o.position,c.id`).all(user,main);
    const snapshots=new Map(rows.map(row=>[row.id,[]]));
    const errors=new Map(rows.map(row=>[row.id,[]]));
    const enabled=new Map(),prefs=preferences(db,user);
    const isEnabled=kind=>{
      if(!enabled.has(kind))enabled.set(kind,syncEnabled(db,user,kind,prefs));
      return enabled.get(kind);
    };
    for(const {character_id,...row} of db.prepare("SELECT s.character_id,s.kind,s.updated,s.expires FROM characters c JOIN snapshots s ON s.character_id=c.id WHERE c.user_id=? ORDER BY s.character_id,s.kind").all(user)){
      snapshots.get(character_id).push({...row,sync_enabled:isEnabled(row.kind)});
    }
    for(const {character_id,...row} of db.prepare("SELECT e.character_id,e.kind,e.message FROM characters c JOIN sync_errors e ON e.character_id=c.id WHERE c.user_id=? ORDER BY e.character_id,e.kind").all(user)){
      if(isEnabled(row.kind))errors.get(character_id).push(row);
    }
    res.json(rows.map(c=>{
      const parent=c.parent_id||main,skill=c.skills?JSON.parse(c.skills):null;
      const scopes=new Set(JSON.parse(c.scopes));
      const warning=parent===c.id&&skill?personalAlerts([{id:c.id,name:c.name,parent_id:parent,
        subscription_end:c.expires_on,snapshots:{skills:{data:skill,updated:c.skills_updated,error:c.skill_error}}}]).find(a=>a.page==='skills')?.message:null;
      return {id:c.id,name:c.name,reconnect:c.reconnect,training_warning:warning||null,
        missing_scopes:SCOPES.filter(scope=>!scopes.has(scope)),total_sp:skill?.skills?.total_sp??null,isk:c.balance??null,
        main:c.id===main,subscription_end:c.expires_on||null,subscription_recurring:!!c.recurring,
        mct_enabled:!!c.mct_enabled,mct_expires_on:c.mct_expires_on||null,parent_id:parent,job:c.job||null,
        snapshots:snapshots.get(c.id),errors:errors.get(c.id)};
    }));
  });
  app.post("/api/characters/:id/subscription",(req,res)=>{
    const c=ownedCharacter(db,req.session.user_id,req.params.id), body=req.body;
    const {expires_on,recurring,mct_enabled,mct_expires_on}=body;
    const dateFields=['expires_on','mct_expires_on'].filter(key=>Object.hasOwn(body,key));
    if(dateFields.some(key=>body[key]!==null&&body[key]!==''&&!validSubscriptionDate(body[key])))
      return res.status(400).json({error:"Choose a valid expiry date"});
    if(['recurring','mct_enabled'].some(key=>Object.hasOwn(body,key)&&typeof body[key]!=='boolean'))
      return res.status(400).json({error:"Choose whether recurring subscription or MCT is enabled"});
    const parent=db.prepare("SELECT parent_id FROM character_groups WHERE character_id=?").get(c.id)?.parent_id||req.session.main_id;
    const alt=parent!==c.id;
    if((recurring!==undefined&&alt)||((mct_enabled!==undefined||mct_expires_on!==undefined)&&!alt))
      return res.status(400).json({error:"Recurring subscriptions are set on mains and MCT is set on alts"});
    if(expires_on!==undefined){
      if(expires_on)db.prepare("INSERT INTO character_subscriptions VALUES(?,?) ON CONFLICT(character_id) DO UPDATE SET expires_on=excluded.expires_on").run(c.id,expires_on);
      else db.prepare("DELETE FROM character_subscriptions WHERE character_id=?").run(c.id);
    }
    if(recurring!==undefined||mct_enabled!==undefined||mct_expires_on!==undefined){
      db.prepare(`INSERT INTO character_training_time VALUES(?,COALESCE(?,0),COALESCE(?,0),?)
        ON CONFLICT(character_id) DO UPDATE SET
          recurring=COALESCE(?,recurring),mct_enabled=COALESCE(?,mct_enabled),
          mct_expires_on=CASE WHEN ? THEN excluded.mct_expires_on ELSE mct_expires_on END`)
        .run(c.id,recurring===undefined?null:Number(recurring),mct_enabled===undefined?null:Number(mct_enabled),mct_expires_on||null,
          recurring===undefined?null:Number(recurring),mct_enabled===undefined?null:Number(mct_enabled),Number(mct_expires_on!==undefined));
    }
    const training=db.prepare("SELECT * FROM character_training_time WHERE character_id=?").get(c.id);
    res.json({expires_on:db.prepare("SELECT expires_on FROM character_subscriptions WHERE character_id=?").get(c.id)?.expires_on||null,
      subscription_recurring:!!training?.recurring,mct_enabled:!!training?.mct_enabled,mct_expires_on:training?.mct_expires_on||null});
  });
  app.post("/api/characters/:id/group",(req,res)=>{
    const c=ownedCharacter(db,req.session.user_id,req.params.id);
    const parent=ownedCharacter(db,req.session.user_id,req.body.parent_id);
    if(c.id===req.session.main_id && parent.id!==c.id)return res.status(400).json({error:"The login main must remain a main"});
    const parentGroup=db.prepare("SELECT parent_id FROM character_groups WHERE character_id=?").get(parent.id)?.parent_id || req.session.main_id;
    if(parent.id!==c.id && parentGroup!==parent.id)return res.status(400).json({error:"Choose a main character"});
    transaction(db,()=>{
      if(parent.id!==c.id)db.prepare("UPDATE character_groups SET parent_id=? WHERE parent_id=? AND character_id<>?").run(parent.id,c.id,c.id);
      db.prepare("INSERT INTO character_groups VALUES(?,?) ON CONFLICT(character_id) DO UPDATE SET parent_id=excluded.parent_id").run(c.id,parent.id);
    });
    res.json({ok:true});
  });
  app.delete("/api/characters/:id", (req, res) => {
    const c = ownedCharacter(db, req.session.user_id, req.params.id);
    if (c.id === req.session.main_id)
      return res.status(400).json({ error: "The main cannot be unlinked" });
    transaction(db,()=>{
      db.prepare('DELETE FROM corp_authorizations WHERE user_id=? AND character_id=?').run(req.session.user_id,c.id);
      db.prepare('DELETE FROM corporation_connections WHERE character_id=? AND owner_hash=?').run(c.id,c.owner_hash);
      removePilotWhitelist(db,[c.id]);
      db.prepare("DELETE FROM characters WHERE id=?").run(c.id);
    });
    corp.invalidate(req.session.user_id);
    res.json({ ok: true });
  });
  app.post("/api/characters/:id/sync", (req, res) => {
    const c = ownedCharacter(db, req.session.user_id, req.params.id);
    sync.queue(req.session.user_id, c.id, true);
    res.json({ ok: true });
  });
  app.post("/api/characters/order", (req, res) => {
    const ids = req.body.ids;
    const own = db
      .prepare("SELECT id FROM characters WHERE user_id=?")
      .all(req.session.user_id)
      .map((c) => c.id);
    if (
      !Array.isArray(ids) ||
      ids.length !== own.length ||
      new Set(ids).size !== own.length ||
      ids[0] !== req.session.main_id ||
      ids.some((id) => !own.includes(id))
    )
      return res.status(400).json({
        error: "Provide your complete character order with the main first",
      });
    transaction(db, () =>
      ids.forEach((id, index) =>
        db
          .prepare("UPDATE character_order SET position=? WHERE character_id=?")
          .run(index, id),
      ),
    );
    res.json({ ok: true });
  });
  app.post("/api/sync", (req, res) => {
    sync.queue(req.session.user_id, null, true);
    res.json({ ok: true });
  });
  function snapshot(req, kind) {
    ownedCharacter(db, req.session.user_id, req.params.id);
    const r = db
      .prepare("SELECT * FROM snapshots WHERE character_id=? AND kind=?")
      .get(Number(req.params.id), kind);
    return r
      ? { updated: r.updated, data: JSON.parse(r.data) }
      : { updated: null, data: null };
  }
  app.get("/api/skills/overview", (req,res) => {
    const rows=db.prepare("SELECT c.id,c.name,s.data,s.updated,s.expires FROM characters c LEFT JOIN snapshots s ON s.character_id=c.id AND s.kind='skills' WHERE c.user_id=? ORDER BY (c.id=?) DESC,(SELECT position FROM character_order WHERE character_id=c.id),c.id").all(req.session.user_id,req.session.main_id);
    res.json(rows.map(c=>{const data=c.data?JSON.parse(c.data):null;return {id:c.id,name:c.name,updated:c.updated,expires:c.expires,error:db.prepare("SELECT message FROM sync_errors WHERE character_id=? AND kind='skills'").get(c.id)?.message||null,total_sp:data?.skills.total_sp ?? null,queue:data?.queue.map(q=>({...q,name:cat.type(q.skill_id)?.name||String(q.skill_id)}))||[]};}));
  });
  app.get('/api/characters/:id/wallet-history',(req,res)=>{const saved=snapshot(req,'wallet-history');res.json({...saved,error:db.prepare("SELECT message FROM sync_errors WHERE character_id=? AND kind='wallet-history'").get(Number(req.params.id))?.message||null});});
  app.get('/api/characters/:id/dashboard',(req,res)=>{ownedCharacter(db,req.session.user_id,req.params.id);res.json(characterDashboard(db,Number(req.params.id)));});
  app.get("/api/characters/:id/skills", (req, res) => {
    const s = snapshot(req, "skills");
    if (s.data) {
      s.data.skills.skills = s.data.skills.skills.map((r) => ({
        ...r,
        name: cat.type(r.skill_id)?.name || String(r.skill_id),
        group: skillGroups[cat.type(r.skill_id)?.group_id] || "Other",
      }));
      s.data.queue = s.data.queue.map((r) => ({
        ...r,
        name: cat.type(r.skill_id)?.name || String(r.skill_id),
        group: skillGroups[cat.type(r.skill_id)?.group_id] || "Other",
      }));
    }
    res.json(s);
  });
  const piRecipes=()=>cat.piRecipes?.()||[];
  const piSettings=user=>({...defaultPISettings(),...JSON.parse(db.prepare("SELECT data FROM pi_settings WHERE user_id=?").get(user)?.data||"null")});
  const pricePI=jitaPricing(db,eve);
  app.get('/api/mining/refining',async(req,res)=>{
    const saved=db.prepare("SELECT s.data FROM snapshots s JOIN characters c ON c.id=s.character_id WHERE c.user_id=? AND s.kind='mining'").all(req.session.user_id);
    const ids=new Set(saved.flatMap(s=>JSON.parse(s.data).rows.map(r=>r.type_id)));
    const recipes=Object.fromEntries([...ids].filter(id=>miningRecipes[id]).map(id=>[id,miningRecipes[id]]));
    const outputs=[...new Set(Object.values(recipes).flatMap(r=>r.materials.map(m=>m.id)))];
    const oreIds=req.query.ores==='1'?[...ids]:[],quotes=await pricePI([...new Set([...outputs,...oreIds])]);
    res.json({recipes,prices:quotes.filter(q=>outputs.includes(q.id)),ore_prices:quotes.filter(q=>oreIds.includes(q.id)),price_source:'Jita IV–4 lowest sell'});
  });
  app.get('/api/pi/market',async(req,res)=>{
    const recipes=piRecipes(),fuelNames=['Coolant','Enriched Uranium','Mechanical Parts','Oxygen','Robotics'];
    const groups=[{name:'Fuel Blocks',description:'PI ingredients used to manufacture fuel blocks.',items:fuelNames.map(name=>({id:cat.named(name),name})).filter(r=>r.id)},...[2,3,4].map(tier=>({name:'P'+tier,items:recipes.filter(r=>r.tier===tier).sort((a,b)=>a.name.localeCompare(b.name)).map(r=>({id:r.id,name:r.name}))}))];
    const quotes=new Map((await marketPI([...new Set(groups.flatMap(g=>g.items.map(r=>r.id)))])).map(q=>[q.id,q]));
    res.json({groups:groups.map(g=>({...g,items:g.items.map(r=>({...r,...quotes.get(r.id)}))}))});
  });
  app.post("/api/pi/settings",(req,res)=>{
    try{
      const settings=validatePISettings(req.body,piRecipes());
      db.prepare("INSERT INTO pi_settings VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data").run(req.session.user_id,JSON.stringify(settings));
      res.json(settings);
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.get("/api/pi/shares",(req,res)=>{
    const owner=req.session.user_id;
    res.json({recipients:db.prepare("SELECT id,name,main_id FROM users WHERE id<>? ORDER BY name COLLATE NOCASE").all(owner),
      pilots:db.prepare("SELECT id,name FROM characters WHERE user_id=? ORDER BY name COLLATE NOCASE").all(owner),
      grants:db.prepare("SELECT s.recipient_id,s.character_id FROM pi_shares s JOIN characters c ON c.id=s.character_id AND c.user_id=s.owner_id WHERE s.owner_id=?").all(owner)});
  });
  app.post("/api/pi/shares",(req,res)=>{
    const owner=req.session.user_id,{recipient_id,character_ids}=req.body;
    if(!Number.isSafeInteger(recipient_id)||recipient_id===owner||!db.prepare("SELECT id FROM users WHERE id=?").get(recipient_id)||!Array.isArray(character_ids)||character_ids.length>1000||character_ids.some(id=>!Number.isSafeInteger(id)))return res.status(400).json({error:"Choose a registered recipient and your pilots."});
    try {
      transaction(db,()=>{
        for(const id of character_ids)ownedCharacter(db,owner,id);
        db.prepare("DELETE FROM pi_shares WHERE owner_id=? AND recipient_id=?").run(owner,recipient_id);
        const add=db.prepare("INSERT INTO pi_shares VALUES(?,?,?)");
        for(const id of new Set(character_ids))add.run(owner,recipient_id,id);
      });
      res.json({ok:true});
    }catch(e){res.status(e.status||400).json({error:e.message});}
  });
  app.get("/api/pi/shared",(req,res)=>{
    const rows=db.prepare("SELECT c.id,c.name,u.name owner_name,s.data,s.updated,g.owner_id,(SELECT message FROM sync_errors WHERE character_id=c.id AND kind='pi') error FROM pi_shares g JOIN characters c ON c.id=g.character_id AND c.user_id=g.owner_id JOIN users u ON u.id=g.owner_id LEFT JOIN snapshots s ON s.character_id=c.id AND s.kind='pi' WHERE g.recipient_id=? ORDER BY u.name COLLATE NOCASE,c.name COLLATE NOCASE").all(req.session.user_id);
    res.json(rows.map(r=>({id:r.id,name:r.name,owner_name:r.owner_name,updated:r.updated||null,error:r.error||null,data:r.data?piSummary(JSON.parse(r.data),cat):null,settings:{perfect:piSettings(r.owner_id).perfect,critical:piSettings(r.owner_id).critical}})));
  });
  app.get("/api/pi/prices",async(req,res)=>res.json(await pricePI(piSettings(req.session.user_id).targets)));
  app.get("/api/pi/dashboard",(req,res)=>{
    const settings=piSettings(req.session.user_id),recipes=piRecipes(),stock=new Map();
    const rows=db.prepare("SELECT c.id,s.data,s.updated,(SELECT message FROM sync_errors WHERE character_id=c.id AND kind='pi') error FROM characters c LEFT JOIN snapshots s ON s.character_id=c.id AND s.kind='pi' WHERE c.user_id=?").all(req.session.user_id);
    for(const row of rows)for(const planet of row.data?piSummary(JSON.parse(row.data),cat):[])for(const store of planet.storage)for(const item of store.contents){
      const current=stock.get(item.type_id)||{type_id:item.type_id,name:item.name,amount:0};
      if(Number.isFinite(item.amount)&&item.amount>0)current.amount+=item.amount;
      stock.set(item.type_id,current);
    }
    res.json({settings,products:recipes.filter(r=>[3,4].includes(r.tier)).sort((a,b)=>a.name.localeCompare(b.name)),...combinedVolumes(combinedProduction([...stock.values()],settings.targets,recipes),id=>cat.type(id)),partial:rows.some(r=>!r.data||r.error),updated:rows.length&&rows.every(r=>r.updated)?Math.min(...rows.map(r=>r.updated)):null});
  });
  app.get("/api/market/keys", async (req,res) => {
    try {
      const id=cat.named("Infomorph Decryption Key");
      const prices=await eve.publicGet("/markets/prices");
      const price=prices.find(p=>p.type_id===id)?.average_price;
      res.json({type_id:id,price:Number.isFinite(price)&&price>0?price:null,source:"EVE market average"});
    } catch {res.json({price:null,source:"EVE market average"});}
  });
  app.get("/api/operations/:kind", (req, res) => {
    if (!["pi", "dens", "industry", "clones", "mining", "wallet-history", "contracts", "market", "loyalty", "standings", "fatigue"].includes(req.params.kind))
      return res.sendStatus(404);
    const industry = req.params.kind === "industry";
    const chars = db.prepare(`
      SELECT c.id,c.name${industry ? ",json_extract(skills.data,'$.skills.skills') industry_skills" : ""}
      FROM characters c
      ${industry ? "LEFT JOIN snapshots skills ON skills.character_id=c.id AND skills.kind='skills'" : ""}
      WHERE c.user_id=?
      ORDER BY (c.id=(SELECT main_id FROM users WHERE id=c.user_id)) DESC,
        (SELECT position FROM character_order WHERE character_id=c.id),c.id
    `).all(req.session.user_id);
    res.json(
      chars.map(({industry_skills,...c}) => {
        const r = db
          .prepare(
            "SELECT data,updated FROM snapshots WHERE character_id=? AND kind=?",
          )
          .get(c.id, req.params.kind);
        return {
          ...c,
          ...(industry ? {slot_limits:industrySlotLimits(industry_skills ? JSON.parse(industry_skills) : null)} : {}),
          main: c.id === req.session.main_id,
        parent_id: db.prepare("SELECT parent_id FROM character_groups WHERE character_id=?").get(c.id)?.parent_id || req.session.main_id,
          updated: r?.updated || null,
          error:
            db
              .prepare(
                "SELECT message FROM sync_errors WHERE character_id=? AND kind=?",
              )
              .get(c.id, req.params.kind)?.message || null,
          data: r
            ? req.params.kind === "pi"
              ? piSummary(JSON.parse(r.data), cat)
              : req.params.kind === "dens"
                ? JSON.parse(r.data).map(den=>({...den,region:regionForSystem(den.planet?.system_id ?? den.skyhook?.solar_system_id)}))
                : JSON.parse(r.data)
            : null,
        };
      }),
    );
  });
  app.get("/api/assets", (req, res) => {
    const q = String(req.query.q || "").toLowerCase(),
      char = Number(req.query.character || 0),
      location = String(req.query.location || "").toLowerCase(),
      offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = [],types=new Map();
    const type=id=>{if(!types.has(id))types.set(id,cat.type(id));return types.get(id);};
    const sources = [],asset_safety=[];
    for (const c of db
      .prepare("SELECT id,name FROM characters WHERE user_id=?")
      .all(req.session.user_id)) {
      if (char && char !== c.id) continue;
      const s = db
        .prepare(
          "SELECT data,updated FROM snapshots WHERE character_id=? AND kind='assets'",
        )
        .get(c.id);
      sources.push({ id: c.id, name: c.name, updated: s?.updated || null });
      if (!s) {asset_safety.push({id:c.id,name:c.name,items:[],transfers:[],updated:null});continue;}
      const data = JSON.parse(s.data);
      const inventory=data.items.map(item=>({...item,
        name:type(item.type_id)?.name || String(item.type_id),
        location:data.locations[item.root_location_id] || String(item.root_location_id),
        location_type_id:data.locationTypes?.[item.root_location_id] || null,
        character:c.name,character_id:c.id,
      }));
      const safety=data.asset_safety||{};
      asset_safety.push({id:c.id,name:c.name,updated:s.updated,notification_updated:safety.updated||null,status:safety.status||'pending',items:safetyInventory(inventory),transfers:(safety.transfers||[]).map(t=>({...t,source:(systemNames[t.system_id]||'System '+(t.system_id||'unknown'))+' · Structure '+(t.structure_id||'unknown'),destination:t.destination_id?(data.locations?.[t.destination_id]||'Station '+t.destination_id):null}))});
      for(const item of assetMatches(inventory,q,location,{exact:req.query.exact==='true'}))rows.push(item);
    }
    const grouped = new Map();
    for (const row of rows) {
      const key = String(row.root_location_id);
      if (!grouped.has(key))
        grouped.set(key, {
          id: key,
          name: row.location,
          type_id: row.location_type_id,
          type_name: row.location_type_id
            ? type(row.location_type_id)?.name || null
            : null,
          items: [],
        });
      const group = grouped.get(key);
      if (!group.type_id && row.location_type_id) {
        group.type_id = row.location_type_id;
        group.type_name = type(row.location_type_id)?.name || null;
      }
      group.items.push(row);
    }
    const locations = [...grouped.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    res.json({
      total: rows.filter(a=>!a.context).length,
      locationCount: locations.length,
      locations: locations.slice(offset, offset + 20),
      items: rows.slice(offset, offset + 100),
      sources,asset_safety,
    });
  });
  app.get("/api/catalog", (req, res) =>
    res.json(
      cat.search(
        String(req.query.q || "").slice(0, 100),
        req.query.skills === "1",
      ),
    ),
  );
  documentLibraryRoutes(app,{db,cat});
  app.get("/api/documents", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT d.id,d.owner,d.kind,d.name,d.shared,d.updated,COALESCE((SELECT tag FROM document_tags WHERE document_id=d.id),'Personal') tag,CASE WHEN d.kind='fitting' THEN d.body END fitting_body,u.name author FROM documents d JOIN users u ON u.id=d.owner WHERE d.owner=? OR d.shared=1 ORDER BY d.updated DESC",
        )
        .all(req.session.user_id)
        .map(({fitting_body,...r}) => {
          let ship=null;
          if(fitting_body) {
            try {
              const header=JSON.parse(fitting_body).trim().match(/^\[([^,]+),/);
              const type=header && cat.type(cat.named(header[1].trim()));
              if(type?.category_id===6) ship={id:type.id,name:type.name};
            } catch { /* Keep older fittings visible if their hull cannot be resolved. */ }
          }
          return {...r,ship,mine:r.owner===req.session.user_id};
        }),
    ),
  );
  function linkedPlan(row,user) {
    const link=db.prepare("SELECT plan_id FROM fitting_plans WHERE user_id=? AND fitting_id=?").get(user,row.id);
    return link ? db.prepare("SELECT * FROM documents WHERE id=? AND kind='plan' AND (owner=? OR shared=1)").get(link.plan_id,user) : null;
  }
  function documentRequirements(row,user) {
    if(row.kind==="plan")return expandPlan(JSON.parse(row.body),cat);
    const plan=linkedPlan(row,user);
    return expandPlan([...parseFitting(JSON.parse(row.body),cat).requirements,...(plan?JSON.parse(plan.body):[])],cat);
  }
  app.post("/api/documents/:id/plan",(req,res)=>{
    const fitting=visibleDocument(db,req.session.user_id,req.params.id);
    if(fitting.kind!=="fitting")return res.status(400).json({error:"Select a fitting"});
    if(req.body.plan){
      const plan=visibleDocument(db,req.session.user_id,req.body.plan);
      if(plan.kind!=="plan")return res.status(400).json({error:"Select a skill plan"});
      db.prepare("INSERT INTO fitting_plans VALUES(?,?,?) ON CONFLICT(user_id,fitting_id) DO UPDATE SET plan_id=excluded.plan_id").run(req.session.user_id,fitting.id,plan.id);
    }else db.prepare("DELETE FROM fitting_plans WHERE user_id=? AND fitting_id=?").run(req.session.user_id,fitting.id);
    res.json({ok:true});
  });
  app.get("/api/documents/:id", (req, res) => {
    const row = visibleDocument(db, req.session.user_id, req.params.id);
    const readiness = (() => {
      const required = documentRequirements(row,req.session.user_id);
      return db.prepare("SELECT c.id,c.name,s.data,s.updated FROM characters c LEFT JOIN snapshots s ON s.character_id=c.id AND s.kind='skills' WHERE c.user_id=? ORDER BY (c.id=?) DESC,(SELECT position FROM character_order WHERE character_id=c.id),c.id").all(req.session.user_id,req.session.main_id).map(c=>{
        const error=db.prepare("SELECT message FROM sync_errors WHERE character_id=? AND kind='skills'").get(c.id)?.message||null;
        const evidence=skillEvidence(required,c,cat,{error}),minimum=row.kind==='fitting'?new Map(parseFitting(JSON.parse(row.body),cat).requirements.map(r=>[r.id,r.level])):null;
        evidence.rows=evidence.rows.map(r=>({...r,minimum_required:minimum?.get(r.id)||0,source:minimum?(minimum.get(r.id)||0)>=r.level?'Fitting minimum':'Linked plan':'Skill plan'}));evidence.missing=evidence.rows.filter(r=>r.active<r.required);
        return {id:c.id,name:c.name,...evidence};
      });
    })();
    res.json({
      ...row,
      readiness,
      linkedFittings:row.kind==='plan'?db.prepare("SELECT d.id,d.name FROM fitting_plans l JOIN documents d ON d.id=l.fitting_id WHERE l.user_id=? AND l.plan_id=? AND (d.owner=? OR d.shared=1)").all(req.session.user_id,row.id,req.session.user_id):[],
      linkedPlan: row.kind === "fitting" ? linkedPlan(row,req.session.user_id)?.id || null : null,
      body:
        row.kind === "plan"
          ? JSON.parse(row.body).map((r) => ({
              ...r,
              name: cat.type(r.id)?.name || String(r.id),
            }))
          : JSON.parse(row.body),
      fitting: row.kind === "fitting" ? fittingView(JSON.parse(row.body),cat) : null,
      mine: row.owner === req.session.user_id,
    });
  });
  function documentTag(value){
    if(value===undefined)return 'Personal';
    if(typeof value!=='string'||!value.trim()||value.trim().length>40)throw Object.assign(Error('Enter a tag of 1–40 characters'),{status:400});
    const clean=value.trim();return ['Personal','Corp','Alliance'].find(t=>t.toLowerCase()===clean.toLowerCase())||clean;
  }
  app.post("/api/documents", (req, res) => {
    const tag=documentTag(req.body.tag);
    const { kind, name, body, shared } = req.body;
    if (
      !["plan", "fitting"].includes(kind) ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 150
    )
      return res
        .status(400)
        .json({ error: "Enter a name up to 150 characters" });
    let valid;
    if (kind === "plan") {
      if (!Array.isArray(body) || !body.length || body.length > 500)
        throw Error("Plan must contain up to 500 skills");
      valid = expandPlan(body, cat);
    } else {
      parseFitting(body, cat);
      valid = body;
    }
    const id = random();
    db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?)").run(
      id,
      req.session.user_id,
      kind,
      name.trim(),
      JSON.stringify(valid),
      shared === true ? 1 : 0,
      Date.now(),
    );
    db.prepare("INSERT INTO document_tags VALUES(?,?)").run(id,tag);
    res.json({ id });
  });
  app.put("/api/documents/:id", (req, res) => {
    const row = visibleDocument(db, req.session.user_id, req.params.id);
    if (row.owner !== req.session.user_id) return res.sendStatus(403);
    const tag=documentTag(req.body.tag??row.tag);
    const { name, body, shared } = req.body;
    if (typeof name !== "string" || !name.trim() || name.length > 150)
      throw Error("Enter a name up to 150 characters");
    let valid;
    if (row.kind === "plan") {
      if (!Array.isArray(body) || !body.length || body.length > 500)
        throw Error("Plan needs 1–500 skills");
      valid = expandPlan(body, cat);
    } else {
      parseFitting(body, cat);
      valid = body;
    }
    if(row.kind==="fitting")db.prepare("DELETE FROM fitting_workspaces WHERE document_id=?").run(row.id);
    db.prepare(
      "UPDATE documents SET name=?,body=?,shared=?,updated=? WHERE id=?",
    ).run(
      name.trim(),
      JSON.stringify(valid),
      shared === true ? 1 : 0,
      Date.now(),
      row.id,
    );
    db.prepare("INSERT INTO document_tags VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET tag=excluded.tag").run(row.id,tag);
    res.json({ id: row.id });
  });
  app.patch("/api/documents/:id", (req, res) => {
    const row = visibleDocument(db, req.session.user_id, req.params.id);
    if (row.owner !== req.session.user_id) return res.sendStatus(403);
    db.prepare("UPDATE documents SET shared=?,updated=? WHERE id=?").run(
      req.body.shared === true ? 1 : 0,
      Date.now(),
      row.id,
    );
    res.json({ ok: true });
  });
  app.delete("/api/documents/:id", (req, res) => {
    const row = visibleDocument(db, req.session.user_id, req.params.id);
    if (row.owner !== req.session.user_id) return res.sendStatus(403);
    db.prepare("DELETE FROM documents WHERE id=?").run(row.id);
    res.json({ ok: true });
  });
  app.post("/api/compare", (req, res) => {
    const c = ownedCharacter(db, req.session.user_id, req.body.character),
      row = visibleDocument(db, req.session.user_id, req.body.document);
    const snap = db
      .prepare(
        "SELECT data,updated FROM snapshots WHERE character_id=? AND kind='skills'",
      )
      .get(c.id);
    if (!snap)
      return res
        .status(409)
        .json({ error: "Sync this character’s skills first" });
    const data = JSON.parse(snap.data),
      body = JSON.parse(row.body),
      entries =
        documentRequirements(row,req.session.user_id);
    res.json({
      ...comparePlan(
        entries,
        data.skills,
        data.queue,
        data.attributes,
        cat,
        req.body.alpha === true,
      ),
      updated: snap.updated,
    });
  });
  app.post("/api/skill-plan/import", (req,res) => {
    try {res.json(importSkillText(req.body.text,cat));}
    catch(error) {res.status(400).json({error:error.message});}
  });
  app.post("/api/ship-plan", (req, res) => {
    const ship = cat.type(req.body.ship);
    if (ship?.category_id !== 6) throw Error("Choose a ship");
    res.json(
      expandPlan(requirements(ship.id, cat), cat).map((r) => ({
        ...r,
        name: cat.type(r.id)?.name || String(r.id),
      })),
    );
  });
  app.use("/api/admin",(req,res,next)=>isSiteAdmin(req.session,config.owner)?next():res.sendStatus(403));
  function adminCharacters() {
    return db.prepare(`SELECT c.id,c.user_id,c.name,c.reconnect,b.minute,b.next_due,j.status AS job,a.attempted,
    (SELECT MAX(updated) FROM snapshots WHERE character_id=c.id) AS updated
    FROM characters c JOIN character_buckets b ON b.character_id=c.id LEFT JOIN jobs j ON j.character_id=c.id LEFT JOIN sync_attempts a ON a.character_id=c.id ORDER BY c.name`).all().map(c=>({...c,errors:db.prepare("SELECT kind,message FROM sync_errors WHERE character_id=?").all(c.id)}));
  }
  app.get("/api/admin/users",(req,res)=>{
    const chars=adminCharacters(),discordEnabled=discord.read().enabled;
    res.json(db.prepare("SELECT u.id,u.name,u.main_id,u.admin,l.last_login,COALESCE(a.last_seen,l.last_login) last_online,a.last_seen FROM users u LEFT JOIN user_logins l ON l.user_id=u.id LEFT JOIN user_activity a ON a.user_id=u.id ORDER BY last_online DESC,u.name COLLATE NOCASE").all().map(u=>({...u,owner:u.main_id===config.owner,admin:u.main_id===config.owner||u.admin===1,recruit:Boolean(recruitAccount(db,u.id)),groups:db.prepare('SELECT g.id,g.name,m.status FROM access_groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.name').all(u.id),whitelist:db.prepare('SELECT status,checked,message FROM user_whitelist_reviews WHERE user_id=?').get(u.id)||null,discord:discordEnabled?{enabled:true,connected:Boolean(db.prepare('SELECT 1 FROM discord_accounts WHERE user_id=?').get(u.id))}:null,characters:chars.filter(c=>c.user_id===u.id)})));
  });
  app.post('/api/admin/users/whitelist-review',(_req,res)=>res.status(202).json(usersReview.start()));
  app.post('/api/admin/users/:id/sync',(req,res)=>{
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1||!db.prepare('SELECT 1 FROM users WHERE id=?').get(id))return res.sendStatus(404);
    const characters=db.prepare('SELECT COUNT(*) count FROM characters WHERE user_id=?').get(id).count;
    res.status(202).json({characters,queued:sync.queue(id,null,true)});
  });
  app.delete('/api/admin/users/:id/whitelist-remove',async(req,res)=>res.json(await usersReview.remove(req.session,Number(req.params.id),req.body.confirm_main_id)));
  app.post("/api/admin/esi/rebalance",(req,res)=>res.json(sync.rebalance()));
  app.post('/api/admin/users/:id/admin',(req,res)=>{
    if(req.session.main_id!==config.owner)return res.sendStatus(403);
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1||typeof req.body.admin!=='boolean')return res.status(400).json({error:'Choose a user and admin status.'});
    const target=db.prepare('SELECT main_id FROM users WHERE id=?').get(id);
    if(!target)return res.sendStatus(404);
    if(target.main_id===config.owner)return res.status(400).json({error:'The site owner always keeps admin access.'});
    if(req.body.admin&&req.body.confirm_main_id!==target.main_id)return res.status(400).json({error:'Confirm the exact pilot before granting admin access.'});
    db.prepare('UPDATE users SET admin=? WHERE id=?').run(Number(req.body.admin),id);
    if(!req.body.admin)db.prepare('DELETE FROM inspections WHERE session_id IN (SELECT id FROM sessions WHERE user_id=?)').run(id);
    res.json({ok:true,admin:req.body.admin});
  });
  app.delete('/api/admin/users/:id',(req,res)=>{
    if(req.session.main_id!==config.owner)return res.sendStatus(403);
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1)return res.sendStatus(400);
    const target=db.prepare('SELECT main_id FROM users WHERE id=?').get(id);
    if(!target)return res.sendStatus(404);
    if(target.main_id===config.owner||id===req.session.user_id)return res.status(400).json({error:'The site owner account cannot be deleted.'});
    if(req.body.confirm_main_id!==target.main_id)return res.status(400).json({error:'Confirm the exact account before deleting it.'});
    res.json(wipeAccount(db,id));
  });
  app.get("/api/admin/esi",(req,res)=>res.json({characters:adminCharacters(),buckets:[0,10,20,30,40,50]}));
  app.get("/api/admin/corporations",(req,res)=>res.json(db.prepare("SELECT corporation_id,name,character_id,character_name,verified,role FROM corporation_connections ORDER BY name").all()));
  whitelistRoutes(app,{db,eve,whitelist});
  app.use('/api',(_req,res)=>res.status(404).json({error:'API endpoint not found.'}));
  const stylesheet = new URL('./public/style.css', import.meta.url);
  const stylesheetVersion = hash(readFileSync(stylesheet)).slice(0,12);
  const appShell = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')
    .replace('href="/style.css"', `href="/style.css?v=${stylesheetVersion}"`);
  app.get(['/','/Recruit','/index.html'],(_req,res)=>res.set('Cache-Control','no-cache').type('html').send(appShell));
  app.use(
    express.static(
      new URL("./public", import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      ),
      { index: "index.html" },
    ),
  );
  app.use((err, req, res, _next) => {
    const status =
      Number.isInteger(err.status) && err.status >= 400 && err.status < 600
        ? err.status
        : 400;
    const message = String(err.message || "Request failed");
    if (req.path.startsWith("/auth"))
      return res
        .status(status)
        .type("text")
        .send(
          status === 403 || status === 409
            ? message
            : "EVE login could not be completed. Please try again.",
        );
    res.status(status).json({
      error: String(err.code||'').startsWith('SQLITE') || message.startsWith("SQLITE")
        ? "Request could not be saved"
        : message,
    });
  });
  return { app, db, cat, sync, corp, recruitment, discord, publishing, usersReview, recruitMembership, groupEnrolment, logistics:services.logistics };
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const config = runtimeConfig();
  const { app, sync, corp, recruitment, discord, publishing, usersReview, recruitMembership, groupEnrolment, logistics } = createApp(config);
  app.listen(config.port, "127.0.0.1", () =>
    console.log("Tools listening on " + config.port),
  );
  setInterval(()=>discord.tick().catch(()=>console.error("Discord sync failed")),15000).unref();
  setInterval(()=>publishing.tick().catch(()=>console.error("Discord publishing failed")),60000).unref();
  setInterval(()=>usersReview.tick().catch(()=>console.error("Whitelist review failed")),1000).unref();
  groupEnrolment.tick().catch(()=>console.error('Group enrolment check failed'));
  setInterval(()=>groupEnrolment.tick().catch(()=>console.error('Group enrolment check failed')),15000).unref();
  recruitMembership.tick().catch(()=>console.error('Recruit membership check failed'));
  setInterval(()=>recruitMembership.tick().catch(()=>console.error('Recruit membership check failed')),15000).unref();
  recruitment.schedule();
  setInterval(()=>recruitment.schedule(),3600000).unref();
  setInterval(()=>recruitment.tick().catch(()=>console.error("Recruitment sync failed")),3000).unref();
  logistics.tick().catch(()=>console.error('Logistics contract refresh failed'));
  setInterval(()=>logistics.tick().catch(()=>console.error('Logistics contract refresh failed')),60000).unref();
  sync.schedule();
  corp.schedule();
  setInterval(()=>corp.tickNotifications().catch(()=>console.error("Corporation notification sync failed")),15000).unref();
  setInterval(()=>corp.schedule(),60000).unref();
  setInterval(()=>corp.tick().catch(()=>console.error("Corporation sync failed")),5000).unref();
  setInterval(() => sync.schedule(), 60000).unref();
  setInterval(()=>sync.tickReconnects().catch(()=>console.error('Connection recovery failed')),15000).unref();
  setInterval(()=>sync.tickDenNotifications().catch(()=>console.error("Den notification sync failed")),2000).unref();
  setInterval(
    () =>
      sync
        .tick()
        .catch(() =>
          console.error("Background sync failed; queued work will retry"),
        ),
    3000,
  ).unref();
}
