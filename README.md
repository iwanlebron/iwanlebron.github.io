# 全球市场情绪仪表盘

一个纯前端、无框架的中文市场情绪页面，参考 greedyfear.com 的数据结构与仪表盘布局，覆盖：

- 加密、美股、欧洲、印度、日本、香港/中国、黄金与原油市场情绪；
- AAPL、MSFT、NVDA、GOOGL、AMZN、META、TSLA、TSM 的 52 周价格区间位置。

## 数据来源与口径

- 加密：[Alternative.me Crypto Fear & Greed Index](https://alternative.me/crypto/fear-and-greed-index/) 公开 API。
- 美股情绪：[greedyfear.com](https://www.greedyfear.com/) 的公开 `/api/us` 接口，上游标注为 CNN。
- 其他市场及公司：[greedyfear.com](https://www.greedyfear.com/) 的公开波动率与股票接口，上游标注为 Yahoo Finance。

市场波动率会被来源接口反向映射为 0–100 情绪分；公司分数只是当前价格在 52 周高低点中的位置，不代表估值或投资结论。页面拒绝展示来源标记为 `mock` 的模拟数据。

目标站的股票接口只允许上述 8 个代码，不支持任意标的，所以本版未加入误导性的全市场搜索框。

## 运行

直接用静态文件服务器托管 `docs/` 目录即可，不需要后端、构建步骤或第三方前端依赖。页面每 5 分钟自动刷新，支持逐项缓存、离线展示、失败重试、页面可见性恢复与手动刷新。

数据仅供市场情绪观察，不构成投资、财务或交易建议。
