import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = ['Grab it.html','Grab_it.html','index.html'].map(n => path.join(__dirname,n)).find(fs.existsSync);
const envPath = path.join(__dirname,'.env');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)) {
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const PORT=Number(process.env.PORT||3000), MAX_BODY=65536;
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,''), SB_KEY=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'', SB_SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const KEY_ID=process.env.RAZORPAY_KEY_ID||'', KEY_SECRET=process.env.RAZORPAY_KEY_SECRET||'';
const TEST_PAYMENT=KEY_ID.startsWith('rzp_test_');
const drops=['Hostel Block A gate','Hostel Block B gate','Hostel Block C gate','Library entrance','Academic block lobby','Canteen','Staff room corridor'];
const products=[['Cola 250 ml',20],['Packaged water',20],['Cream biscuits',25],['Potato chips',20],['Chocolate bar',40],['Gel pens',50],['Ruled notebook',60],['Plastic file',30],['A4 paper',35],['Highlighters',80],['USB-C cable',149],['AA batteries',90],['Wired earphones',199],['Pen drive 32 GB',350],['Wired mouse',299],['Soap bar',35],['Hand wash',60],['Toothbrush',30],['Tissue pack',40],['Face wash',110],['B&W printout',2],['Colour printout',8],['Spiral binding',40],['Assignment folder',45],['Chart paper',20],['Torch',120],['Sticky notes',40],['Umbrella',250],['Water bottle',150],['Stapler + pins',70]];
const send=(res,status,data,type='application/json; charset=utf-8',headers={})=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(res.refreshCookie?{'Set-Cookie':res.refreshCookie}:{}),...headers});res.end(type.startsWith('application/json')?JSON.stringify(data):data)};
function body(req){return new Promise((resolve,reject)=>{let raw='',size=0;req.on('data',c=>{size+=c.length;if(size>MAX_BODY){reject(new Error('Request too large'));req.destroy();return}raw+=c});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch{reject(new Error('Invalid JSON'))}});req.on('error',reject)})}
function cookie(req,name='grabitr_session'){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1)||''}
async function supa(endpoint,{method='GET',token='',body:payload,prefer}={}){
  if(!SB_URL||!SB_KEY)throw new Error('Supabase is not configured. Follow README.md to add the project URL and anon key.');
  const resp=await fetch(`${SB_URL}/rest/v1/${endpoint}`,{method,headers:{apikey:SB_KEY,Authorization:`Bearer ${token||SB_KEY}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  const raw=await resp.text();let data;try{data=raw?JSON.parse(raw):null}catch{data={message:raw}}
  if(!resp.ok)throw new Error(data?.message||data?.msg||data?.error_description||'Database request failed');return data;
}
async function auth(pathname,payload){if(!SB_URL||!SB_KEY)throw new Error('Supabase is not configured. Follow README.md to add the project URL and anon key.');const r=await fetch(`${SB_URL}/auth/v1${pathname}`,{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.msg||d.message||d.error_description||'Authentication failed');return d}
async function current(req,res){let token=cookie(req);if(!token||!SB_URL||!SB_KEY)return null;let r=await fetch(`${SB_URL}/auth/v1/user`,{headers:{apikey:SB_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});if(r.ok)return {token,user:await r.json()};const refresh=cookie(req,'grabitr_refresh');if(!refresh)return null;const rr=await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(10000)});const next=await rr.json().catch(()=>({}));if(!rr.ok||!next.access_token)return null;const secure=process.env.NODE_ENV==='production'?'; Secure':'';res.refreshCookie=[`grabitr_session=${next.access_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${next.expires_in||3600}${secure}`,`grabitr_refresh=${next.refresh_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`];return {token:next.access_token,user:next.user}}
async function razor(pathname,method='GET',payload){const a=Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');const r=await fetch(`https://api.razorpay.com/v1${pathname}`,{method,headers:{Authorization:`Basic ${a}`,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.description||'Payment provider request failed');return d}
function safeUser(u){return {id:u.id,email:u.email,user_metadata:u.user_metadata||{}}}
async function handle(req,res){const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/'){if(!htmlPath)return send(res,500,{error:'Website file not found'});return send(res,200,fs.readFileSync(htmlPath,'utf8'),'text/html; charset=utf-8')}
  if(req.method==='GET'&&url.pathname==='/api/config')return send(res,200,{enabled:Boolean(TEST_PAYMENT&&KEY_SECRET),keyId:TEST_PAYMENT?KEY_ID:null,supabaseEnabled:Boolean(SB_URL&&SB_KEY)});
  if(req.method==='GET'&&url.pathname==='/api/products')try{return send(res,200,{products:await supa('products?select=id,name,price,stock,active,category,icon,unit&active=eq.true&order=id')})}catch(e){return send(res,503,{error:e.message})}
  if(req.method==='POST'&&url.pathname==='/api/auth/session'){
    if(!SB_URL||!SB_KEY)return send(res,503,{error:'Sign-in is not configured.'});
    try{
      const d=await body(req),accessToken=String(d.access_token||''),refreshToken=String(d.refresh_token||'');
      if(accessToken.length>8192||refreshToken.length>2048||!/^[-A-Za-z0-9._~]+$/.test(accessToken)||!/^[-A-Za-z0-9._~]+$/.test(refreshToken))return send(res,400,{error:'The confirmation link is invalid. Please request a new one.'});
      const response=await fetch(`${SB_URL}/auth/v1/user`,{headers:{apikey:SB_KEY,Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(10000)});
      const verified=await response.json().catch(()=>({}));
      if(!response.ok||!(verified.email_confirmed_at||verified.confirmed_at))return send(res,401,{error:'Email confirmation could not be verified. Please request a new confirmation email.'});
      const secure=process.env.NODE_ENV==='production'?'; Secure':'';
      return send(res,200,{user:safeUser(verified)},'application/json; charset=utf-8',{'Set-Cookie':[`grabitr_session=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${secure}`,`grabitr_refresh=${refreshToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`]});
    }catch(e){return send(res,400,{error:'Could not finish signing in. Please request a new confirmation email.'})}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/signup'||req.method==='POST'&&url.pathname==='/api/auth/login'){
    try{const d=await body(req);if(req.url.includes('signup')){const name=String(d.name||'').trim().slice(0,100),phone=String(d.phone||'').trim();if(!name)throw new Error('Enter your name.');if(!/^[6-9]\d{9}$/.test(phone))throw new Error('Enter a valid 10-digit Indian mobile number.');const out=await auth('/signup',{email:String(d.email||'').trim(),password:String(d.password||''),data:{full_name:name,phone}});if(!out.access_token)return send(res,200,{needsEmailConfirmation:true,message:'Check your email to confirm your account, then log in.'});const secure=process.env.NODE_ENV==='production'?'; Secure':'';return send(res,200,{user:safeUser(out.user)},'application/json; charset=utf-8',{'Set-Cookie':[`grabitr_session=${out.access_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${out.expires_in||3600}${secure}`,`grabitr_refresh=${out.refresh_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`]})}
      const out=await auth('/token?grant_type=password',{email:String(d.email||'').trim(),password:String(d.password||'')});const secure=process.env.NODE_ENV==='production'?'; Secure':'';return send(res,200,{user:safeUser(out.user)},'application/json; charset=utf-8',{'Set-Cookie':[`grabitr_session=${out.access_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${out.expires_in||3600}${secure}`,`grabitr_refresh=${out.refresh_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`]});
    }catch(e){return send(res,400,{error:e.message})}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/logout')return send(res,200,{ok:true},'application/json; charset=utf-8',{'Set-Cookie':['grabitr_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0','grabitr_refresh=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0']});
  if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/config'){
    let session;try{session=await current(req,res)}catch{}if(!session)return send(res,401,{error:'Please log in to continue.'});const uid=session.user.id,token=session.token;
    if(req.method==='GET'&&url.pathname==='/api/auth/me')return send(res,200,{user:safeUser(session.user)});
    if(req.method==='GET'&&url.pathname==='/api/cart')try{const rows=await supa(`carts?user_id=eq.${uid}&select=items&limit=1`,{token});return send(res,200,{items:rows?.[0]?.items||[]})}catch(e){return send(res,500,{error:e.message})}
    if(req.method==='PUT'&&url.pathname==='/api/cart')try{const d=await body(req);if(!Array.isArray(d.items)||d.items.length>30)return send(res,400,{error:'Invalid cart.'});const items=d.items.map(x=>[Number(x[0]),Number(x[1])]);if(items.some(([i,n])=>!Number.isInteger(i)||i<0||i>=products.length||!Number.isInteger(n)||n<1||n>20))return send(res,400,{error:'Invalid cart item.'});await supa('carts?on_conflict=user_id',{method:'POST',token,body:{user_id:uid,items,updated_at:new Date().toISOString()},prefer:'resolution=merge-duplicates,return=minimal'});return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}
    if(req.method==='GET'&&url.pathname==='/api/orders')try{const rows=await supa(`orders?user_id=eq.${uid}&select=id,status,total,delivery_method,delivery_point,note,created_at,order_items(product_index,quantity,unit_price)&order=created_at.desc&limit=50`,{token});return send(res,200,{orders:rows})}catch(e){return send(res,500,{error:e.message})}
    if(req.method==='POST'&&url.pathname==='/api/orders')try{const d=await body(req);const result=await createOrder(uid,token,d);return send(res,201,result)}catch(e){return send(res,400,{error:e.message})}
    if(req.method==='POST'&&url.pathname==='/api/payments/order'){
      if(!TEST_PAYMENT||!KEY_SECRET)return send(res,503,{error:'Razorpay Test Mode keys are not configured (the key ID must begin rzp_test_).'});
      let draft;
      try{
        const d=await body(req);
        // Keep the saved cart until Razorpay confirms a captured payment.
        draft=await createOrder(uid,token,{...d,delivery_method:'Razorpay',status:'payment_pending'},{clearCart:false});
        const rp=await razor('/orders','POST',{amount:draft.amount,currency:'INR',receipt:`gi_${crypto.randomBytes(8).toString('hex')}`});
        const linked=await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${encodeURIComponent(uid)}&status=eq.payment_pending`,{
          method:'PATCH',
          headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`,'Content-Type':'application/json',Prefer:'return=representation'},
          body:JSON.stringify({razorpay_order_id:rp.id})
        });
        const linkedRows=await linked.json().catch(()=>[]);
        if(!linked.ok||!Array.isArray(linkedRows)||linkedRows.length!==1)throw new Error('Could not securely link the Razorpay order to your saved order.');
        return send(res,200,{orderId:rp.id,amount:rp.amount,currency:rp.currency,keyId:KEY_ID,dbOrderId:draft.id});
      }catch(e){
        // Remove an unpaid draft if checkout setup failed; the customer's cart remains intact.
        if(draft?.id)await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${encodeURIComponent(uid)}&status=eq.payment_pending&payment_status=eq.pending`,{
          method:'DELETE',
          headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`}
        }).catch(()=>{});
        return send(res,400,{error:e.message});
      }
    }
    if(req.method==='POST'&&url.pathname==='/api/payments/verify'){
      if(!TEST_PAYMENT||!KEY_SECRET)return send(res,503,{error:'Razorpay Test Mode keys are not configured.'});
      try{
        const d=await body(req);
        const orderId=String(d.razorpay_order_id||''),paymentId=String(d.razorpay_payment_id||''),signature=String(d.razorpay_signature||'');
        if(!/^order_[A-Za-z0-9]+$/.test(orderId)||!/^pay_[A-Za-z0-9]+$/.test(paymentId)||!/^[a-f0-9]{64}$/i.test(signature))return send(res,400,{error:'The payment confirmation details are invalid.'});
        const rows=await supa(`orders?user_id=eq.${encodeURIComponent(uid)}&razorpay_order_id=eq.${encodeURIComponent(orderId)}&select=id,total,status,payment_status,razorpay_payment_id&limit=1`,{token});
        const order=rows?.[0];
        if(!order)return send(res,400,{error:'This checkout could not be matched to your order.'});
        // Make repeated browser callbacks safe without allowing a different payment to reuse the order.
        if(order.payment_status==='paid'&&order.razorpay_payment_id===paymentId)return send(res,200,{verified:true,order:await getOrder(order.id,token)});
        if(order.status!=='payment_pending'||order.payment_status!=='pending')return send(res,409,{error:'This order is no longer awaiting payment.'});
        const expected=crypto.createHmac('sha256',KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
        if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex')))return send(res,400,{error:'Payment signature verification failed.'});
        const p=await razor(`/payments/${encodeURIComponent(paymentId)}`);
        if(p.order_id!==orderId||p.amount!==Number(order.total)*100||p.currency!=='INR'||p.status!=='captured')return send(res,402,{error:'Payment is not confirmed as captured.'});
        const ur=await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}&user_id=eq.${encodeURIComponent(uid)}&status=eq.payment_pending&payment_status=eq.pending`,{
          method:'PATCH',
          headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`,'Content-Type':'application/json',Prefer:'return=representation'},
          body:JSON.stringify({status:'received',payment_status:'paid',razorpay_payment_id:paymentId})
        });
        const updated=await ur.json().catch(()=>[]);
        if(!ur.ok)throw new Error('Payment verified, but the order status could not be updated. Contact support with your payment ID.');
        if(!Array.isArray(updated)||updated.length!==1){
          const latest=await supa(`orders?user_id=eq.${encodeURIComponent(uid)}&id=eq.${encodeURIComponent(order.id)}&select=payment_status,razorpay_payment_id&limit=1`,{token});
          if(latest?.[0]?.payment_status!=='paid'||latest[0]?.razorpay_payment_id!==paymentId)return send(res,409,{error:'The order payment state changed. Please contact support with your payment ID.'});
        }
        await supa(`carts?user_id=eq.${encodeURIComponent(uid)}`,{method:'DELETE',token,prefer:'return=minimal'});
        return send(res,200,{verified:true,order:await getOrder(order.id,token)});
      }catch(e){return send(res,400,{error:e.message})}
    }
    if(url.pathname.startsWith('/api/admin'))return admin(req,res,session,url);
  }
  return send(res,404,{error:'Not found'});
}
async function createOrder(uid,token,d,{clearCart=true}={}){
  if(!SB_SERVICE)throw new Error('Orders need SUPABASE_SERVICE_ROLE_KEY configured on the server.');
  if(!Array.isArray(d.items)||!d.items.length||d.items.length>30)throw new Error('Your cart is empty or invalid.');const items=d.items.map(x=>[Number(x[0]),Number(x[1])]);if(items.some(([i,n])=>!Number.isInteger(i)||i<0||!Number.isInteger(n)||n<1||n>20))throw new Error('A cart item is invalid.');
  const name=String(d.name||'').trim().slice(0,100),phone=String(d.phone||'').trim(),drop=String(d.drop||'');if(!name||!/^[6-9]\d{9}$/.test(phone)||!drops.includes(drop))throw new Error('Check your name, 10-digit Indian phone number, and drop-off point.');
  const live=await supa(`products?id=in.(${items.map(([i])=>i).join(',')})&select=id,price,stock,active`,{});const byId=new Map(live.map(x=>[x.id,x]));
  for(const [i,n] of items){const p=byId.get(i);if(!p||!p.active)throw new Error('An item in your cart is no longer available.');if(p.stock<n)throw new Error('There is not enough stock for every item in your cart.')}
  const subtotal=items.reduce((s,[i,n])=>s+Number(byId.get(i).price)*n,0),total=subtotal+(subtotal<199?15:0),pay=String(d.delivery_method||'Cash on delivery');if(!['Cash on delivery','UPI on delivery','Razorpay'].includes(pay))throw new Error('Choose a valid payment method.');
  const base={apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`,'Content-Type':'application/json',Prefer:'return=representation'};
  const response=await fetch(`${SB_URL}/rest/v1/orders`,{method:'POST',headers:base,body:JSON.stringify({user_id:uid,customer_name:name,phone,delivery_point:drop,note:String(d.note||'').trim().slice(0,200),delivery_method:pay,total,status:d.status==='payment_pending'?'payment_pending':'received',payment_status:d.status==='payment_pending'?'pending':'unpaid'})});const created=await response.json();if(!response.ok)throw new Error(created.message||'Could not save your order.');const order=created[0];
  const ir=await fetch(`${SB_URL}/rest/v1/order_items`,{method:'POST',headers:{...base,Prefer:'return=minimal'},body:JSON.stringify(items.map(([i,n])=>({order_id:order.id,product_index:i,quantity:n,unit_price:byId.get(i).price})))});if(!ir.ok){await fetch(`${SB_URL}/rest/v1/orders?id=eq.${order.id}`,{method:'DELETE',headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`}});throw new Error('Could not save order items. Please try again.');}
  if(clearCart)await supa(`carts?user_id=eq.${uid}`,{method:'DELETE',token,prefer:'return=minimal'});return {id:order.id,amount:total*100,order:await getOrder(order.id,token)};
}
async function getOrder(id,token){const r=await fetch(`${SB_URL}/rest/v1/orders?id=eq.${id}&select=id,status,total,delivery_method,delivery_point,note,created_at,order_items(product_index,quantity,unit_price)&limit=1`,{headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`}});const rows=await r.json();return rows?.[0]||null}
async function admin(req,res,session,url){if(!SB_SERVICE)return send(res,503,{error:'Admin features require SUPABASE_SERVICE_ROLE_KEY on the server.'});try{const r=await fetch(`${SB_URL}/rest/v1/profiles?user_id=eq.${session.user.id}&select=role&limit=1`,{headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`}});const p=await r.json();if(!r.ok||p?.[0]?.role!=='admin')return send(res,403,{error:'Admin access required.'});const endpoint=url.pathname.slice('/api/admin'.length);
    if(req.method==='GET'&&!endpoint)return send(res,200,{admin:true});
    if(req.method==='GET'&&endpoint==='/orders'){const x=await fetch(`${SB_URL}/rest/v1/orders?select=*,order_items(*)&order=created_at.desc&limit=200`,{headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`}});return send(res,x.status,await x.json())}
    if(req.method==='PATCH'&&endpoint.startsWith('/orders/')){const id=endpoint.split('/')[2],d=await body(req);const x=await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({status:String(d.status||'').slice(0,32)})});return send(res,x.status,await x.json().catch(()=>({ok:x.ok})))}
    if(req.method==='GET'&&endpoint==='/products'){const x=await fetch(`${SB_URL}/rest/v1/products?select=*&order=id`,{headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`}});return send(res,x.status,await x.json())}
    if((req.method==='POST'||req.method==='PATCH'||req.method==='DELETE')&&endpoint.startsWith('/products')){const id=endpoint.split('/')[2];const d=req.method==='DELETE'?{active:false}:await body(req);const x=await fetch(`${SB_URL}/rest/v1/products${id?`?id=eq.${encodeURIComponent(id)}`:''}`,{method:req.method==='DELETE'?'PATCH':req.method,headers:{apikey:SB_SERVICE,Authorization:`Bearer ${SB_SERVICE}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(d)});return send(res,x.status,await x.json().catch(()=>({ok:x.ok})))}
    return send(res,404,{error:'Admin endpoint not found.'});
  }catch(e){return send(res,500,{error:e.message})}}
http.createServer((req,res)=>handle(req,res).catch(e=>send(res,500,{error:e.message||'Unexpected server error'}))).listen(PORT,'0.0.0.0',()=>console.log(`Grab it listening on port ${PORT}`));
