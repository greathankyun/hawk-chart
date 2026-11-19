// Market catalog for non-crypto instruments. Codes follow Yahoo Finance conventions:
// 2330.TW 上市、6488.TWO 上櫃、^ 指數、=F 期貨、=X 外匯。px is only a rough level used by the offline demo.
export const CATS = [
  { k: 'crypto', name: '加密貨幣' },
  { k: 'tw', name: '台股' },
  { k: 'us', name: '美股' },
  { k: 'idx', name: '指數' },
  { k: 'cmd', name: '原物料' },
  { k: 'fx', name: '外匯' },
  { k: 'intl', name: '海外' },
];
export const catName = k => (CATS.find(c => c.k === k) || {}).name || '';

const L = (cat, rows) => rows.trim().split('\n').map(r => { const [code, name, px] = r.trim().split('|'); return { code, name, cat, px: px ? +px : undefined }; });

export const CATALOG = [
  ...L('tw', `
2330.TW|台積電|1000
2317.TW|鴻海|200
2454.TW|聯發科|1300
2308.TW|台達電|600
2382.TW|廣達|280
2412.TW|中華電|130
2881.TW|富邦金|90
2882.TW|國泰金|65
2891.TW|中信金|45
2303.TW|聯電|48
3711.TW|日月光投控|160
2886.TW|兆豐金|40
2884.TW|玉山金|30
2885.TW|元大金|35
2892.TW|第一金|28
2880.TW|華南金|30
5880.TW|合庫金|25
2887.TW|台新金|18
1216.TW|統一|80
2002.TW|中鋼|22
2603.TW|長榮|200
2609.TW|陽明|65
2615.TW|萬海|80
2618.TW|長榮航|38
2610.TW|華航|22
3231.TW|緯創|110
2357.TW|華碩|600
2376.TW|技嘉|280
2345.TW|智邦|900
3008.TW|大立光|2300
2207.TW|和泰車|600
1301.TW|台塑|40
1303.TW|南亞|40
6505.TW|台塑化|40
2912.TW|統一超|260
2395.TW|研華|350
3034.TW|聯詠|450
3037.TW|欣興|150
2379.TW|瑞昱|520
4938.TW|和碩|70
2301.TW|光寶科|110
2408.TW|南亞科|60
3661.TW|世芯-KY|3000
3443.TW|創意|1400
6669.TW|緯穎|2500
2327.TW|國巨|550
3017.TW|奇鋐|700
2059.TW|川湖|1100
1101.TW|台泥|30
6488.TWO|環球晶|400
5347.TWO|世界|100
8299.TWO|群聯|500
3105.TWO|穩懋|130
5274.TWO|信驊|4000
3529.TWO|力旺|2500
0050.TW|元大台灣50|190
006208.TW|富邦台50|110
0056.TW|元大高股息|36
00878.TW|國泰永續高股息|22
00919.TW|群益台灣精選高息|23
00929.TW|復華台灣科技優息|18
00940.TW|元大台灣價值高息|9
00713.TW|元大台灣高息低波|52
00631L.TW|元大台灣50正2|200
00632R.TW|元大台灣50反1|5
00679B.TWO|元大美債20年|28
`),
  ...L('us', `
AAPL|蘋果|230
MSFT|微軟|420
NVDA|輝達|140
GOOGL|Alphabet|170
AMZN|亞馬遜|200
META|Meta|560
TSLA|特斯拉|300
AVGO|博通|170
TSM|台積電 ADR|190
AMD|超微|150
NFLX|網飛|800
INTC|英特爾|23
QCOM|高通|160
MU|美光|100
ARM|安謀|140
SMCI|美超微|40
PLTR|Palantir|60
ORCL|甲骨文|180
CRM|Salesforce|300
ADBE|Adobe|500
ASML|艾司摩爾|700
UBER|Uber|75
COIN|Coinbase|250
MSTR|MicroStrategy|300
JPM|摩根大通|240
BRK-B|波克夏 B|470
V|Visa|300
MA|萬事達|520
WMT|沃爾瑪|85
COST|好市多|900
KO|可口可樂|65
DIS|迪士尼|110
NKE|Nike|75
BA|波音|160
XOM|埃克森美孚|120
LLY|禮來|800
UNH|聯合健康|560
SPY|標普500 ETF|590
VOO|Vanguard 標普500 ETF|540
QQQ|那斯達克100 ETF|510
DIA|道瓊 ETF|440
IWM|羅素2000 ETF|230
SOXX|半導體 ETF|220
SMH|半導體 ETF (VanEck)|240
TQQQ|那斯達克 3倍做多|80
SOXL|半導體 3倍做多|30
TLT|美債20年 ETF|92
GLD|黃金 ETF|250
SLV|白銀 ETF|28
USO|原油 ETF|75
`),
  ...L('idx', `
^TWII|台灣加權指數|23000
^GSPC|標普500|5900
^DJI|道瓊工業|43000
^IXIC|那斯達克綜合|19000
^NDX|那斯達克100|21000
^SOX|費城半導體|5000
^RUT|羅素2000|2300
^VIX|VIX 恐慌指數|16
^N225|日經225|39000
^HSI|恒生指數|20000
000001.SS|上證指數|3300
^KS11|韓國綜合|2500
^FTSE|英國富時100|8200
^GDAXI|德國 DAX|19500
^FCHI|法國 CAC40|7300
^STOXX50E|歐洲斯托克50|4900
ES=F|標普500 期貨|5900
NQ=F|那斯達克100 期貨|21000
YM=F|道瓊期貨|43000
RTY=F|羅素2000 期貨|2300
DX-Y.NYB|美元指數|106
^TNX|美國10年期公債殖利率|4.3
^FVX|美國5年期公債殖利率|4.1
^TYX|美國30年期公債殖利率|4.5
^IRX|美國13週國庫券殖利率|4.4
`),
  ...L('cmd', `
GC=F|黃金|2650
SI=F|白銀|31
PL=F|白金|950
PA=F|鈀金|1000
HG=F|銅|4.2
ALI=F|鋁|2500
CL=F|WTI 原油|70
BZ=F|布蘭特原油|74
NG=F|天然氣|3
RB=F|汽油|2
HO=F|熱燃油|2.2
ZC=F|玉米|430
ZW=F|小麥|550
ZS=F|黃豆|1000
ZM=F|黃豆粉|300
ZL=F|黃豆油|42
KC=F|咖啡|280
SB=F|糖|21
CC=F|可可|8000
CT=F|棉花|70
OJ=F|柳橙汁|500
LE=F|活牛|190
HE=F|瘦豬|85
`),
  ...L('fx', `
USDTWD=X|美元/台幣|32.5
JPYTWD=X|日圓/台幣|0.21
EURTWD=X|歐元/台幣|34
CNYTWD=X|人民幣/台幣|4.5
EURUSD=X|歐元/美元|1.06
USDJPY=X|美元/日圓|154
GBPUSD=X|英鎊/美元|1.27
AUDUSD=X|澳幣/美元|0.65
USDCAD=X|美元/加幣|1.40
USDCHF=X|美元/瑞郎|0.88
NZDUSD=X|紐幣/美元|0.59
USDCNY=X|美元/人民幣|7.2
USDHKD=X|美元/港幣|7.78
USDKRW=X|美元/韓元|1400
EURJPY=X|歐元/日圓|163
`),
];

export const BY_CODE = Object.fromEntries(CATALOG.map(x => [x.code, x]));

// Category of any Yahoo-style code, including ones not in the catalog.
export function catOfCode(code) {
  if (BY_CODE[code]) return BY_CODE[code].cat;
  if (/\.(TW|TWO)$/.test(code)) return 'tw';
  if (code.startsWith('^')) return 'idx';
  if (/=F$/.test(code)) return 'cmd';
  if (/=X$/.test(code)) return 'fx';
  if (/\.[A-Z]{1,3}$/.test(code)) return 'intl';
  return 'us';
}

// Short display code: 2330.TW -> 2330, ^TWII -> TWII, USDTWD=X -> USD/TWD, GC=F -> GC
export function shortCode(code) {
  if (/\.(TW|TWO)$/.test(code)) return code.replace(/\.(TW|TWO)$/, '');
  if (/^[A-Z]{6}=X$/.test(code)) return code.slice(0, 3) + '/' + code.slice(3, 6);
  if (code === 'DX-Y.NYB') return 'DXY';
  return code.replace(/^\^/, '').replace(/=[FX]$/, '');
}

// Default additions for the watchlist so the new markets are visible right away.
export const SEED_WATCH = ['Y:^TWII', 'Y:2330.TW', 'Y:0050.TW', 'Y:^GSPC', 'Y:NVDA', 'Y:GC=F', 'Y:CL=F', 'Y:USDTWD=X'];
