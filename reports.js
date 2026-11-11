// Finds each company's latest quarterly results filing on BSE.
// Prints one line of JSON so n8n's Execute Command node can read it.
// Usage: node reports.js               (all stocks)
//        node reports.js INFY,TCS      (only these stocks)

// ---- NSE code -> BSE scrip code (BSE uses numbers) ----
const BSE_CODES = {
  RELIANCE: '500325', TCS: '532540', HDFCBANK: '500180', ICICIBANK: '532174',
  INFY: '500209', HINDUNILVR: '500696', ITC: '500875', SBIN: '500112',
  BHARTIARTL: '532454', KOTAKBANK: '500247', LT: '500510', AXISBANK: '532215',
  ASIANPAINT: '500820', MARUTI: '532500', SUNPHARMA: '524715', TITAN: '500114',
  BAJFINANCE: '500034', WIPRO: '507685', NTPC: '532555', TATASTEEL: '500470'
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.bseindia.com/',
  'Origin': 'https://www.bseindia.com'
};

// BSE keeps new PDFs in AttachLive and moves older ones to AttachHis
const PDF_FOLDERS = [
  'https://www.bseindia.com/xml-data/corpfiling/AttachLive/',
  'https://www.bseindia.com/xml-data/corpfiling/AttachHis/'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

// Which quarter's results are we waiting for? (= last completed quarter)
function currentQuarter(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  let endMonth, endYear;
  if (m <= 3)      { endMonth = 12; endYear = y - 1; }
  else if (m <= 6) { endMonth = 3;  endYear = y; }
  else if (m <= 9) { endMonth = 6;  endYear = y; }
  else             { endMonth = 9;  endYear = y; }
  const q = { 6: 1, 9: 2, 12: 3, 3: 4 }[endMonth];
  const fy = (endMonth === 3 ? endYear : endYear + 1) % 100;
  const endDate = new Date(Date.UTC(endYear, endMonth, 0));
  return { label: `Q${q}FY${fy}`, startSearch: new Date(endDate.getTime() + 86400000) };
}

// Ask BSE, retry up to 4 times if it fails
async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`BSE HTTP ${res.status}`);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { throw new Error('BSE did not return JSON (blocked?)'); }
    } catch (err) {
      lastError = err;
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

// Find which folder actually has the PDF (tries AttachLive, then AttachHis)
async function findPdfUrl(fileName) {
  for (const base of PDF_FOLDERS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(base + fileName, { method: 'HEAD', headers: HEADERS });
        if (res.ok) return base + fileName;
        break; // got an answer (e.g. 404) - try the next folder
      } catch {
        await sleep(1500); // connection hiccup - try once more
      }
    }
  }
  return PDF_FOLDERS[1] + fileName; // fallback: archive folder
}

// Get all announcements for one company
async function getAnnouncements(scrip, from, to) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const url = 'https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w'
      + `?pageno=${page}&strCat=-1&strPrevDate=${ymd(from)}&strScrip=${scrip}`
      + `&strSearch=P&strToDate=${ymd(to)}&strType=C&subcategory=-1`;
    const data = await fetchJson(url);
    const rows = data.Table || [];
    all.push(...rows);
    const total = data.Table1?.[0]?.ROWCNT ?? 0;
    if (rows.length === 0 || all.length >= total) break;
    await sleep(2000);
  }
  return all;
}

// Pick the results filing: Result category or a Board Meeting outcome, consolidated preferred
function pickResult(rows) {
  const candidates = rows.filter(r => {
    if (!r.ATTACHMENTNAME) return false;
    const cat = (r.CATEGORYNAME || '').toLowerCase();
    const subject = (r.NEWSSUB || '').toLowerCase();
    const text = `${r.NEWSSUB || ''} ${r.HEADLINE || ''}`.toLowerCase();
    if (/intimation|newspaper|trading window|transcript|analyst|investor meet|press release|investor presentation|audio recording/.test(subject)) return false;
    const isResultCategory = cat.includes('result');
    const isBoardOutcome = cat.includes('board meeting') && text.includes('outcome') && /financial result|results/.test(text);
    return isResultCategory || isBoardOutcome;
  });
  if (!candidates.length) return null;
  const score = r => {
    const cat = (r.CATEGORYNAME || '').toLowerCase();
    const text = `${r.NEWSSUB || ''} ${r.HEADLINE || ''}`.toLowerCase();
    return (text.includes('consolidated') ? 4 : 0) + (cat.includes('result') ? 2 : 0) + (text.includes('financial result') ? 1 : 0);
  };
  candidates.sort((a, b) => score(b) - score(a) || String(a.NEWS_DT).localeCompare(String(b.NEWS_DT)));
  return candidates[0];
}

async function main() {
  const wanted = (process.argv[2] || Object.keys(BSE_CODES).join(','))
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const { label, startSearch } = currentQuarter();
  const today = new Date();
  const out = [];

  for (const code of wanted) {
    const scrip = BSE_CODES[code];
    console.error(`Checking ${code}...`);
    if (!scrip) {
      out.push({ stock_code: code, report_quarter: label, result: 'Failed', error: 'Unknown stock code' });
      continue;
    }
    try {
      const r = pickResult(await getAnnouncements(scrip, startSearch, today));
      if (r) {
        out.push({
          stock_code: code,
          report_quarter: label,
          result: 'Found',
          report_date: String(r.NEWS_DT || '').slice(0, 10),
          report_title: (r.NEWSSUB || r.HEADLINE || '').replace(/\s+/g, ' ').trim(),
          pdf_url: await findPdfUrl(r.ATTACHMENTNAME),
          file_name: `${code}_${label}.pdf`
        });
      } else {
        out.push({ stock_code: code, report_quarter: label, result: 'Not yet' });
      }
    } catch (err) {
      out.push({ stock_code: code, report_quarter: label, result: 'Failed', error: err.message });
    }
    await sleep(2000); // wait 2 seconds between stocks
  }

  console.log(JSON.stringify(out));
}

main().catch(err => { console.error(err.message); process.exit(1); });
