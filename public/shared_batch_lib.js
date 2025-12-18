// public/shared_batch_lib.js

export const LS_KEY = 'priceChangeBatches_v1';

export async function loadAllBatches(){
  const res = await fetch('/api/batches', { cache: 'no-store' });
  if (!res.ok) {
    console.error('Failed to load batches', res.status);
    return [];
  }
  return await res.json();
}

export function saveAllBatches(arr){
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

export async function findBatch(id){
  const res = await fetch(`/api/batches/${encodeURIComponent(id)}`, {
    cache: 'no-store'
  });
  if(res.status === 404) return null;
  if(!res.ok){
    console.error('Failed to fetch batch', id, res.status);
    return null;
  }
  return await res.json();
}

export async function upsertBatch(batch){
  // batch.id should already exist (you’re using makeId() for that)
  const method = 'PUT';
  const res = await fetch(`/api/batches/${encodeURIComponent(batch.id)}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  });

  if (res.status === 404) {
    // didn't exist yet -> create
    const createRes = await fetch('/api/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if(!createRes.ok){
      console.error('Failed to create batch', await createRes.text());
    }
    return createRes.ok;
  }

  if(!res.ok){
    console.error('Failed to update batch', await res.text());
    return false;
  }
  return true;
}

export function makeId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

/** Minimal toast (re-used) */
export function toast(msg, type='info'){
  let c = document.getElementById('toastContainer');
  if(!c){
    c = document.createElement('div');
    c.id='toastContainer';
    c.className='toast-container';
    document.body.appendChild(c);
  }
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  c.appendChild(div);
  requestAnimationFrame(()=>div.classList.add('show'));
  setTimeout(()=>{
    div.classList.remove('show');
    setTimeout(()=>div.remove(),300);
  }, 3200);
}

function canonUPC(raw){
  const d = String(raw || '').replace(/\D/g,'');
  if(!d) return '';
  if(d.length === 12) return ('0' + d.slice(0,11)).padStart(13,'0');
  return d.padStart(13,'0');
}

function csvCell(v){
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

function normalizeQty(q){
  const n = parseInt(q, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function normalizeDate(maybeDateStr){
  if(!maybeDateStr) return '';
  const s = String(maybeDateStr).trim();

  // ISO -> M/D/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${parseInt(m,10)}/${parseInt(d,10)}/${y}`;
  }

  // M/D/YYYY or MM/DD/YYYY -> M/D/YYYY
  const parts = s.split('/');
  if(parts.length === 3){
    let [m,d,y] = parts;
    m = String(parseInt(m,10));
    d = String(parseInt(d,10));
    return `${m}/${d}/${y}`;
  }

  return s;
}

/** CSV export given a batch object (must already be validated externally) */
export function exportCsvFromBatch(batch){
  const header = 'Record Type,UPC,Promo_Price,Promo_Qty,Start_Date,End_Date';

  const rows = (batch?.lines || []).map(l=>{
    const fields = [
      l?.recordType || '',
      canonUPC(l?.upc || ''),
      (l?.promoPrice != null && l?.promoPrice !== '') ? String(l.promoPrice) : '',
      normalizeQty(l?.promoQty),
      normalizeDate(l?.startDate || ''),
      normalizeDate(l?.endDate || '')
    ];

    return fields.map(csvCell).join(',');
  });

  return [header, ...rows].join('\r\n') + '\r\n';
}
