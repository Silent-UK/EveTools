export function buybackItems(text) {
 return text.split(/\r\n?|\n/).filter(line=>line.trim()).map(line=>{
  const [name,quantity,...columns]=line.replace(/<\/?right>/gi,'').split(/\t|<t>/i).map(value=>value.trim());
  const amount=columns.find(value=>/^\d[\d,]*(?:\.\d{1,2})?\s+ISK$/i.test(value));
  const volume=columns.find(value=>/^\d[\d,]*(?:\.\d+)?\s+m[³3]$/i.test(value));
  const count=quantity?.replaceAll(',','') || '1';
  return {name:name || line.trim(),quantity:/^\d+$/.test(count) && Number.isSafeInteger(Number(count)) ? Number(count) : null,
   volume:volume || null, cents:amount ? Math.round(Number.parseFloat(amount.replaceAll(',',''))*100) : null};
 });
}
