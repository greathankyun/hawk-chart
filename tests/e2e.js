const { chromium, devices } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const root=require('path').resolve(__dirname,'..');
const T={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.html':'text/html'};
const srv=http.createServer((q,r)=>{let f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':T[path.extname(f)]||'text/html'});r.end(d);});}).listen(8130);
const URL='http://localhost:8130/';
let fails=0, passes=0;
const ok=(c,m)=>{if(c){passes++;}else{fails++;console.log('FAIL:',m);}};
const H=p=>p.evaluate(()=>window.__hawk);
const items=p=>p.evaluate(()=>window.__hawk.drawings.items.length);
const sel=p=>p.evaluate(()=>!!window.__hawk.drawings.selected);
async function boot(ctx){const p=await ctx.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));p.on('dialog',d=>{p.errs.push('DIALOG '+d.message());d.dismiss();});
 await p.route(/binance/,r=>r.abort());
 await p.goto(URL);await p.waitForFunction(()=>window.__hawk&&window.__hawk.bars.length>0);await p.waitForTimeout(500);return p;}
async function chartBox(p){return p.locator('#chart').boundingBox();}

(async()=>{
const b=await chromium.launch();
// ================= DESKTOP =================
{
const ctx=await b.newContext({viewport:{width:1440,height:860},acceptDownloads:true});
const p=await boot(ctx);
const bx=await chartBox(p); const X=f=>bx.x+bx.width*f, Y=f=>bx.y+bx.height*f;
// timeframes
for (const lbl of ['1分','5分','15分','30分','1時','4時','日','週','月','1時']){await p.click(`.tf-btn:text-is("${lbl}")`);await p.waitForTimeout(250);
 const iv=await p.evaluate(()=>window.__hawk.S.interval); const n=await p.evaluate(()=>window.__hawk.bars.length); ok(n>0,`tf ${lbl} bars ${n} iv ${iv}`);}
// chart types
for (let i=0;i<7;i++){await p.click(`#typeGroup button >> nth=${i}`);await p.waitForTimeout(150);}
ok((await p.evaluate(()=>window.__hawk.S.chartType))==="baseline","chart type baseline (last of 7)");
await p.click('#typeGroup button >> nth=0');
// --- trend line: draw, select, delete via sel-bar button
await p.click('button[title="趨勢線"]');
await p.mouse.move(X(.3),Y(.4));await p.mouse.down();await p.mouse.move(X(.5),Y(.3),{steps:5});await p.mouse.up();
ok(await items(p)===1,'trend created');
ok(await sel(p),'trend selected after create');
ok(await p.isVisible('#selBar'),'selBar visible');
await p.click('#delDrawing');
ok(await items(p)===0,'trend deleted via selBar button (Hank bug)');
// draw again, deselect, reselect by click, delete via button
await p.click('button[title="趨勢線"]');
await p.mouse.move(X(.3),Y(.4));await p.mouse.down();await p.mouse.move(X(.5),Y(.3),{steps:5});await p.mouse.up();
await p.mouse.click(X(.8),Y(.8)); ok(!(await sel(p)),'deselect by clicking empty');
await p.mouse.click(X(.4),Y(.35)); ok(await sel(p),'reselect by clicking line');
// swatch color
await p.click('.swatch >> nth=2'); ok((await p.evaluate(()=>window.__hawk.drawings.items[0].color))==='#ff3d6e','swatch color');
ok(await sel(p),'still selected after swatch');
await p.keyboard.press('Delete'); ok(await items(p)===0,'delete key');
await p.keyboard.press('Control+z'); ok(await items(p)===1,'undo restores');
// drag move
const before=await p.evaluate(()=>JSON.stringify(window.__hawk.drawings.items[0].points));
await p.mouse.move(X(.4),Y(.35));await p.mouse.down();await p.mouse.move(X(.45),Y(.5),{steps:5});await p.mouse.up();
ok(before!==await p.evaluate(()=>JSON.stringify(window.__hawk.drawings.items[0].points)),'drag moves line');
// handle drag
const pts0=await p.evaluate(()=>{const d=window.__hawk.drawings;const it=d.items[0];return it.points.map(q=>({x:d.xOf(q.t),y:d.yOf(q.p)}));});
const cb=await p.locator('.chart-wrap').boundingBox();
await p.mouse.move(cb.x+pts0[1].x,cb.y+pts0[1].y);await p.mouse.down();await p.mouse.move(cb.x+pts0[1].x+60,cb.y+pts0[1].y-60,{steps:5});await p.mouse.up();
const pts1=await p.evaluate(()=>{const d=window.__hawk.drawings;const it=d.items[0];return it.points.map(q=>({x:d.xOf(q.t),y:d.yOf(q.p)}));});
ok(Math.abs(pts1[0].x-pts0[0].x)<2 && Math.abs(pts1[1].x-pts0[1].x)>30,'handle drag moves only endpoint');
// each tool
const tools=[['射線',2],['延伸線',2],['水平線',1],['垂直線',1],['矩形',2],['費波那契回撤',2]];
for(const [t,n] of tools){const c0=await items(p);await p.click(`button[title="${t}"]`);
 if(n===1) await p.mouse.click(X(.6),Y(.5)); else {await p.mouse.move(X(.55),Y(.55));await p.mouse.down();await p.mouse.move(X(.7),Y(.45),{steps:4});await p.mouse.up();}
 ok(await items(p)===c0+1,`tool ${t} creates`);
 ok(await sel(p),`tool ${t} selected`);
 await p.click('#delDrawing'); ok(await items(p)===c0,`tool ${t} deletable via button`);}
// click-click mode
await p.click('button[title="矩形"]');await p.mouse.click(X(.3),Y(.3));await p.mouse.move(X(.4),Y(.4));await p.mouse.click(X(.4),Y(.4));
ok(await items(p)===2,'click-click rect');
// text tool
await p.click('button[title="文字"]');await p.mouse.click(X(.5),Y(.2));await p.waitForTimeout(100);
ok(await p.isVisible('#textModal'),'text modal');await p.fill('#textInput','支撐區');await p.press('#textInput','Enter');
ok((await p.evaluate(()=>window.__hawk.drawings.items.at(-1).text))==='支撐區','text created');
ok(await p.isVisible('#editText'),'edit text button');await p.click('#editText');await p.fill('#textInput','壓力區');await p.press('#textInput','Enter');
ok((await p.evaluate(()=>window.__hawk.drawings.items.at(-1).text))==='壓力區','text edited');
// measure
await p.click('button[title="測量"]');await p.mouse.move(X(.2),Y(.6));await p.mouse.down();await p.mouse.move(X(.3),Y(.5),{steps:4});await p.mouse.up();
ok(await p.evaluate(()=>window.__hawk.drawings.items.some(d=>d.type==='measure')),'measure shown');
ok((await p.evaluate(()=>window.__hawk.drawings.tool))==='cursor','measure returns to cursor');
await p.mouse.click(X(.9),Y(.85));ok(!(await p.evaluate(()=>window.__hawk.drawings.items.some(d=>d.type==='measure'))),'measure cleared by click');
// lock mode
await p.click('button[title="連續畫線"]');await p.click('button[title="水平線"]');await p.mouse.click(X(.5),Y(.6));await p.mouse.click(X(.5),Y(.7));
const nh=await p.evaluate(()=>window.__hawk.drawings.items.filter(d=>d.type==='hline').length); ok(nh===2,'lock mode keeps tool, hlines='+nh);
await p.keyboard.press('Escape');await p.click('button[title="連續畫線"]');
ok((await p.evaluate(()=>window.__hawk.drawings.tool))==='cursor','esc to cursor');
// hide
await p.click('button[title="隱藏畫線"]');ok(await p.evaluate(()=>window.__hawk.drawings.hidden),'hidden');await p.click('button[title="隱藏畫線"]');
// magnet
await p.click('button[title="磁吸"]');ok(await p.evaluate(()=>window.__hawk.drawings.magnet),'magnet on');await p.click('button[title="磁吸"]');
// persistence
const cnt=await p.evaluate(()=>window.__hawk.drawings.items.filter(d=>d.type!=='measure').length);
await p.reload();await p.waitForFunction(()=>window.__hawk&&window.__hawk.bars.length>0);await p.waitForTimeout(300);
ok(await items(p)===cnt,`drawings persist ${cnt}`);
// clear all
await p.click('button[title="清除全部畫線"]');ok(await items(p)===0,'clear all');
await p.click('button[title="復原 (Ctrl+Z)"]');ok(await items(p)===cnt,'undo clear all');
// indicators
await p.click('#indBtn');
for (const name of ['移動平均 MA','指數移動平均 EMA','布林通道 BOLL','成交量加權均價 VWAP','相對強弱 RSI','隨機指標 KD','真實波幅 ATR']) await p.click(`#indCatalog li:has-text("${name}")`);
const ni=await p.evaluate(()=>window.__hawk.S.indicators.length); ok(ni===11,'indicators added '+ni);
// change param of first
await p.fill('#indActive li >> nth=0 >> input[type=number]','5');await p.press('#indActive li >> nth=0 >> input[type=number]','Tab');
ok((await p.evaluate(()=>window.__hawk.S.indicators[0].p.n))===5,'param change');
// remove all
while(await p.locator('#indActive li button[title="移除"]').count()) await p.click('#indActive li button[title="移除"] >> nth=0');
ok((await p.evaluate(()=>window.__hawk.S.indicators.length))===0,'all indicators removed');
await p.click('#indCatalog li:has-text("MACD")');await p.click('#indCatalog li:has-text("成交量 VOL")');
await p.keyboard.press('Escape');ok(await p.isHidden('#indModal'),'esc closes modal');
// search
await p.click('#symBtn');await p.waitForSelector('#symList li:not(.empty)');
await p.fill('#symSearch','eth');await p.waitForTimeout(100);
const first=await p.textContent('#symList li >> nth=0'); ok(/ETH/.test(first),'search eth');
await p.click('#quoteSub button:text-is("BTC")');ok(/BTC/.test(await p.textContent('#symList li >> nth=0')),'quote tab BTC');
await p.click('#quoteTabs button:text-is("全部")');
await p.press('#symSearch','ArrowDown');await p.press('#symSearch','Enter');await p.waitForTimeout(500);
const sym=await p.evaluate(()=>window.__hawk.S.symbol); ok(sym!=='BTCUSDT','switched via keyboard '+sym);
ok(await p.isHidden('#symModal'),'search closed');
// star in search
await p.click('#symBtn');await p.waitForSelector('#symList li:not(.empty)');await p.fill('#symSearch','LTC');await p.waitForTimeout(100);
await p.click('#quoteTabs button:text-is("全部")');
const wl0=await p.evaluate(()=>window.__hawk.S.watchlist.length);
await p.click('#symList li >> nth=0 >> .star');ok((await p.evaluate(()=>window.__hawk.S.watchlist.length))===wl0+1,'star adds watchlist');
await p.keyboard.press('Escape');
// type-to-search
await p.mouse.click(X(.5),Y(.5));await p.keyboard.press('s');await p.waitForTimeout(300);ok(await p.isVisible('#symModal'),'type to search');ok((await p.inputValue('#symSearch'))==='S','prefill');await p.keyboard.press('Escape');
// watchlist click & remove
await p.click('#watchlist li[data-sym="SOLUSDT"]');await p.waitForTimeout(400);ok((await p.evaluate(()=>window.__hawk.S.symbol))==='SOLUSDT','watchlist switch');
ok(/SOL/.test(await p.textContent('#symName')),'header updated');
await p.hover('#watchlist li[data-sym="LTCUSDT"]');await p.click('#watchlist li[data-sym="LTCUSDT"] .w-del');
ok(!(await p.evaluate(()=>window.__hawk.S.watchlist.includes('LTCUSDT'))),'watchlist remove');
// drawings are per symbol
ok(await items(p)===0,'SOL has no drawings');
// alerts
const last=await p.evaluate(()=>window.__hawk.bars.at(-1).close);
await p.selectOption('#alertDir','above');await p.fill('#alertPrice',String(last*1.0000001));await p.click('#alertForm button');
ok((await p.locator('#alerts li:not(.empty):not(.a-log)').count())===1,'alert added');
await p.waitForTimeout(6000);
const fired=await p.evaluate(()=>window.__hawk.S.alerts.filter(a=>a.fired).length);
console.log('alert fired (random walk, may be 0):',fired);
await p.click('#alerts li button[title="刪除"]');ok((await p.locator('#alerts li:not(.empty):not(.a-log)').count())===0,'alert deleted');
// settings
await p.click('#setBtn');ok(await p.isVisible('#setModal'),'settings open');
await p.selectOption('#setTheme','light');ok((await p.evaluate(()=>document.documentElement.dataset.theme))==='light','light theme');
await p.selectOption('#setColor','intl');ok((await p.evaluate(()=>window.__hawk.S.settings.colors))==='intl','intl colors');
await p.selectOption('#setTz','utc');await p.selectOption('#setType','line');ok((await p.evaluate(()=>window.__hawk.S.chartType))==='line','type via settings');
await p.check('#setMagnet');ok(await p.evaluate(()=>window.__hawk.drawings.magnet),'magnet via settings');
await p.selectOption('#setTheme','dark');await p.selectOption('#setColor','tw');await p.selectOption('#setTz','local');await p.selectOption('#setType','candle');await p.uncheck('#setMagnet');
await p.keyboard.press('Escape');
// screenshot
const [dl]=await Promise.all([p.waitForEvent('download',{timeout:5000}).catch(()=>null),p.click('#shotBtn')]);ok(!!dl,'screenshot download');
// side toggle
await p.click('#sideBtn');ok(await p.isHidden('#side'),'side hidden');await p.click('#sideBtn');ok(await p.isVisible('#side'),'side shown');
// load more
const n1=await p.evaluate(()=>window.__hawk.bars.length);await p.evaluate(()=>window.__hawk.chart.timeScale().setVisibleLogicalRange({from:0,to:80}));await p.waitForTimeout(800);
ok((await p.evaluate(()=>window.__hawk.bars.length))>n1,'load more history');
// alt shortcuts
await p.mouse.click(X(.5),Y(.5));await p.keyboard.press('Alt+KeyT');ok((await p.evaluate(()=>window.__hawk.drawings.tool))==='trend','Alt+T');await p.keyboard.press('Escape');
await p.screenshot({path:require('path').join(require('os').tmpdir(),'d-final.png')});
ok(p.errs.length===0,'desktop errors: '+p.errs.join(' | '));
await ctx.close();
}
// ================= MOBILE (touch) =================
{
const ctx=await b.newContext({...devices['iPhone 13']});
const p=await boot(ctx);
const cdp=await ctx.newCDPSession(p);
const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
const tdrag=async(x1,y1,x2,y2)=>{await touch('touchStart',x1,y1);for(let i=1;i<=6;i++){await touch('touchMove',x1+(x2-x1)*i/6,y1+(y2-y1)*i/6);await p.waitForTimeout(16);}await touch('touchEnd');await p.waitForTimeout(100);};
const bx=await chartBox(p); const X=f=>bx.x+bx.width*f, Y=f=>bx.y+bx.height*f;
await p.tap('button[title="趨勢線"]');
await tdrag(X(.2),Y(.4),X(.6),Y(.3));
ok(await items(p)===1,'mobile trend by drag');
ok(await p.isVisible('#selBar'),'mobile selBar');
await p.tap('#delDrawing');ok(await items(p)===0,'mobile delete via button (Hank bug)');
// tap-tap
await p.tap('button[title="趨勢線"]');await p.touchscreen.tap(X(.2),Y(.4));await p.touchscreen.tap(X(.6),Y(.3));
ok(await items(p)===1,'mobile trend tap-tap');
await p.touchscreen.tap(X(.8),Y(.8));ok(!(await sel(p)),'mobile deselect');
await p.touchscreen.tap(X(.4),Y(.35));ok(await sel(p),'mobile reselect by tap');
await p.tap('.swatch >> nth=1');ok(await sel(p),'mobile still selected after swatch');
await p.tap('#delDrawing');ok(await items(p)===0,'mobile delete after reselect');
// drag move on mobile
await p.tap('button[title="水平線"]');await p.touchscreen.tap(X(.5),Y(.5));
const y0=await p.evaluate(()=>window.__hawk.drawings.items[0].points[0].p);
await tdrag(X(.3),Y(.5),X(.3),Y(.3));
ok((await p.evaluate(()=>window.__hawk.drawings.items[0].points[0].p))>y0,'mobile drag hline');
// side panel
await p.tap('#sideBtn');await p.waitForTimeout(300);ok(await p.isVisible('#sideClose'),'mobile side close btn');
await p.tap('#watchlist li[data-sym="ETHUSDT"]');await p.waitForTimeout(500);
ok((await p.evaluate(()=>window.__hawk.S.symbol))==='ETHUSDT','mobile watchlist switch');
ok(!(await p.evaluate(()=>document.body.classList.contains('app-side-open'))),'side closes after pick');
await p.tap('#sideBtn');await p.waitForTimeout(300);await p.tap('#sideClose');await p.waitForTimeout(300);
ok(!(await p.evaluate(()=>document.body.classList.contains('app-side-open'))),'side close button');
// search on mobile
await p.tap('#symBtn');await p.waitForSelector('#symList li:not(.empty)');await p.fill('#symSearch','sol');await p.tap('#symList li >> nth=0');await p.waitForTimeout(400);
ok(/SOL/.test(await p.evaluate(()=>window.__hawk.S.symbol)),'mobile search pick');
// install button on iOS
ok(await p.isVisible('#installBtn'),'iOS install button');await p.tap('#installBtn');ok(await p.isVisible('#iosModal'),'iOS install help');await p.tap('#iosModal [data-close]');
// layout: no horizontal overflow
ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no h-overflow');
await p.screenshot({path:require('path').join(require('os').tmpdir(),'m-final.png')});
ok(p.errs.length===0,'mobile errors: '+p.errs.join(' | '));
await ctx.close();
}
console.log(`\n${passes} passed, ${fails} failed`);
await b.close();srv.close();
})().catch(e=>{console.error(e);process.exit(1)});
