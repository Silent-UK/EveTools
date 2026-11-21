export const recurrenceLabels={none:'Does not repeat',weekly:'Weekly',biweekly:'Bi-weekly',monthly:'Monthly'};
const day=86400000;
const monthIndex=date=>date.getUTCFullYear()*12+date.getUTCMonth();

function monthlyStart(anchor,offset){
 const date=new Date(anchor);
 date.setUTCDate(1);
 date.setUTCMonth(date.getUTCMonth()+offset+1);
 date.setUTCDate(0);
 date.setUTCDate(Math.min(anchor.getUTCDate(),date.getUTCDate()));
 return date.getTime();
}

export function calendarOccurrences(events,from,until){
 const occurrences=[];
 for(const event of events){
  if(!event.manual||!['weekly','biweekly','monthly'].includes(event.recurrence)){
   occurrences.push(event);
   continue;
  }
  const anchor=new Date(event.starts);
  const interval=(event.recurrence==='weekly'?7:14)*day;
  const monthly=event.recurrence==='monthly';
  const first=Math.max(0,monthly?monthIndex(new Date(from))-monthIndex(anchor):Math.floor((from-event.starts)/interval));
  for(let index=first;;index++){
   const starts=monthly?monthlyStart(anchor,index):event.starts+index*interval;
   if(!Number.isFinite(starts)||starts>=until)break;
   if(starts>=from)occurrences.push({...event,starts});
  }
 }
 return occurrences.sort((a,b)=>a.starts-b.starts);
}
