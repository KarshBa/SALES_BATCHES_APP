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

function normalizeDate(maybeDateStr){
  if(!maybeDateStr) return '';
  // assume incoming like "11/02/2025" or "11/2/2025"
  const parts = maybeDateStr.split('/');
  if(parts.length !== 3) return maybeDateStr; // fall back if weird
  let [m,d,y] = parts;
  // strip leading zeros from month/day
  m = String(parseInt(m,10));
  d = String(parseInt(d,10));
  return `${m}/${d}/${y}`;
}

/** CSV export given a batch object (must already be validated externally) */
export function exportCsvFromBatch(batch){
  const header = 'Record Type,UPC,Promo_Price,Promo_Qty,Start_Date,End_Date';
  const rows = batch.lines.map(l=>{
    const promoQty = !l.promoQty || l.promoQty<1 ? 1 : l.promoQty;

    const start = normalizeDate(l.startDate || '');
    const end   = normalizeDate(l.endDate || '');

    const fields = [
      l.recordType || '',
      l.upc || '',
      l.promoPrice != null ? String(l.promoPrice) : '',
      promoQty,
      start,
      end
    ];
    return fields.join(',');
  });
  return [header, ...rows].join('\r\n') + '\r\n';
}


