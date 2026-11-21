// Reads may be coalesced while in flight. Writes are never automatically retried.
export function createApiClient({network=fetch,readTimeout=45000,writeTimeout=90000}={}){
 const pending=new Map();
 function api(path,body,method='POST'){
  const writing=body!==undefined;
  if(!writing&&pending.has(path))return pending.get(path);
  if(writing)pending.clear();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),writing?writeTimeout:readTimeout);
  const request=(async()=>{
   try{
    const response=await network('/api'+path,{cache:'no-store',signal:controller.signal,...(writing?{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{
     const message=response.status===413?'The upload is too large. Choose a smaller file and try again.':
      'The server returned an unexpected response. Please refresh and try again.';
     throw Object.assign(Error(message),{status:response.status});
    }
    if(!response.ok)throw Object.assign(Error(data?.error||'Request failed (HTTP '+response.status+').'),{status:response.status});
    return data;
   }catch(error){
    if(controller.signal.aborted)throw Error(writing?'This action is taking too long. Check whether it completed before trying again.':'This page is taking too long to load. Please try again.');
    throw error;
   }finally{clearTimeout(timer);}
  })();
  if(!writing){pending.set(path,request);const clear=()=>{if(pending.get(path)===request)pending.delete(path);};request.then(clear,clear);}
  return request;
 }
 return api;
}
