// Daily stock prices for an NSE watchlist (Yahoo Finance chart data).
// Prints one line of JSON so n8n's Execute Command node can read it.
// Usage: node stocks.js

// ---- Your watchlist: add or remove stocks here ----
const STOCKS = [
  { code: 'RELIANCE',   name: 'Reliance Industries' },
  { code: 'TCS',        name: 'Tata Consultancy Services' },
  { code: 'HDFCBANK',   name: 'HDFC Bank' },
  { code: 'ICICIBANK',  name: 'ICICI Bank' },
  { code: 'INFY',       name: 'Infosys' },
  { code: 'HINDUNILVR', name: 'Hindustan Unilever' },
  { code: 'ITC',        name: 'ITC' },
  { code: 'SBIN',       name: 'State Bank of India' },
  { code: 'BHARTIARTL', name: 'Bharti Airtel' },
  { code: 'KOTAKBANK',  name: 'Kotak Mahindra Bank' },
  { code: 'LT',         name: 'Larsen & Toubro' },
  { code: 'AXISBANK',   name: 'Axis Bank' },
  { code: 'ASIANPAINT', name: 'Asian Paints' },
  { code: 'MARUTI',     name: 'Maruti Suzuki' },
  { code: 'SUNPHARMA',  name: 'Sun Pharma' },
  { code: 'TITAN',      name: 'Titan Company' },
  { code: 'BAJFINANCE', name: 'Bajaj Finance' },
  { code: 'WIPRO',      name: 'Wipro' },
  { code: 'NTPC',       name: 'NTPC' },
  { code: 'TATASTEEL',  name: 'Tata Steel' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const round = n => (typeof n === 'number' ? Math.round(n * 100) / 100 : '');
// Unix time -> "YYYY-MM-DD" in Indian time
const toDate = sec => new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Fetch the last few trading days for one stock (.NS = NSE)
async function getQuote(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.NS?range=5d&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('No price data');

  const todayDate = toDate(meta.regularMarketTime);
  const times = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  // Previous trading day = latest day before today that has a closing price
  let yesterdayDate = '', yesterdayPrice = null;
  for (let i = times.length - 1; i >= 0; i--) {
    const d = toDate(times[i]);
    if (d < todayDate && typeof closes[i] === 'number') {
      yesterdayDate = d;
      yesterdayPrice = closes[i];
      break;
    }
  }
  if (yesterdayPrice === null) throw new Error('No previous-day data');

  return { meta, todayDate, yesterdayDate, yesterdayPrice };
}

// Where did the price close within the day's range?
function getPressure(price, high, low) {
  if (typeof high !== 'number' || typeof low !== 'number' || high === low) return 'Balanced';
  const pos = (price - low) / (high - low); // 0 = closed at low, 1 = closed at high
  return pos >= 0.66 ? 'Buyers strong' : pos <= 0.33 ? 'Sellers strong' : 'Balanced';
}

async function main() {
  const updatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const rows = [];

  for (const stock of STOCKS) {
    try {
      const { meta: m, todayDate, yesterdayDate, yesterdayPrice } = await getQuote(stock.code);
      const today = m.regularMarketPrice;
      const change = today - yesterdayPrice;

      rows.push({
        stock_code: stock.code,
        stock_name: stock.name,
        today_date: todayDate,
        price_today: round(today),
        yesterday_date: yesterdayDate,
        price_yesterday: round(yesterdayPrice),
        change: round(change),
        change_pct: round((change / yesterdayPrice) * 100),
        trend: change > 0 ? 'Up' : change < 0 ? 'Down' : 'No change',
        pressure: getPressure(today, m.regularMarketDayHigh, m.regularMarketDayLow),
        day_high: round(m.regularMarketDayHigh),
        day_low: round(m.regularMarketDayLow),
        volume: m.regularMarketVolume ?? '',
        updated_at: updatedAt
      });
    } catch (err) {
      console.error(`${stock.code}: ${err.message}`); // shows in n8n's stderr
    }
    await sleep(300); // small pause between stocks
  }

  if (rows.length === 0) {
    console.error('No stock data fetched at all');
    process.exit(1);
  }
  console.log(JSON.stringify(rows));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
