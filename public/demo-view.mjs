const banner=document.createElement('section');
banner.className='demo-banner';banner.setAttribute('aria-label','Demo information');
banner.innerHTML='<span><strong>EveTools Demo</strong><span class="demo-note">Fictional data · Full admin access · Your changes are private</span></span><span class="demo-actions"><a href="https://github.com/Silent-UK/EveTools" target="_blank" rel="noopener">Get EveTools ↗</a><button type="button">Reset demo</button></span>';
document.body.prepend(banner);
banner.querySelector('button').addEventListener('click',async event=>{
 if(!confirm('Reset your demo and restore the sample data?'))return;
 const button=event.currentTarget;button.disabled=true;
 try{const response=await fetch('/api/demo/reset',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!response.ok)throw Error();localStorage.clear();location.href='/';}catch{button.disabled=false;alert('Could not reset your demo. Please try again.');}
});
