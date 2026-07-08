# 路線偏離測試器 v10 手勢版

## 這一版解決的問題

v9 的捷徑 autostart 啟動後，Wake Lock 一律失敗（`NotAllowedError Permission was denied`）。
實測確認根本原因：**iOS WebKit 只在真實使用者手勢（點擊 / 觸碰）中放行
`navigator.wakeLock.request()`**。定位權限對話框、GPS 回呼、setTimeout 重試
都不算手勢，所以 v9 的「第一次 GPS 成功後延遲重試」在 iOS 上注定全部被拒。

## v10 的做法

- autostart 第一次 GPS 成功後，仍會先試一次 Wake Lock（Android / 桌面通常放行）。
- iOS 被拒時，不再空跑重試，改掛一個**一次性的全域 pointerdown 監聽器**：
  點螢幕任何地方一下，就在那個手勢裡當場取得 Wake Lock。
- Wake Lock 卡片會閃爍顯示「點一下螢幕啟用」，黑畫面內也會顯示 Wake Lock 狀態。
- 按「黑畫面省電模式」按鈕時，若尚未取得 Wake Lock 會順手先搶再進黑畫面。
- 黑畫面內的任何觸碰（含誤觸）若發現 Wake Lock 掉了，也會順手補搶。
- 「回到前景」與「release 後」的自動重試保留（縮減為 3 次），重試耗盡後
  同樣轉入「等一次觸碰」模式。
- 手動「開始定位」與「點一下啟用 Wake Lock」按鈕行為不變。

## 實際使用流程

1. 捷徑打開 `https://你的網址/index.html?autostart=1`
2. 自動開始定位（可能需先允許定位權限）
3. 畫面顯示「點一下螢幕啟用」→ 你反正要按「黑畫面省電模式」，那一下點擊
   就會把 Wake Lock 帶起來
4. 進黑畫面，放口袋

## 注意事項

- **低耗電模式要關閉**：低耗電模式下 iOS 可能直接拒絕 Wake Lock，或強制
  30 秒自動鎖屏，會讓人誤以為程式壞了。
- 若加到主畫面當獨立 PWA 使用：iOS 18.4 之前的版本有系統 bug，
  Home Screen Web App 內 Wake Lock 完全無法運作（Safari 分頁不受影響）。
- 更新後若行為仍是舊版，通常是 Service Worker 快取，請重新整理兩次或
  刪除主畫面圖示重加。

## 捷徑 URL 範例

```text
https://lydian523.github.io/iphone-route-wake-test/index.html?autostart=1
```
