import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = ['Grab it.html','Grab_it.html'].map(n => path.join(__dirname, n)).find(p => fs.existsSync(p)) || path.join(__dirname, 'Grab it.html');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const PORT = Number(process.env.PORT || 3000);
const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const MAX_BODY = 16_384;
const pendingOrders = new Map();
const drops = new Set(['Hostel Block A gate','Hostel Block B gate','Hostel Block C gate','Library entrance','Academic block lobby','Canteen','Staff room corridor']);
const prices = [20,20,25,20,40,50,60,30,35,80,149,90,199,350,299,35,60,30,40,110,2,8,40,45,20,120,40,250,150,70];

function send(res, status, data, type='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let raw='', size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(new Error('Request too large'));req.destroy();return}raw+=chunk});
    req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch{reject(new Error('Invalid JSON'))}});
    req.on('error',reject);
  });
}
async function razorpay(pathname, method='GET', body) {
  const auth=Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const response=await fetch(`https://api.razorpay.com/v1${pathname}`,{
    method, headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined, signal:AbortSignal.timeout(15000)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error?.description || 'Payment provider request failed');
  return payload;
}
function secureEqualHex(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||!/^[0-9a-f]{64}$/i.test(a)||!/^[0-9a-f]{64}$/i.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
async function handle(req,res) {
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/') {
    try { return send(res,200,fs.readFileSync(htmlPath,'utf8'),'text/html; charset=utf-8') }
    catch { return send(res,500,'Website file not found','text/plain; charset=utf-8') }
  }
  if(req.method==='GET'&&url.pathname==='/api/config') return send(res,200,{enabled:Boolean(KEY_ID&&KEY_SECRET),keyId:KEY_ID||null});
  if(req.method==='POST'&&url.pathname==='/api/payments/order') {
    if(!KEY_ID||!KEY_SECRET) return send(res,503,{error:'Add your Razorpay test keys to the .env file to enable checkout.'});
    try {
      const data=await readBody(req);
      if(!Array.isArray(data.items)||!data.items.length||data.items.length>30) return send(res,400,{error:'Your cart is empty or invalid.'});
      const items=[];let subtotal=0;
      for(const item of data.items){
        const index=Number(item?.[0]),quantity=Number(item?.[1]);
        if(!Number.isInteger(index)||index<0||index>=prices.length||!Number.isInteger(quantity)||quantity<1||quantity>20) return send(res,400,{error:'A cart item is invalid.'});
        items.push([index,quantity]);subtotal+=prices[index]*quantity;
      }
      const name=String(data.name||'').trim().slice(0,100);
      const phone=String(data.phone||'').trim();
      const drop=String(data.drop||'');
      const note=String(data.note||'').trim().slice(0,200);
      if(!name||!/^[6-9]\d{9}$/.test(phone)||!drops.has(drop)) return send(res,400,{error:'Check your name, 10-digit Indian phone number, and drop-off point.'});
      const delivery=subtotal<199?15:0,total=subtotal+delivery;
      const receipt=`gi_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const created=await razorpay('/orders','POST',{amount:total*100,currency:'INR',receipt,notes:{source:'Grab it campus demo'}});
      pendingOrders.set(created.id,{items,total,drop,note,name,phone,createdAt:Date.now()});
      for(const [id,order] of pendingOrders) if(Date.now()-order.createdAt>30*60*1000) pendingOrders.delete(id);
      return send(res,200,{orderId:created.id,amount:created.amount,currency:created.currency,keyId:KEY_ID});
    } catch(error) { return send(res,400,{error:error.message||'Could not start checkout.'}) }
  }
  if(req.method==='POST'&&url.pathname==='/api/payments/verify') {
    if(!KEY_ID||!KEY_SECRET) return send(res,503,{error:'Payment checkout is not configured.'});
    try {
      const data=await readBody(req);
      const orderId=String(data.razorpay_order_id||'');
      const paymentId=String(data.razorpay_payment_id||'');
      const supplied=String(data.razorpay_signature||'');
      const order=pendingOrders.get(orderId);
      if(!order||!/^pay_[A-Za-z0-9]+$/.test(paymentId)) return send(res,400,{error:'This checkout could not be matched to an open order.'});
      const expected=crypto.createHmac('sha256',KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
      if(!secureEqualHex(expected,supplied)) return send(res,400,{error:'Payment verification failed. No order was placed.'});
      const payment=await razorpay(`/payments/${encodeURIComponent(paymentId)}`);
      if(payment.order_id!==orderId||payment.amount!==order.total*100||payment.currency!=='INR'||payment.status!=='captured') return send(res,402,{error:'Payment is not confirmed as captured yet. Please check your payment status before retrying.'});
      pendingOrders.delete(orderId);
      return send(res,200,{verified:true,order:{id:`GI${crypto.randomInt(1000,10000)}`,items:order.items,total:order.total,drop:order.drop,note:order.note,pay:'Razorpay · Paid',t:Date.now()}});
    } catch(error) { return send(res,400,{error:error.message||'Could not verify this payment.'}) }
  }
  return send(res,404,{error:'Not found'});
}
http.createServer((req,res)=>{handle(req,res).catch(()=>send(res,500,{error:'Unexpected server error'}))}).listen(PORT,'127.0.0.1',()=>console.log(`Grab it is running at http://localhost:${PORT}`));
