const nameKey=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';
const displayName=member=>[member.nick,member.user.global_name,member.user.username].find(value=>typeof value==='string'&&value.trim())?.slice(0,100);
const conflict=message=>Object.assign(Error(message),{status:409});

export function matchDiscordPilots(members,pilots,verified){
 const names=new Map();
 for(const pilot of pilots){
  const key=nameKey(pilot.name);
  if(!key)continue;
  if(!names.has(key))names.set(key,new Map());
  names.get(key).set(pilot.user_id,pilot.name);
 }
 const linkedUsers=new Set(verified.map(row=>row.user_id));
 const linkedDiscord=new Set(verified.map(row=>row.discord_id));
 const proposed=new Map(),claimed=new Map();
 const ambiguous=new Set();
 for(const {nick,user} of members){
  if(user.bot||user.system||linkedDiscord.has(user.id))continue;
  const candidates=new Map();
  const discordNames=[nick,user.global_name,user.username].filter(value=>typeof value==='string'&&value.trim());
  for(const name of discordNames){
   for(const [account,pilot] of names.get(nameKey(name))||[]){
    if(!candidates.has(account))candidates.set(account,pilot);
   }
  }
  if(!candidates.size)continue;
  for(const id of candidates.keys()){
   if(!claimed.has(id))claimed.set(id,new Set());
   claimed.get(id).add(user.id);
  }
  if(candidates.size!==1){ambiguous.add(user.id);continue;}
  const [[user_id,matched_pilot]]=candidates;
  if(!linkedUsers.has(user_id))proposed.set(user.id,{
   user_id,matched_pilot,discord_id:user.id,
   discord_name:displayName({nick,user}),
   discord_username:user.username.slice(0,100),
  });
 }
 const matches=[];
 for(const [id,match] of proposed){
  if(claimed.get(match.user_id).size===1)matches.push(match);
  else ambiguous.add(id);
 }
 return {matches,ambiguous:ambiguous.size};
}

export function discordPilotSync(db,{read,request,snowflake}){
 db.exec(`CREATE TABLE IF NOT EXISTS discord_pilot_matches(
  guild TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,discord_name TEXT NOT NULL,discord_username TEXT NOT NULL,matched_pilot TEXT NOT NULL,
  PRIMARY KEY(guild,user_id),UNIQUE(guild,discord_id));
 CREATE TABLE IF NOT EXISTS discord_pilot_scans(guild TEXT PRIMARY KEY,checked INTEGER NOT NULL,scanned INTEGER NOT NULL,ambiguous INTEGER NOT NULL);`);
 const readMatches=db.prepare(`SELECT m.user_id,m.discord_id,u.name pilot,m.discord_name,m.discord_username,m.matched_pilot
  FROM discord_pilot_matches m JOIN users u ON u.id=m.user_id
  WHERE m.guild=? AND NOT EXISTS(SELECT 1 FROM discord_accounts a WHERE a.user_id=m.user_id OR a.discord_id=m.discord_id)
  ORDER BY u.name COLLATE NOCASE`);
 const readScan=db.prepare('SELECT checked,scanned,ambiguous FROM discord_pilot_scans WHERE guild=?');
 const replacement=db.prepare('DELETE FROM discord_pilot_matches WHERE guild=?');
 const insert=db.prepare('INSERT INTO discord_pilot_matches VALUES (?,?,?,?,?,?)');
 const proposal=db.prepare('SELECT * FROM discord_pilot_matches WHERE guild=? AND user_id=? AND discord_id=?');
 const link=db.prepare(`INSERT INTO discord_accounts(user_id,discord_id,name,checked)
  SELECT m.user_id,m.discord_id,m.discord_username,0 FROM discord_pilot_matches m
  WHERE m.guild=? AND m.user_id=? AND m.discord_id=? AND m.discord_username=? AND m.discord_name=?
   AND (EXISTS(SELECT 1 FROM users u WHERE u.id=m.user_id AND u.name=m.matched_pilot)
    OR EXISTS(SELECT 1 FROM characters c WHERE c.user_id=m.user_id AND c.name=m.matched_pilot))
  ON CONFLICT DO NOTHING`);
 const removeProposal=db.prepare('DELETE FROM discord_pilot_matches WHERE guild=? AND user_id=? AND discord_id=?');
 const writeScan=db.prepare('INSERT INTO discord_pilot_scans VALUES (?,?,?,?) ON CONFLICT(guild) DO UPDATE SET checked=excluded.checked,scanned=excluded.scanned,ambiguous=excluded.ambiguous');
 let running=false;
 const view=guild=>({matches:readMatches.all(guild),scan:readScan.get(guild)||null,running});
 async function approve({user_id,discord_id}={}){
  const connection=read(),guild=connection.guild_id;
  if(!connection.connected||!snowflake(guild))throw conflict('Test the Discord connection before approving links.');
  if(!Number.isSafeInteger(user_id)||user_id<=0||!snowflake(discord_id))throw Object.assign(Error('Choose a saved pilot match.'),{status:400});
  const match=proposal.get(guild,user_id,discord_id);
  if(!match)throw conflict('This match is no longer available. Run Sync Pilots again.');
  let member;
  try{member=await request('/guilds/'+guild+'/members/'+discord_id);}
  catch(error){if(error.discordStatus===404)throw conflict('This Discord account has left the server. Run Sync Pilots again.');throw error;}
  const current=read();
  if(!current.connected||current.guild_id!==guild||current.client_id!==connection.client_id||current.bot_token!==connection.bot_token)
   throw conflict('Discord setup changed. Run Sync Pilots again.');
  if(member?.user?.id!==discord_id||member.user.bot||member.user.system||member.user.username!==match.discord_username||displayName(member)!==match.discord_name)
   throw conflict('This Discord account changed since the scan. Run Sync Pilots again.');
  db.exec('BEGIN');
  try{
   if(!link.run(guild,user_id,discord_id,match.discord_username,match.discord_name).changes)throw conflict('This match changed or one of the accounts is already linked.');
   removeProposal.run(guild,user_id,discord_id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {ok:true};
 }
 async function sync(){
  const connection=read(),guild=connection.guild_id;
  if(!connection.connected||!snowflake(guild))throw Object.assign(Error('Test the Discord connection before syncing pilots.'),{status:400});
  if(running)throw Object.assign(Error('A Discord pilot scan is already running.'),{status:409});
  running=true;
  try{
   const members=new Map();
   let after='0';
   const sameConnection=()=>{
    const current=read();
    if(!current.connected||current.guild_id!==guild||current.client_id!==connection.client_id||current.bot_token!==connection.bot_token)
     throw Object.assign(Error('Discord setup changed during the scan. Run Sync Pilots again.'),{status:409});
   };
   for(;;){
    sameConnection();
    let page;
    try{page=await request('/guilds/'+guild+'/members?limit=1000&after='+after);}
    catch(error){
     if([401,403].includes(error.discordStatus))throw Object.assign(Error('Discord denied the member list. Enable Server Members Intent in the Discord Developer Portal, then retry.'),{status:503});
     throw error;
    }
    if(!Array.isArray(page)||page.length>1000)throw Error('Discord returned an incomplete member list.');
    let cursor=BigInt(after);
    for(const member of page){
     if(!snowflake(member?.user?.id)||typeof member.user.username!=='string'||!member.user.username||
      BigInt(member.user.id)<=BigInt(after)||members.has(member.user.id))throw Error('Discord member list changed during the scan. Try again.');
     members.set(member.user.id,member);
     if(BigInt(member.user.id)>cursor)cursor=BigInt(member.user.id);
    }
    if(page.length<1000)break;
    after=String(cursor);
   }
   sameConnection();
   const pilots=db.prepare('SELECT id user_id,name FROM users UNION SELECT user_id,name FROM characters').all();
   const verified=db.prepare('SELECT user_id,discord_id FROM discord_accounts').all();
   const {matches,ambiguous}=matchDiscordPilots(members.values(),pilots,verified);
   db.exec('BEGIN');
   try{
    replacement.run(guild);
    for(const row of matches)insert.run(guild,row.user_id,row.discord_id,row.discord_name,row.discord_username,row.matched_pilot);
    writeScan.run(guild,Date.now(),members.size,ambiguous);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   return {matched:matches.length,scanned:members.size,ambiguous};
  }finally{running=false;}
 }
 return {view,sync,approve};
}
