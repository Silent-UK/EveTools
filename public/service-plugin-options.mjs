export const servicePlugins = {
 timerboard: {label:'Timerboard',icon:'◷',description:'Track friendly, hostile and neutral structure timers.'},
 buyback: {label:'Buyback', icon:'◈', description:'Sell items to the corporation through an agreed quote.', quote:'Buyback offer', complete:'Mark paid', completed:'Paid'},
 logistics: {label:'Logistics', icon:'↗', description:'Request a haul and agree the delivery fee.', quote:'Hauling fee', complete:'Mark delivered', completed:'Delivered'}
};

export function pluginToggle(label,enabled,description='',icon='◇') {
 return `<label class="setting-row plugin-card-header"><span class="plugin-card-icon" aria-hidden="true">${icon}</span><span class="plugin-card-copy"><strong>${label}</strong>${description?`<small>${description}</small>`:''}</span>
  <span class="plugin-switch"><input class="slide-toggle" name="enabled" type="checkbox" role="switch" ${enabled?'checked':''}><span aria-hidden="true" class="plugin-switch-off">Off</span><span aria-hidden="true" class="plugin-switch-on">On</span></span></label>`;
}

// Keep the controls in sync with the saved settings while the sidebar reloads.
export function autosavePluginSettings(selector,{api,refresh,toast},settings){
 document.addEventListener('change',async event=>{
  const form=event.target.closest(selector);
  if(!form)return;
  const fields=new FormData(form);
  const update=settings(form,fields);
  if(!update)return;
  const controls=[...document.querySelectorAll('[data-plugin] input,[data-plugin] select,[data-service-settings] input,[data-service-settings] select')]
   .filter(control=>!control.disabled);
  for(const control of controls)control.disabled=true;
  try{
   await api(update.path,update.body);
   await refresh(true);
  }catch(error){
   try{await refresh(true);}catch{form.reset();}
   toast(error.message);
  }finally{
   for(const control of controls)control.disabled=false;
  }
 });
}
