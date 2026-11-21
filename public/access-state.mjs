import {servicePlugins} from './service-plugin-options.mjs';

// Only access changes rebuild navigation; ordinary snapshot updates keep forms in place.
export function accessChanged(before,after){
 const state=account=>JSON.stringify({main:account?.main_id,recruit:Boolean(account?.recruit),admin:Boolean(account?.admin),owner:Boolean(account?.owner),srp:Boolean(account?.srp),servicePlugins:Object.keys(servicePlugins).filter(id=>account?.service_plugins?.[id]),director:Boolean(account?.director),corporation:Boolean(account?.corporation),recruiter:Boolean(account?.recruiter),inspect:account?.inspect||null,corporate_pages:[...(account?.corporate_pages||[])].sort(),pages:(account?.pages||[]).map(page=>[page.id,page.name,page.section,page.after,page.position])});
 return state(before)!==state(after);
}
export function managementNavigation(account){
 return [...(account.inspect?.recruitment_only?[]:[['groups','◇','Groups'],...(!account.recruit?[...(account.service_plugins?.timerboard?[['timerboard',servicePlugins.timerboard.icon,servicePlugins.timerboard.label]]:[]),...((account.corporate_pages?.includes('corp-calendar')||account.service_plugins?.timerboard)&&account.preferences?.['corp-calendar']!==false?[['corp-calendar','▦','Operations Calendar']]:[]),...(account.srp?[['srp','◇','Ship Replacement']]:[]),...Object.entries(servicePlugins).filter(([id])=>id!=='timerboard'&&account.service_plugins?.[id]).map(([id,plugin])=>[id,plugin.icon,plugin.label]),['settings','⚙','Settings']]:[])]),...(account.recruiter?[['recruitment','♙','Recruitment']]:[]),...(account.recruit?[['recruit-application','♙','Application']]:[])];
}
