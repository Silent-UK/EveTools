export function isotopeEstimate(settings,from,to){
 const route=(settings.routes||[]).find(r=>r.from===from&&r.to===to);
 if(!route)return null;
 const fee=Math.ceil(route.isotopes*route.isotopePrice);
 return Number.isSafeInteger(fee)?{fee,isotopes:route.isotopes,isotopePrice:route.isotopePrice}:null;
}
