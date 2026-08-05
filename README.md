# 市场恐慌贪婪指数

一个纯前端、无框架的静态页面，只展示美股与加密市场的恐慌贪婪指数。

## 数据来源

- 美股：[CNN Fear & Greed Index](https://edition.cnn.com/markets/fear-and-greed)。优先读取 CNN 页面数据接口；浏览器直连受限时使用 Jina AI Reader 作为读取通道。
- 加密：[Alternative.me Crypto Fear & Greed Index](https://alternative.me/crypto/fear-and-greed-index/)，通过其公开 API 获取。

页面保留各来源提供的原始评级，不使用自定义阈值重新分类。数据默认每 5 分钟刷新；页面隐藏时暂停请求，回到页面或恢复联网后继续更新。最近一次成功数据会保存在浏览器本地，以便快速显示和应对短暂网络故障。

## 运行

直接用静态文件服务器托管 `docs/` 目录即可，不需要后端、构建步骤或第三方前端依赖。

指数仅反映市场情绪，不构成投资、财务或交易建议。数据可能延迟、缺失或调整，请以来源页面为准。
