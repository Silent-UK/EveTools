const expiryDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

export function marketExpiryCell({issued,duration}){
 const start=typeof issued==='string'?Date.parse(issued):NaN;
 if(!Number.isFinite(start)||!Number.isSafeInteger(duration)||duration<=0)return '<td>—</td>';
 const expiry=new Date(start+duration*86400000);
 if(!Number.isFinite(expiry.getTime()))return '<td>—</td>';
 return `<td><time datetime="${expiry.toISOString()}">${expiryDate.format(expiry)}</time></td>`;
}
