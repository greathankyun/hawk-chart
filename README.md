# 鷹眼看盤

跨平台看盤 App（PWA）：一套程式碼，手機（iOS / Android）與電腦（Windows / macOS）都能安裝。

## 功能
- K 線、平均 K、美國線、折線、面積圖
- 週期：1 分、5 分、15 分、30 分、1 時、4 時、日、週、月；往左拖動自動載入更早歷史
- 技術指標：MA、EMA、布林通道、VWAP、成交量、RSI、MACD、KD、ATR（可調參數、顏色、多組）
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
