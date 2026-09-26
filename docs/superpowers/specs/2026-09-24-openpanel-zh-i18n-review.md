# OpenPanel 汉化对照表 · 子代理审核总报告

- 日期：2026-09-24
- 输入：`packages/i18n-zh/catalog/对照表.csv`（1344 条）
- 方式：8 个子代理并行审核（每片 168 条），聚焦三类问题：①翻译不当 ②应保留英文 ③上下文不应翻译
- 命中：74 处（去重前）。以下为汇总 + 我对高风险项的源码核验结论。原始分片见文末。

## 0. 已直接修复的真 bug（非风格问题，已改并重建字典）

| 序号 | 英文 | 原译 | 现处理 | 核验依据 |
|---|---|---|---|---|
| 665 | Gradient | 渐变 | **不译**（移入拒结） | `components/charts/chart-defs.ts:33` `name.includes("Gradient")` 组件名匹配，翻译会破坏图表渲染 |
| 904 | Pattern | 图案 | **不译**（移入拒结） | `chart-defs.ts:27` `name.includes("Pattern")` 同上 |
| 590 | Essentials | 基础版 | **基本信息** | `modals/event-details.tsx:73 title:'Essentials'` 是事件详情弹窗分区标题，非套餐名 |
| 1195 | Top {0}s | 前 {0} 名 | **热门 {0}** | `{0}` 是名词（country/browser 等），原语序按“数字”处理，渲染错误 |

> 连带发现并修复**提取器 bug**：`extract.mjs` 的 `ZOD_METHODS` 误含 `includes`，把 `String.includes()` 的参数当文案抓取（`Gradient`/`Pattern`/`url(`/`ui-theme=` 均源于此）。已移除 `includes/length/startsWith/endsWith`。这正是设计 §5.4 警示的“查询值/标识符被误翻”陷阱——**后续 P1 的构建期改写器必须带上此修复，否则会把这些代码串包进 `__opT` 破坏逻辑**。（本次未重跑 extract 以免打乱审核中的序号；重跑后这些误报会自动消失。）

## 1. 上下文不应翻译（已核验源码，建议保留英文/不译）

| 序号 | 英文 | 位置 | 建议 |
|---|---|---|---|
| 510/512/769/1015 | Cross/Curved/Line/Round Eyes | `components/facehash/faces.tsx` 装饰性 SVG `<title>`，用户不可见 | 保留英文（内部部件名，翻译无意义） |
| 717 | Install Server | `settings...mcp.tsx:164` 指 Raycast 里名为 “Install Server” 的命令 | 保留英文（与 Raycast 界面命令对应） |

## 2. 应保留英文：编程惯用词 —— 需你拍板（一致性决策，非 bug）

8 个代理高度一致地建议以下开发者惯用词保留英文；我倾向**采纳**（本产品面向开发者/数据分析师）：

| 词 | 我现在的译法 | 建议 | 涉及序号 |
|---|---|---|---|
| Token | 令牌 | **Token** | 480, 800, 801, 804, 824, 875, 1083, 1249, 1322（9 处） |
| Payload | 载荷 | **Payload** | 405, 908, 1295（3 处） |
| Endpoint | 端点 | **Endpoint** | 583, 584（2 处） |

> 若你认可，我全局替换（Token/Payload/Endpoint 各一次性改）。反例：`Endpoint`↔`端点`、`Token`↔`令牌` 大厂也有先例，故列为决策项而非直接改。

## 3. 翻译不当（质量改进，建议采纳；下列为代表，全量见分片）

- 语义类（较重要）：`196 Occurrence 出现次数→发生时间`（references 列疑为日期，待你确认列渲染）、`410 平均会话→平均会话时长`、`813 Most dropoffs after 流失最多的步骤在→在此步骤后流失最多`、`1120 单页浏览会话→单次页面浏览会话`（避免与 SPA 混淆）。
- 术语/惯用：`Revoke 吊销→撤销`（1011/1012/1013/619/729）、`Cannibalization 自相蚕食→蚕食`（692/751）、`679 高跳出→高跳出率`、`398 至多→最多`、`232 去重→去重数`、`261/279 补量词“次”`、`149 数据驻留地→数据驻留`、`114/115 占X百分比→X占比`、`894/995 公开可用性→公开访问设置`。
- 语句通顺：`97/98 未找到分享→未找到分享内容`、`191 未选择筛选→未选择任何筛选条件`、`381/382 任一这些…→以下任一…`、`428 拉进来→邀请加入`、`837/1271` 等。

## 4. 我不采纳 / 存疑（push back）

- `1211 Top sources`：代理建议保留英文“Source”。**不采纳**——应中文消歧：`1209 Top referrers=热门引荐来源`、`1211 Top sources=热门流量来源`，保持全中文更一致。
- `1326 Your data is right where you left it`：代理改“你的数据完好保留，等你回来”偏营销腔，可选不改。
- Eyes 系列：翻译与否都不影响功能（aria 隐藏），我倾向保留英文，非强制。

---

## 附：各子代理原始分片


## 分片 1 (行 1-168)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 97 | Share not found | 未找到分享 | 翻译不当 | 未找到分享内容 | "分享"单用作名词生硬，补足语义更自然 |
| 98 | Share not found - OpenPanel.dev | 未找到分享 - OpenPanel.dev | 翻译不当 | 未找到分享内容 - OpenPanel.dev | 同上（页面标题） |
| 114 | % of source | 占来源百分比 | 翻译不当 | 来源占比 | 直译生硬，"占比"更符合中文报表习惯 |
| 115 | % of total | 占总量百分比 | 翻译不当 | 总量占比 | 同上 |
| 149 | Data Residency | 数据驻留地 | 翻译不当 | 数据驻留 | 行业通用术语为"数据驻留"，"驻留地"生硬 |


## 分片 2 (行 169-336)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 184 | Missing a framework? {0} | 缺少某个框架？{0} | 翻译不当 | 没有找到你在用的框架？{0} | 上下文是框架选择列表，"缺少某个框架"表述生硬且有歧义 |
| 191 | No filters selected | 未选择筛选 | 翻译不当 | 未选择任何筛选条件 | "未选择筛选"收尾生硬、语义不完整 |
| 196 | Occurrence | 出现次数 | 翻译不当 | 发生时间 | 该列取值为日期并格式化为日期时间(references.tsx)，指引用标记的发生时间，并非次数 |
| 203 | Organization scheduled for deletion | 组织已计划删除 | 翻译不当 | 组织已安排删除 | "已计划删除"主谓歧义，读作"组织计划去删除"，"安排删除"更自然 |
| 232 | Unique | 去重 | 翻译不当 | 去重数 | 与"求和/最小值/最大值"并列的指标标签，"去重"是动词，作名词表头生硬 |
| 236 | User has been invited | 用户已被邀请 | 翻译不当 | 已邀请用户 | toast 惯用主动句式，"被"字句翻译腔 |
| 254 | {0} {1} {2} {3} {4} {5} {6} and more... | {0} {1} {2} {3} {4} {5} {6} 等更多… | 翻译不当 | {0} {1} {2} {3} {4} {5} {6} 等 | "等"已含"更多"之意，"等更多"搭配生硬 |
| 261 | {0} Clicks | {0} 点击 | 翻译不当 | {0} 次点击 | 数字后缺量词"次"，与同片 278"次曝光"不一致 |
| 279 | {0} Impressions | {0} 曝光 | 翻译不当 | {0} 次曝光 | 数字后缺量词"次"，同文件 278 行已译"次曝光"，应统一 |


## 分片 3 (行 337-504)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 364 | All events from {0} will be allowed. Do you want to allow any other? | 将允许来自 {0} 的所有事件。你还想允许其他吗？ | 翻译不当 | 将允许来自 {0} 的所有事件。是否还要允许其他域名？ | "允许其他"缺宾语，表意不完整；原文问的是其他域名 |
| 368 | All Windows | 所有窗口 | 翻译不当 | 所有时间窗口 | 与同下拉占位符 Time Window 对应，"所有窗口"易误解为窗口(window)本身 |
| 369 | All your projects in this workspace | 此工作区中你的所有项目 | 翻译不当 | 此工作区下的所有项目 | 语序生硬，不符合中文习惯 |
| 381 | Any of these events | 任一这些事件 | 翻译不当 | 以下任一事件 | "任一这些"搭配不通顺 |
| 382 | Any of these properties | 任一这些属性 | 翻译不当 | 以下任一属性 | 同上，搭配不通顺 |
| 398 | At most | 至多 | 翻译不当 | 最多 | 频次筛选条件（与"至少"配对），中文界面惯用"最多"，"至多"书面且生硬 |
| 404 | Available helpers: | 可用的辅助变量： | 翻译不当 | 可用的内置对象： | 上下文列出的是 Math、Date、JSON 等全局对象/类，并非"变量" |
| 405 | Available in payload: | 载荷中可用： | 应保留英文 | Payload 中可用： | Payload 为技术约定俗成词，汉译"载荷"降低可读性 |
| 410 | Avg session | 平均会话 | 翻译不当 | 平均会话时长 | 该标签显示的是时长（X min），译为"平均会话"语义不完整 |
| 428 | Bring your team in | 把你的团队拉进来 | 翻译不当 | 邀请你的团队加入 | "拉进来"过于口语随意，不适合产品界面 |
| 480 | Copy the JSON below, then run the {0} command in Raycast — it auto-fills the form from your clipboard. The install form takes a URL only, so the token goes in the query string. | 复制下方的 JSON，然后在 Raycast 中运行 {0} 命令——它会根据你的剪贴板自动填充表单。安装表单仅接受 URL，因此令牌需放在查询字符串中。 | 应保留英文 | 复制下方的 JSON，然后在 Raycast 中运行 {0} 命令——它会根据你的剪贴板自动填充表单。安装表单仅接受 URL，因此 token 需放在查询字符串中。 | Token 为技术领域约定俗成词，保留英文更易读 |


## 分片 4 (行 505-672)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 510 | Cross Eyes | 交叉眼 | 翻译不当 | X 形眼 | facehash 头像 SVG 标题，"交叉眼"易联想"斗鸡眼"，不自然 |
| 511 | CTR vs Position | 点击率对比排名 | 翻译不当 | 点击率 vs 排名 | "对比排名"会被误读为动宾结构，保留 vs 更清晰 |
| 512 | Curved Eyes | 弯曲眼 | 翻译不当 | 弧形眼 | "弯曲眼"不符合中文表达习惯 |
| 544 | Discover trends and changes in your analytics | 发现你分析数据中的趋势与变化 | 翻译不当 | 发现分析数据中的趋势与变化 | "你分析数据"易被误读为动词短语，删"你"后更通顺 |
| 583 | Endpoint | 端点 | 应保留英文 | Endpoint | 技术语汇约定俗成，译为"端点"降低可读性 |
| 584 | Endpoint URL (optional) | 端点 URL（可选） | 应保留英文 | Endpoint URL（可选） | 同上，Endpoint 保留英文 |
| 590 | Essentials | 基础版 | 翻译不当 | 基本信息 | 事件详情弹窗页签，"基础版"误导向套餐/版本命名 |
| 619 | Failed to revoke invite for {0} | 吊销 {0} 的邀请失败 | 翻译不当 | 撤销 {0} 的邀请失败 | "吊销"多用于证书/执照，邀请用"撤销"更自然 |
| 633 | Flat | 平直 | 翻译不当 | 平铺 | 表格视图切换按钮，"平铺"是通用说法，"平直"生硬 |
| 635 | for the next 12 months | 在接下来的 12 个月 | 翻译不当 | 在接下来的 12 个月内 | 缺"内"字，时间状语语义不完整 |
| 665 | Gradient | 渐变 | 上下文不应翻译 | ⟨不翻译:代码标识符⟩ | 出处为 chart-defs.ts 中 `name.includes("Gradient")` 组件名判断，翻译将破坏检测逻辑 |


## 分片 5 (行 673-840)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 679 | High bounce | 高跳出 | 翻译不当 | 高跳出率 | SEO 惯用"跳出率"，与同组"低点击率/低曝光度"体例一致，"高跳出"生硬 |
| 696 | I've saved my codes | 我已保存我的恢复码 | 翻译不当 | 我已保存恢复码 | 两个"我的"冗余，不符合中文习惯 |
| 692 | I can surface high-opportunity queries, check for cannibalization, and correlate SEO with on-site engagement. | 我可以挖掘高机会关键词、检查关键词自相蚕食，并将 SEO 与站内互动关联分析。 | 翻译不当 | 我可以挖掘高机会关键词、检查关键词蚕食，并将 SEO 与站内互动关联分析。 | 行业标准术语是"关键词蚕食"，"自相蚕食"非惯用说法 |
| 717 | Install Server | 安装服务器 | 应保留英文 | Install Server | 指 Raycast 中的英文命令名，译成中文后用户无法与界面命令对应 |
| 727 | Invite a teammate | 邀请一位队友 | 翻译不当 | 邀请团队成员 | "队友"偏游戏/口语，SaaS 产品惯用"团队成员" |
| 729 | Invite for {0} revoked | 已吊销给 {0} 的邀请 | 翻译不当 | 已撤销发给 {0} 的邀请 | 邀请搭配"撤销"，"吊销"用于证书/执照 |
| 751 | Keyword Cannibalization | 关键词自相蚕食 | 翻译不当 | 关键词蚕食 | SEO 领域标准译名为"关键词蚕食" |
| 769 | Line Eyes | 直线眼 | 上下文不应翻译 | Line Eyes | aria-hidden 装饰性 SVG 的 `<title>`，用户不可见，"直线眼"译法怪异 |
| 771 | Link out | 外链 | 翻译不当 | 出站链接 | 统计的是离开本站的点击，"外链"在中文 SEO 语境常指反向链接，易误解 |
| 800 | MCP token | MCP 令牌 | 应保留英文 | MCP Token | Token 约定俗成不译 |
| 801 | MCP Token | MCP 令牌 | 应保留英文 | MCP Token | Token 约定俗成不译 |
| 804 | Missing reset password token | 缺少重置密码令牌 | 应保留英文 | 缺少重置密码 Token | Token 约定俗成不译 |
| 813 | Most dropoffs after | 流失最多的步骤在 | 翻译不当 | 在此步骤后流失最多 | 原意是"最多流失发生在该步骤之后"，现译误解为该步骤本身流失最多 |
| 824 | Need a token? | 需要令牌？ | 应保留英文 | 需要 Token？ | Token 约定俗成不译 |
| 837 | No conversations yet. Start typing to create one. | 暂无对话。开始输入以创建一个。 | 翻译不当 | 暂无对话，开始输入即可创建。 | "创建一个"指代悬空，翻译腔 |


## 分片 6 (行 841-1008)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 866 | No Severity | 无严重级别 | 翻译不当 | 无严重程度 | "严重级别"生硬，severity 惯用译法为"严重程度" |
| 872 | On | 于 | 翻译不当 | 在此日期 | 日期筛选下拉选项，单字"于"含义不明；应与 873"在此日期或之后"保持对应 |
| 875 | Only {0} and {1} clients can authenticate with MCP. Create one and copy the MCP token from the success screen — it's only shown once. | 只有 {0} 和 {1} 客户端可以通过 MCP 认证。创建一个并从成功页面复制 MCP 令牌——它只显示一次。 | 应保留英文 | 只有 {0} 和 {1} 客户端可以通过 MCP 认证。创建一个并从成功页面复制 MCP Token——它只显示一次。 | Token 属约定俗成保留英文的技术词，译作"令牌"降低辨识度 |
| 891 | Origins | 源 | 翻译不当 | 来源 | 筛选面板分区标题，单字"源"过于简略生硬 |
| 894 | Overview public availability | 概览公开可用性 | 翻译不当 | 概览公开访问设置 | "可用性"易误解为 uptime；此处实为分享链接的公开访问配置 |
| 904 | Pattern | 图案 | 上下文不应翻译 | Pattern | 该字符串位于 chart-defs.ts 的 visx 组件名集合中，用于组件名匹配判断，非用户可见文案，翻译会破坏功能 |
| 908 | Payload Format | 载荷格式 | 应保留英文 | Payload 格式 | Webhook 配置中 Payload 为约定俗成技术词，保留英文更易识别 |
| 977 | Referrals | 来源引荐 | 翻译不当 | 引荐来源 | "来源引荐"语序生硬，"引荐来源"更符合中文习惯 |
| 995 | Report public availability | 报表公开可用性 | 翻译不当 | 报表公开访问设置 | 同 894，"公开可用性"易被理解为可用性(uptime)指标 |


## 分片 7 (行 1009-1176)

| 序号 | 英文 | 当前中文 | 问题类型 | 建议中文 | 理由(简短) |
|---|---|---|---|---|---|
| 1011 | Revoke | 吊销 | 翻译不当 | 撤销 | 吊销多用于证书/执照，权限/邀请类操作中文 UI 惯用"撤销" |
| 1012 | Revoke client | 吊销客户端 | 翻译不当 | 撤销客户端 | 同上，"撤销客户端(访问权限)"更符合中文习惯 |
| 1013 | Revoke invite | 吊销邀请 | 翻译不当 | 撤销邀请 | "吊销邀请"搭配生硬，应为"撤销邀请" |
| 1055 | Select a billing plan | 选择一个账单套餐 | 翻译不当 | 选择一个计费套餐 | "账单套餐"生硬，计费场景惯用"计费套餐" |
| 1083 | Send your token as an {0} header, with {1} in place of {2}. Clients that can't set headers take it as a {3} query param instead. | 将你的令牌作为 {0} 请求头发送，用 {1} 替换 {2}。无法设置请求头的客户端可改用 {3} 查询参数。 | 应保留英文 | 将你的 Token 作为 {0} 请求头发送，用 {1} 替换 {2}。无法设置请求头的客户端可改用 {3} 查询参数。 | Token 为约定俗成英文术语，开发者场景译作"令牌"降低可读性 |
| 1120 | Single-pageview session | 单页浏览会话 | 翻译不当 | 单次页面浏览会话 | 基线 Pageview=页面浏览；"单页浏览"易误解为"单页应用(SPA)"，实指仅一次页面浏览 |


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

