# 路線偏離測試器 v9 捷徑啟動版

## 新增重點

- 支援 `?autostart=1`，可由 iPhone 捷徑「打開 URL」快速啟動。
- 開始定位後自動嘗試啟用 Wake Lock。
- 移除 PWA 內呼叫 iPhone 捷徑的亮度控制功能。
- 亮度請改用 iPhone「背部輕點」呼叫你自己的捷徑。
- 保留 GPX / KML 匯入、本機路線保存、黑畫面口袋模式、GPS 狀況說明、簡短偏移語音。

## 捷徑 URL 範例

```text
https://你的GitHubPages網址/index.html?autostart=1
```

例如：

```text
https://lydian523.github.io/iphone-route-wake-test/index.html?autostart=1
```

注意：iOS 仍可能要求定位權限、聲音權限或一次使用者互動。若自動開始失敗，畫面會提示手動按「開始定位」。


## v9 重點

- 捷徑 autostart 啟動時，先啟動定位，不立刻搶 Wake Lock。
- 第一次 GPS 成功後，延遲並重試 Wake Lock。
- 回到前景時若仍在定位，會重新嘗試 Wake Lock。
- 停止定位時會主動釋放 Wake Lock。
- Wake Lock 失敗時顯示「點一下啟用 Wake Lock」。
