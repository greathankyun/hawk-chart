# 鷹眼看盤

跨平台看盤 App（PWA）：一套程式碼，手機（iOS / Android）與電腦（Windows / macOS）都能安裝。

## 功能
- K 線、平均 K、美國線、折線、面積圖
- 週期：1 分、5 分、15 分、30 分、1 時、4 時、日、週、月；往左拖動自動載入更早歷史
- 技術指標 50+ 種（可搜尋、分類、調參數、顏色、隱藏、多組）：
  - 均線：MA、EMA、WMA、HMA、DEMA、TEMA、SMMA、VWMA、KAMA、線性迴歸、均線帶、拋物線 SAR、超級趨勢、一目均衡表、樞紐點
  - 通道：布林、肯特納、唐奇安、包絡線
  - 擺盪：RSI、隨機 RSI、MACD、KD（台股）、Stochastic、CCI、威廉 %R、DMI/ADX、Aroon、MOM、ROC、乖離率、心理線、AO、UO、TRIX、CMO、TSI、Fisher、Vortex
  - 成交量：VOL（含均量）、VWAP、OBV、A/D、CMF、MFI、成交量分佈（可視範圍，含 POC 與價值區）
  - 波動：ATR、標準差、布林帶寬、%B、歷史波動率
- 圖表類型：K 線、空心 K、平均 K、美國線、折線、面積、基準線
- 多圖版面：單圖、左右、上下、一大兩小、三欄、四宮格、六宮格；可同步商品（多週期）、十字線、時間範圍，小圖可與主圖交換
- K 線回放：點選任一根 K 棒開始重播，播放／暫停／逐根前進後退、0.5x–10x，回放中可模擬買賣並計算損益
- 自訂腳本：用 JavaScript 寫指標與策略（plot、hline、input、buy/sell、alert，內建 ta.* 函式），附範例
- 條件警示：任意指標組合（大於、小於、上穿、下穿，且／或），任何商品與週期，可選每根 K 棒一次／收盤確認／只一次；保留觸發紀錄
- 策略回測：均線交叉、RSI、MACD、KD、布林、超級趨勢、唐奇安，或自訂條件、自訂腳本；手續費、滑價、停損停利、多空方向、部位比例；淨利、勝率、獲利因子、最大回撤、夏普值、資金曲線、交易明細（可匯出 CSV、標在主圖）
- 選股器：加密貨幣、自選、台股、美股、指數、原物料、外匯清單，以預設或自訂技術條件掃描、排序
- 圖表範本：內建與自訂範本（指標、圖表類型、版面、週期），備份檔匯出／匯入
- 雲端（選配，透過同一個 Cloudflare Worker）：跨裝置同步全部設定與畫線；伺服器端警示每分鐘檢查，App 關閉也能用 ntfy 或 Telegram 推播
- 畫線工具：趨勢線、射線、延伸線、水平線、垂直線、矩形、費波那契回撤、測量、文字；磁吸、連續畫線、隱藏、復原，畫線依商品自動儲存
- 多市場：加密貨幣（Binance）、台股（上市＋上櫃全部個股與 ETF）、美股、各國指數、原物料期貨、外匯、美債殖利率
- 自選清單（即時報價）、依市場分類的商品搜尋（可用代號或中文名稱）、行情資訊
- 價格警示（App 內提示＋系統通知）
- 紅漲綠跌／綠漲紅跌切換、深色／淺色、本機時間／UTC、圖表截圖
- 離線可開啟介面；交易所無法連線時自動切換為「模擬資料」並明確標示

## 安裝
- **Android / Windows / macOS（Chrome、Edge）**：開啟網址，按右上角「安裝」或網址列的安裝圖示
- **iPhone / iPad**：用 Safari 開啟 → 分享 → 加入主畫面
- **macOS Safari 17+**：檔案 → 加入 Dock

## 快捷鍵（電腦）
直接打字＝搜尋商品；Alt+T 趨勢線、Alt+H 水平線、Alt+V 垂直線、Alt+R 矩形、Alt+F 費波那契、Alt+M 測量；Delete 刪除選取畫線；Ctrl/⌘+Z 復原；Esc 取消。

## 技術
純前端（HTML / CSS / ES Modules），圖表引擎為 TradingView 開源的 [Lightweight Charts](https://github.com/tradingview/lightweight-charts)（Apache-2.0，已內含於 `vendor/`），加密貨幣行情為 Binance 公開市場資料；其他市場經由 `worker/` 的 Cloudflare Worker 取得 Yahoo Finance 資料（台股可加富果 Fugle 金鑰取得即時行情）。推到 `main` 後由 GitHub Actions 自動部署到 GitHub Pages。

本地執行：`python3 -m http.server` 後開啟 http://localhost:8000

本 App 僅供看盤參考，不構成投資建議。

## 測試
`node tests/markets.mjs`：以模擬的 Yahoo／富果回應測試 Worker 與多市場畫面。

`node tests/advanced.js`（需要 Playwright）：測試全部進階功能（指標、多圖、回放、腳本、警示、回測、選股、範本、雲端設定），含 iPhone 版面。

`node tests/cloud.mjs`：以記憶體 KV 測試 Worker 的同步、伺服器端警示與排程檢查。

`node tests/e2e.js`（需要 Playwright）：在模擬資料模式下，以電腦版與 iPhone 觸控版面把所有功能跑一遍。

## 行情中繼（Cloudflare Worker）
程式在 `worker/`，推到 `main` 時由 `.github/workflows/worker.yml` 自動部署（需要 repo secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；選配 `FUGLE_API_KEY`）。部署後把網址貼到 App「設定 → 行情中繼」，或填進 `js/config.js` 讓所有裝置預設使用。

| 市場 | 來源 | 延遲 |
|---|---|---|
| 加密貨幣 | Binance | 即時 |
| 台股 | Yahoo；有富果金鑰時改用富果 | 約 20 分；富果為即時 |
| 美股 | Yahoo | 即時（盤中） |
| 原物料期貨 | Yahoo | 約 10 分 |
| 外匯、指數 | Yahoo | 大多即時，台灣加權約 20 分 |

## 雲端同步與伺服器端警示
同一個 Worker 另外提供 `/sync/*`（跨裝置同步）與 `/alerts/*`（伺服器端警示，每分鐘由 Cron 檢查）。資料存在 Cloudflare KV（免費額度即可），Deploy Worker 流程會自動建立名為 `hawk-chart-HAWK` 的 KV 並填入 `wrangler.toml`。

使用方式：App「設定 → 雲端同步與伺服器警示」按「產生」同步代碼，在其他裝置貼上同一組代碼即可同步。要讓 App 關閉也能收到警示：手機安裝 ntfy App，在設定裡按「產生」ntfy 主題並在 ntfy App 訂閱同名主題（或填 Telegram Bot Token 與 Chat ID），按「送測試通知」確認，之後建立警示時勾選「同時交給雲端」。同步代碼只以雜湊值存在伺服器；腳本條件只在 App 內執行。
