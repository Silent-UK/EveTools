// Leave room for base64 expansion and the rest of the group settings under Nginx's 128 KiB request limit.
const uploadBudget=72*1024;

function asDataUrl(image){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(new Error('This group image could not be read.'));
  reader.readAsDataURL(image);
 });
}

export async function readGroupImage(file){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))
  throw new Error('Choose a PNG, JPEG or WebP image.');
 if(file.size<=uploadBudget)return asDataUrl(file);
 const image=await createImageBitmap(file).catch(()=>{throw new Error('This group image could not be opened.');});
 try{
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d');
  if(!context)throw new Error('This browser could not resize the group image.');
  let scale=Math.min(1,1024/Math.max(image.width,image.height));
  for(let attempt=0;attempt<8;attempt++){
   canvas.width=Math.max(1,Math.round(image.width*scale));
   canvas.height=Math.max(1,Math.round(image.height*scale));
   context.drawImage(image,0,0,canvas.width,canvas.height);
   const resized=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.85));
   if(resized?.size&&resized.size<=uploadBudget)return asDataUrl(resized);
   scale*=0.7;
  }
  throw new Error('This image could not be resized for upload. Try a smaller image.');
 }finally{image.close();}
}
