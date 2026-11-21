export function validSubscriptionDate(value) {
 if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value;
}
export function subscriptionStatus(value,now=Date.now()) {
 if(!validSubscriptionDate(value))return {label:'Not set',color:null,days:null};
 const today=new Date(now).toISOString().slice(0,10);
 const days=Math.round((Date.parse(value+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 const color=days>=30?"var(--green)":days===10?"var(--warning,#e6b65c)":days<=0?"var(--red,#f57878)":days>10?"color-mix(in srgb,var(--green) "+(days-10)*5+"%,var(--warning,#e6b65c))":"color-mix(in srgb,var(--warning,#e6b65c) "+Math.max(0,days)*10+"%,var(--red,#f57878))";
 return {days,label:days<0?'Expired':`${days} ${days===1?'day':'days'}`,color};
}

export function characterSubscription(c,chars,now=Date.now()) {
 const owner=chars.find(p=>p.id===c.parent_id)||c;
 const mct=owner.id!==c.id&&c.mct_enabled===true;
 const recurring=!mct&&owner.subscription_recurring===true;
 const expiry=mct?c.mct_expires_on:owner.subscription_end;
 return {owner,mct,recurring,expiry,...(recurring?{label:'Recurring',days:null,color:null}:subscriptionStatus(expiry,now))};
}
