## 分片 8 (行 1177-1344)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 1195 | Top {0}s | 前 {0} 名 | 翻译不当 | 热门 {0} | 原文 {0} 后带复数 s，插入的是名词（如 browser/path），"前 {0} 名"是按数字处理的语序，实际渲染会出错 |
| 1211 | Top sources | 热门来源 | 翻译不当 | 热门 Source | 与 1209 "Top referrers"（基线 Referrer=来源）译文完全相同造成混淆；source 为流量来源属性名，宜保留英文区分 |
| 1249 | Use this token to authenticate with the MCP server (base64 encoded client ID and secret). | 使用此令牌以向 MCP 服务器认证（base64 编码的客户端 ID 和密钥）。 | 应保留英文 | 使用此 Token 向 MCP 服务器进行认证（base64 编码的客户端 ID 和密钥）。 | Token 为技术约定俗成词，译作"令牌"降低可读性 |
| 1271 | We could not find any data here yet | 我们还没有在此找到任何数据 | 翻译不当 | 这里暂时还没有任何数据 | 直译生硬，"在此找到"不符合中文表达习惯 |
| 1295 | Write a JavaScript function that transforms the event payload. The function receives {0} as a parameter and should return an object. | 编写一个转换事件载荷的 JavaScript 函数。该函数接收 {0} 作为参数，并应返回一个对象。 | 应保留英文 | 编写一个转换事件 payload 的 JavaScript 函数。该函数接收 {0} 作为参数，并应返回一个对象。 | Payload 约定俗成保留英文，"载荷"降低开发者可读性 |
| 1322 | Your client secret (and the MCP token derived from it) is only shown once, right after the client is created. If you need it again, create a new client under Settings → Clients. | 你的客户端密钥（以及由它派生的 MCP 令牌）仅在客户端创建后立即显示一次。如需再次获取，请在"设置 → 客户端"下创建一个新客户端。 | 应保留英文 | 你的客户端密钥（以及由它派生的 MCP Token）仅在客户端创建后立即显示一次。如需再次获取，请在"设置 → 客户端"下创建一个新客户端。 | Token 宜保留英文，与 MCP 上下文一致性更好 |
| 1326 | Your data is right where you left it | 你的数据仍在你离开时的位置 | 翻译不当 | 你的数据完好保留，等你回来 | 直译生硬，原意为数据不会丢失、保持原样，非字面"位置" |
| 1339 | Your subscription is on a break | 你的订阅正在休整中 | 翻译不当 | 你的订阅已暂停 | "休整"用于订阅不符合中文习惯，"on a break"实指订阅暂停 |
