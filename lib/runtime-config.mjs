export function runtimeConfig(env=process.env){
 const required=['BASE_URL','DATA_DIR','EVE_CLIENT_ID','EVE_CLIENT_SECRET','ENCRYPTION_KEY','OWNER_CHARACTER_ID','CORPORATION_ID','CORPORATION_NAME','CORPORATION_TICKER','ESI_CONTACT'];
 const missing=required.filter(key=>!String(env[key]||'').trim());
 if(missing.length)throw Error('Configure these environment variables before starting EveTools: '+missing.join(', '));
 const owner=Number(env.OWNER_CHARACTER_ID),corporationId=Number(env.CORPORATION_ID),port=Number(env.PORT||3014);
 if(!Number.isSafeInteger(owner)||owner<=0||!Number.isSafeInteger(corporationId)||corporationId<=0)throw Error('OWNER_CHARACTER_ID and CORPORATION_ID must be positive EVE IDs.');
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be between 1 and 65535.');
 if(!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY))throw Error('ENCRYPTION_KEY must be 32 random bytes encoded as hex.');
 let url;try{url=new URL(env.BASE_URL);}catch{throw Error('BASE_URL must be an absolute HTTPS URL.');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('BASE_URL must be an HTTPS origin, or loopback HTTP for local development.');
 return {base:url.origin,data:env.DATA_DIR,key:env.ENCRYPTION_KEY,client:env.EVE_CLIENT_ID,secret:env.EVE_CLIENT_SECRET,owner,corporationId,corporationName:env.CORPORATION_NAME,corporationTicker:env.CORPORATION_TICKER,siteName:env.SITE_NAME||'EveTools',allianceTicker:env.ALLIANCE_TICKER||'',contact:env.ESI_CONTACT,port};
}
