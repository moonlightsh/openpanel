# OpenPanel 控制台汉化设计（方案 B：构建期改写 + 原文键字典）

- 日期：2026-09-24
- 范围：`src/apps/start`（控制台 Dashboard）
- 状态：设计已定稿，待实施
- 前置约束：本仓库 `src/` 是 fork（`moonlightsh/openpanel`）的 submodule，汉化**不向上游合并**，但需要长期低成本跟随上游

## 1. 目标与非目标

### 1.1 目标

- **G1 覆盖度**：控制台几乎全量词条汉化，且覆盖度**可度量、可在 CI 中卡住**，而不是靠人肉巡检拍脑袋。
- **G2 同步成本**：每次 `git merge upstream/main` 的汉化维护成本，与**上游新增词条数**成正比，而不是与上游改动的文件数成正比。冲突面必须收敛到个位数文件。
- **G3 不可退化**：任何未翻译词条必须自动回退英文原文。漏翻只能表现为"这里还是英文"，绝不能表现为白屏、显示 key 或报错。

### 1.2 非目标（v1 明确排除）

- `apps/public`（官网 + 文档，Next.js，154 个文件）—— 独立技术栈、独立内容体系，自建部署时再单独立项。
- `packages/email`（事务邮件）—— 服务端渲染，需要按收件人维度决定语言，与控制台的构建期方案不同源，单独立项。
- `apps/api` 的 Swagger 文档与对外 API 错误码 —— 面向集成方，保持英文。
- 用户数据本身（项目名、事件名、自定义属性名与取值、URL、路径）—— 永不翻译。

## 2. 现状证据（实测）

全部数据来自对 `src/apps/start/src` 的 AST 扫描与 git 历史统计，非估算。

| 观测项 | 数值 | 含义 |
|---|---|---|
| ts/tsx 源文件数（排除测试） | 646 | 传统 `t()` 改写的爆炸面 |
| 去重可见词条（粗粒度提取器） | 1476 | 规则调优后预计 1800–2500 |
| ├ JSXText | 759 | |
| ├ 白名单 JSX 属性 | 384 | |
| ├ 配置对象字面量（`label:`/`title:`…） | 339 | |
| ├ `toast.*` | 92 | |
| └ 模板字符串 | 21 | |
| 含文案的 JSX 元素中，文案与 `{表达式}`/子元素**混排**的比例 | **18.4%**（176 / 959） | 决定译文质量的关键数字 |
| 最近 200 个提交中改动 `apps/start/src` 的数量 | **186** | 上游 churn 极高 |

既有 i18n 基础设施：**无框架**。仅有两份英文静态表 `src/translations/countries.ts`（255 行，ISO→英文国名）与 `src/translations/properties.ts`（24 行，属性名）。

本地化基础设施缺口：

- `src/routes/__root.tsx` 硬编码 `<html lang="en">`
- `src/utils/date.ts` 的 `getLocale()` 读 `navigator.language`；`javascript-time-ago` 仅注册 `en`；`formatDate` 产出 `3 mar` 形态
- `styles.css` 无 CJK 字体栈

构建链：`apps/start/vite.config.ts` 使用 `viteReact()`（`@vitejs/plugin-react@5.2`）；`pnpm-workspace.yaml` 含 `packages/**`。二者共同提供了干净的注入点与新包落点。

## 3. 方案选型

| 方案 | 覆盖度 | 上游同步成本 | 结论 |
|---|---|---|---|
| A. i18next + 全量改写为 `t('key')` | 高 | **极差**：约 650 个源文件被改写，上游每改一个组件就冲突一次 | 否 |
| **B. 构建期 AST 改写 + 以英文原文为 key 的字典** | 高（可度量） | **极低**：上游源码零改动，只有字典 JSON 需补新条目 | **采纳** |
| C. 运行时 DOM 遍历替换 | 中 | 低 | 否：闪烁、破坏受控输入与属性、无法处理插值、SSR 不一致 |

方案 B 的两个根本决定：

1. **key 就是规范化后的英文原文**，不是文件路径+行号，也不是人造的 `settings.profile.title`。上游重构、挑文件、改目录结构，字典全部继续命中。这是 G2 成立的唯一原因。
2. **查不到就回退英文原文**。上游新增 30 条文案，合并后立即能跑，只是那 30 条显示英文，CI 报告精确指出是哪 30 条。这就是 G3。

一个顺带的结构性红利：因为 key 即英文，**英文不需要字典**——`locale=en` 时 `__t` 原样返回 key。所以中英切换几乎零成本，v1 就把它做进去。

## 4. 架构

### 4.1 包布局

新增一个 fork 本地包，路径与 scope 都与上游区隔（上游永远不会创建这个路径 → 零冲突）：

```text
src/packages/i18n-zh/            # @openpanel-zh/i18n，被 pnpm-workspace 的 packages/** 自动纳入
├─ plugin/
│  ├─ index.ts              # vite-plugin-op-i18n（enforce: 'pre'）
│  ├─ rules.ts              # 改写规则矩阵 + 拒结清单
│  └─ extract.ts            # 与改写共用同一遍 AST 遍历
├─ runtime/
│  ├─ index.ts              # __t / __tx / locale store（< 1KB）
│  └─ dict.generated.ts     # 由 locales/*.json 编译而成
├─ catalog/en.json           # 提取产物（入库，用 diff 看上游新增/废弃）
├─ locales/zh-CN.json        # 译文（人工 + LLM 维护）
├─ locales/zh-CN.attic.json  # 废弃条目存档
├─ overrides/                # 按 key 索引的专用表（countries / properties）
├─ glossary.md               # 术语表（见 §9）
└─ cli/                      # extract / check / translate / report
```

字典规模估算：2500 条 × 平均 60B ≈ 150KB JSON，gzip 后 ≈ 45KB。v1 单包全量加载；若后续介意首屏体积，再按路由分片（catalog 已记录每条的引用文件，分片所需信息已具备）。

### 4.2 构建期改写链路

独立 Vite 插件，**不**摊在 `plugin-react` 的 babel 钩子上。理由：需要显式控制 include 范围（含 `packages/**` 里的纯 `.ts`）、控制与 `tanstackStart()` 的执行次序，并且不依赖 `plugin-react` 内部的文件过滤行为。

关键实现选择：**`@babel/parser` 只用于取 AST 位置，实际改写用 `magic-string` 做外科手术式区间替换**，不走 `@babel/generator` 全文重生。好处：

- 除被替换区间外，源码字节级不变 → sourcemap 保真，调试体验接近原生
- 不引入格式化噪声，不与 biome/ultracite 冲突
- 单文件开销可控，可按 mtime + 内容 hash 做 transform 结果缓存

注入的 runtime 引用走**虚模块** `virtual:op-i18n`，由插件自己 `resolveId`/`load`。这样 `apps/start/package.json` **不需要新增任何依赖项**，直接剔除了一个高频冲突文件。注入名称统一前缀 `__opT` / `__opTx`，避开与业务标识符撞名。

**共享包的处理靠构建边界自然隔离**：`packages/constants/index.ts` 里的 `timeWindows[*].label`（`Last 30 min`/`Last 7 days`…）属于 UI 文案，需要翻译；但同一个文件也被 `api`/`worker` 消费，那里不能翻。而 `apps/start` 用 Vite 构建、`api`/`worker` 用 tsdown 构建 —— 插件只存在于 Vite 图中，所以同一份源码在控制台被翻译、在后端保持英文，不需要额外机制。

### 4.3 运行时

```ts
// 值占位符：纯值替换
export function __t(msgid: string, ...args: unknown[]): string;
// 元素占位符：返回 ReactNode[]，用于占位符含 JSX 子元素的场景
export function __tx(msgid: string, parts: React.ReactNode[]): React.ReactNode[];
```

- 查找：`dict[locale]?.[msgid] ?? msgid`，然后按 `{0}` `{1}` 位置插值。
- **不实现复数引擎**。中文无复数形态；英文源码里的 `event` / `events` 分支本身就是两条独立词条，分开翻即可。不引入 ICU 是刻意的简化。
- locale 源：cookie `op_locale`，默认 `zh-CN`。SSR 从请求 cookie 读，客户端从 `document.cookie` 读，两侧一致 → 无 hydration mismatch。
- 因为字典是编译期确定的静态导入，服务端与客户端必然同一份数据。
- dev 下未命中的 msgid 推入 `window.__OP_I18N_MISSES`，供 §7 的第二层采集。

### 4.4 catalog 与字典

`catalog/en.json`（提取产物，入库）：

```json
{
  "No users found": { "refs": ["components/users/table.tsx:88"], "count": 3 },
  "This session has {0} screen views and {1} events": { "refs": ["modals/event-details.tsx:264"], "count": 1 }
}
```

`locales/zh-CN.json`（译文）：`{ "No users found": "未找到用户" }`。

msgid 规范化规则（必须提取与运行时完全一致，否则静默漏翻）：首尾去空白 → 连续空白（含换行）折叠为单个空格 → 解码 HTML 实体。

废弃条目**不删除**，移入 `zh-CN.attic.json`。上游回滚或把文案挑回来时，译文免费复活。

同词多义逃生口：msgid 可写作 `"Name\u0000column"`（原文 + `\0` + 上下文）。默认不带上下文，只在实际冲突（如表头 `Name` vs 表单字段 `Name`）时手工标注。

## 5. 提取与改写规则

提取（`i18n:extract`）与改写（构建）**共用同一份规则代码和同一遍遍历**。这是覆盖度可信的前提：不存在“提取器看到了但改写器没改”或反之的偏差。

### 5.1 改写点矩阵

| 位置 | 处理 |
|---|---|
| `JSXText` | → `{__opT("…")}` |
| 白名单 JSX 属性 | `placeholder` `title` `label` `alt` `aria-label` `description` `tooltip` `emptyMessage` `confirmText` `cancelText` `subtitle` `heading` |
| JSX 属性中的模板串 | → `__opT` + 位置占位符 |
| `toast.*(…)` | 位置参数与 `{title,description,message}` |
| zod | `.min(n,'msg')` `.max` `.email` `.url` `.regex` `.refine(fn,'msg')` 及 `{message}` 形式 |
| 白名单对象属性 | `label:` `title:` `description:` `placeholder:` —— **仅限目录白名单内**，避免把数据键当文案 |
| `<html lang="en">` | → `zh-CN`。用插件规则改写，**不动 `__root.tsx`**（它是 13/200 的高 churn 文件，不值得占一个冲突位） |

### 5.2 元素级整句提取（对应那 18.4%）

把一个元素的全部 children 合并成**一条**带位置占位符的消息，而不是切成碎片分别翻译：

```tsx
// 源码（modals/event-details.tsx:264）
<div>This session has {views} screen views and {n} events.</div>
// 正确：一条消息
__opT('This session has {0} screen views and {1} events.', views, n)
// 错误：三个碎片 → 中文语序必错
'This session has' / 'screen views and' / 'events.'
```

占位符全为表达式 → `__opT`；含 JSX 子元素（如 `"Type" + <span> + "to confirm"`）→ `__opTx` 返回 `ReactNode[]`。

**这项必须在 v1，不能延期** —— 它是译文质量的分水岭，且后期补做会作废已有译文。

### 5.3 绝不改写清单

- 样式：`className`、`cn()` / `cva()` / `clsx()` / `tv()` 的所有参数
- 标识：`id` `key` `name`（表单字段名）`href` `src` `to` `data-*` `type` `role`
- 模块：import/export 说明符、动态 `import()` 路径
- 代码形态串：匹配 `^[a-z0-9_.\-/:#]+$`（纯小写 + 点/斜杠/下划线）或 `^https?://`
- 无字母串、单字符串、纯数字串
- 生成文件：`routeTree.gen.ts`、`*.gen.ts`
- 测试文件：`*.test.ts(x)` `*.spec.ts(x)`
- `<code>` / `<pre>` / CodeMirror 内的内容、onboarding 里的 SDK 代码片段

### 5.4 已知陷阱（必须单独处理）

1. **`NOT_SET_VALUE = '(not set)'`**（`packages/constants`）同时被当作**查询值参与过滤比较**，盲翻会默默弄坏筛选结果。处理：加入拒结清单，只在展示边界翻译。同类需排查的还有 `RESERVED_EVENT_NAMES`。
2. **`countries.ts` / `properties.ts`** 是按 ISO 码、属性名索引的映射表，语义上不是“界面文案”。走 `overrides/` 专用中文表，不进通用字典，不经过 AST 改写。
3. **`{' '}` 空白表达式** 在本仓大量出现（如 `{n.toLocaleString()} impr ·{' '}`）。元素级提取时必须把它当**字面空白**处理，不能当占位符，否则每条消息都会多出一个垃圾 `{n}`。
4. **HTML 实体解码**：JSXText 里的 `&nbsp;` `&amp;` 由 JSX 编译器解码；一旦改写成字符串字面量就不再解码。必须在提取/改写时自行解码。
5. **文本长度**：中文比英文短 40–50%，固定宽度/截断/省略号位置会失调，需 §10 P4 的视觉 pass。

## 6. 上游同步契约（G2）

### 6.1 冲突面：只有 3 个文件 + 锁文件

| 文件 | 改动 | 历史 churn | 备注 |
|---|---|---|---|
| `apps/start/vite.config.ts` | +2 行（相对路径 import + 插件入数组） | 低 | |
| `apps/start/src/utils/date.ts` | locale 感知的日期/相对时间 | 低（不在 top-20） | 见 §8 |
| `apps/start/src/styles.css` | CJK 字体栈 +3 行 | 低 | |
| `pnpm-lock.yaml` | 新增一个 importer block | 高但机械可解 | 冲突时取上游版本后 `pnpm install` 重生 |

刷掉的冲突位：`apps/start/package.json`（虚模块方案不需依赖项）、`routes/__root.tsx`（`lang` 由插件改写）、`pnpm-workspace.yaml`（`packages/**` 已覆盖新包）。

其余全部为新增文件，上游永远不会产生对应版本 → 结构上不可能冲突。

### 6.2 同步 runbook

```bash
git fetch upstream && git merge upstream/main   # 冲突只可能出在 6.1 的四个文件
pnpm install                                   # 锁文件冲突就取上游版本再跑这句
pnpm i18n:extract                              # 重新提取 catalog
pnpm i18n:check                                # 输出：新增 N 条 / 废弃 M 条 / 覆盖率 X%
pnpm i18n:translate --missing                  # LLM 批量补，人工 review 单个 JSON 的 diff
pnpm i18n:check                                # 覆盖率回到阈值之上
```

预期单次成本 10–30 分钟，review 面是一个 JSON 文件的 diff。对比方案 A：上游动过的每个组件都要手工合并 `t()` 调用。

### 6.3 分支约定

汉化工作在 `pi/zh-i18n` 分支开展，完成后合入 `dev/tiandy`。提交末尾带 `Co-Authored-By: Pi`，不主动 push。

## 7. 覆盖度保障（G1）

三层，缺一层都做不到“几乎全量”。三层的能力边界不同，是互补而非冗余的。

### 第一层：静态提取对账（能抗回归）

`pnpm i18n:check` 输出已译 / 缺失 / 废弃，覆盖率**按出现次数加权**（一个出现 20 次的 `Cancel` 比一个出现 1 次的文案重要）。低于阈值（起始 98%）CI 失败。

这一层的局限：只能看见 AST 规则覆盖到的位置。

### 第二层：运行时漏译采集（能捕获 AST 看不到的）

dev 下 `__opT` 未命中即记录，Vite 开发中间件落盘到 `.i18n/runtime-misses.json`。专门抓：动态拼接的文案、从后端返回的错误文案、第三方组件（react-day-picker、cmdk 空态、data-table）内部文案。

### 第三层：伪本地化 + 全路由巡检（唯一能证明覆盖度的手段）

`OP_I18N_PSEUDO=1` 把所有**已翻译**的输出包上 `〖〗`。于是页面上任何裸英文就是漏译，肉眼一眼可见，不需要对着词表比对。

配合 `src/routes/` 目录里现成的完整路由清单，用 agent-browser 跑一遗所有路由 + 打开每个 modal（`src/modals/index.tsx` 有完整注册表），产出漏译清单与截图。

### 验收口径

- 第一层加权覆盖率 ≥ 99%
- 第二层在全路由巡检后的漏译条目全部归类：已补译 / 列入拒结清单（用户数据、代码片段）
- 第三层伪本地化下主要路由无裸英文（除拒结清单项）

## 8. 非文案本地化

| 项 | 现状 | 处理 |
|---|---|---|
| `<html lang>` | 硬编码 `en` | 插件属性规则改为 `zh-CN`（不动源文件） |
| `getLocale()` | 读 `navigator.language`，SSR 固定 `en-US` | 改为读 cookie `op_locale`，与 `__opT` 同源 |
| `javascript-time-ago` | 仅注册 `en` | 注册 `locale/zh`，按 locale 选 |
| `formatDate` | 产出 `3 mar` | 增加中文分支：`3月24日` |
| date-fns | 默认 en | 需要月份/星期名的调用传 `zhCN` |
| 字体 | Latin 优化字体栈 | `styles.css` 补 CJK 栈（系统字体优先，不引入 webfont，避免首屏体积） |
| 数字 | `toLocaleString()` 无参 | 不动，已跟随浏览器 |
| 图表 | recharts/nivo 用我们传入的 label | 随文案字典自动生效 |

字体栈不引入 webfont 是刻意选择：中文 webfont 动辑数 MB，对一个内部控制台不值得。

## 9. 术语表（初版，待 review）

术语必须先定，否则 2000+ 条译文返工。存于 `packages/i18n-zh/glossary.md`，`i18n:check` 会校验译文对术语表的一致性。

| 英文 | 中文 | 英文 | 中文 |
|---|---|---|---|
| Event | 事件 | Funnel | 漏斗 |
| Profile | 用户画像 | Retention | 留存 |
| Session | 会话 | Cohort | 用户群组 |
| Group | 分组 | Insight | 洞察 |
| Dashboard | 仪表盘 | Report | 报表 |
| Client | 接入客户端 | Project | 项目 |
| Organization | 组织 | Member | 成员 |
| Pageview | 页面浏览 | Bounce rate | 跳出率 |
| Conversion | 转化 | Referrer | 来源 |
| Property | 属性 | Breakdown | 拆分 |
| Realtime | 实时 | Notification rule | 通知规则 |
| Integration | 集成 | Webhook | Webhook（不译） |

## 10. 分期与验收

| 阶段 | 内容 | 产出 | 估时 |
|---|---|---|---|
| P0 | 插件 + 运行时最小闭环，单页验证（必含一个混排元素） | 可运行的 spike + sourcemap 验证 | 0.5d |
| P1 | 完整改写规则矩阵 + extract/check CLI + 术语表定稿 | catalog/en.json、CI 卡点 | 1–2d |
| P2 | 翻译 1800–2500 条（LLM 批量 + 人工 review） | locales/zh-CN.json | 1–2d |
| P3 | 日期/相对时间/字体/lang 等本地化基础设施 | §8 全部条目 | 0.5d |
| P4 | 伪本地化 + 全路由巡检 + 视觉修正 | 巡检报告 + 漏译清单歒零 | 1d |

合计约 5–7 人日。P0 是门槛：如果元素级整句提取在 P0 做不出来，整个方案应重新评估，而不是带着碎片翻译往下走。

### 测试策略

- 插件单测（vitest）：fixture 源码 → 预期改写结果。必须覆盖：纯 JSXText、属性、混排（值占位符）、混排（元素占位符）、`{' '}`、HTML 实体、拒结清单每一类
- catalog 确定性快照：同一输入两次提取必须字节一致（否则 diff 噪声会毁掉 §6.2 的 review 体验）
- 规范化函数属性测试：提取侧与运行时侧必须调用同一实现（用类型与测试双重约束）
- 回归：`pnpm --filter start typecheck` + `pnpm --filter start build` 必须绿

## 11. 风险与取舍

| 风险 | 影响 | 缓解 |
|---|---|---|
| 构建期魔法：源码字面量与实际渲染不一致 | 新人定位文案时会迷惑 | magic-string 保真 sourcemap；`i18n:report` 可反查“某条中文来自哪个文件” |
| 同词多义 | 少量词条译文不贴切 | `\0context` 逃生口，按需启用 |
| 上游改写英文文案（非新增） | 旧 msgid 失效，新 msgid 未译 | `i18n:check` 会同时报“新增 1 / 废弃 1”，attic 保留旧译文可直接搬过去 |
| 上游换构建链（如换成 plugin-react-oxc） | 插件失效 | 插件是独立 Vite transform，不依赖 plugin-react；换 Rust 链也不影响，只要 Vite 插件协议不变 |
| 第三方组件内部文案 | 局部英文残留 | 第二/三层巡检捕获，逐个传 locale props 或覆盖文案 |
| 构建耗时增加 | dev 热更新变慢 | 按内容 hash 缓存 transform 结果；include 范围精确限定 |

最大的取舍是第一项：用“源码不再自文档”换“上游零改动”。在不向上游合并且 churn 高达 186/200 的前提下，这笔交易是值的；如果哪天改主意要往上游提 PR，字典 + catalog 可以机器转成正规 `t()` 改写（已有每条的 refs 位置），不是死胡同。

## 12. 已定决策与待确认

### 12.1 本设计已自行定下（可推翻，但默认执行）

| 决策 | 取值 | 理由 |
|---|---|---|
| 中英切换 | 支持，默认 `zh-CN` | key 即英文，英文不需字典，切换几乎零成本 |
| 复数/ICU | 不实现 | 中文无复数形态；英文源码自己已分支 |
| 译文存储 | JSON，非 PO/YAML | 无额外工具链，diff 友好 |
| 字典加载 | v1 全量单包（gzip ≈ 45KB） | 控制台非首屏敏感场景；分片所需信息已在 catalog 里，随时可加 |
| 字体 | 只用系统 CJK 字体栈 | 中文 webfont 体积代价不划算 |

### 12.2 待你确认

1. **术语表（§9）** —— 尤其是 `Profile→用户画像`、`Cohort→用户群组`、`Client→接入客户端`、`Insight→洞察` 这几个。这是 P1 的前置阻塞项。
2. **覆盖率 CI 阈值** —— 起始 98%、稳定后 99%，是否接受。
3. **伪本地化巡检的环境** —— 需要一个有真实数据的 dev/staging 实例（空项目会把大量数据态页面遮住，巡检会漏）。用哪个环境？
4. 非目标（§1.2）中 **`packages/email` 是否真的可以暂不做** —— 如果内部用户会收到邀请邮件/通知邮件，可能需要提到 v1。

## 13. 依据

- 词条与混排比例：对 `src/apps/start/src` 全量 646 个 ts/tsx 文件的 `@babel/parser` AST 扫描（1 个文件解析失败，已记录待 P1 处理）
- churn：`git log --oneline -200 --name-only -- apps/start/src`
- 构建链：`apps/start/vite.config.ts`、`apps/start/package.json`、`pnpm-workspace.yaml`
- 既有本地化代码：`src/translations/{countries,properties}.ts`、`src/utils/date.ts`、`src/routes/__root.tsx:122`
