# 漏斗图按 Event 统计设计

## 背景与目标

当前漏斗图的 `Funnel Group` 提供 Session 和 Profile。查询分别按 `session_id` 或 `profile_id` 聚合，`windowFunnel` 对每组只返回最长链的级别。因此同一用户在同一统计范围内完成多次漏斗时，Profile 模式最多计一次；同一会话内完成多次时，Session 模式也最多计一次。

增加 `Event` 选项，以**每次满足首步条件的事件**作为一次漏斗进入。同一用户在同一会话或不同会话中可以贡献多次进入及多次转化。用户已确认：对 `A₁ → A₂ → B`，第一步计 2 次，第二步计 1 次；B 只能归属一次进入。

本设计只改变漏斗图的新增 Event 模式。既有 Session、Profile 模式及未设置 `funnelGroup` 的旧报表保持原口径。

现状依据：`packages/db/src/services/funnel.service.ts` 负责分组、步骤条件及漏斗汇总；`packages/validation/src/index.ts` 定义选项；`apps/start/src/components/report/sidebar/ReportSettings.tsx` 展示 Funnel Group；`packages/trpc/src/routers/chart.ts` 的 `getFunnelProfiles` 提供查看用户；`packages/db/src/services/conversion.service.ts` 也读取同一选项。自部署模板当前使用 ClickHouse `25.10.2.65`。ClickHouse 的 [`windowFunnel` 文档](https://clickhouse.com/docs/reference/functions/aggregate-functions/parametric-functions#windowfunnel)明确说明，同组存在多条链时只返回最长链级别。

## 统计口径

### 统计单位和身份范围

- 一条满足首步条件的物理事件是一条进入记录，唯一标识使用项目 ID 与事件 ID。事件 ID 相同的重复存储行不得制造多次进入；不同事件 ID 即使时间戳相同仍是不同事件。
- 按 `profile_id` 组织事件序列，可跨会话匹配。此处沿用事件表中的身份归属，不额外回溯身份合并历史。匿名身份及空 `profile_id` 的实际存储情况须在实现时用真实样本核对，不能将所有空值并成同一用户。
- 只有首步事件创建进入记录。其他步骤的原始事件数量不是该步骤的漏斗人数或次数。

### 事件匹配

对每个用户，取所选时间范围内满足任一步骤条件的事件，按 `created_at`、事件 ID 稳定排序。每一步继续使用现有 `funnelSteps`：同一步的多个备选事件为 OR；每个备选事件自身过滤器与全局过滤器均须满足。

逐事件处理时，先尝试推进已有进入记录，再为满足首步条件的当前事件创建新进入记录：

1. 只考虑下一步与当前事件匹配、且从该进入的首步到当前事件仍处于 `funnelWindow` 内的记录。
2. 同时存在多个候选时，优先推进首步时间最早的记录；同时间按首步事件 ID 排序。一个事件最多推进一条已有记录的一个步骤。
3. 默认要求当前事件时间戳严格大于该记录已匹配的上一步时间戳，与现有 `strict_increase` 默认口径一致。启用现有 `FUNNEL_NON_STRICT_ORDERING` 时允许相同时间戳，但仍按事件 ID 稳定排序，且不能用同一物理事件连续完成两个步骤。
4. 当前事件若同时满足首步和某条已有记录的下一步，可以推进那条记录，同时以自身身份创建一条新进入。这使 `A → A` 类漏斗仍能统计每次首步发生，但它对后续步骤的推进只归属一条已有记录。
5. 当前事件即使满足多个后续步骤，也只推进当前进入的下一步，不跳步、不在同一事件上连进两步。超出窗口的记录停止推进，保留已达到的最高步骤。

例如，`A → B → A → B` 得到各步 `2/2`；`A → A → B` 得到 `2/1`；`A → B → B` 得到 `1/1`。对于 `A → B → C`，若某条进入只到 B，则它计入第一、二步，不计入第三步。各步次数因此单调不增；转化率和流失数继续按现有结果公式计算，但分母改为首步进入次数。

### 时间与 Breakdown

- 与现有漏斗一致，所有参与匹配的事件都必须落在报表所选时间范围内；`funnelWindow` 从每条进入的首步事件开始计算。暂不跨报表结束时间向后读取事件。
- 普通事件、Profile 和 Cohort Breakdown 归属每条进入在首步时的值，不随之后事件的属性变化而改变。首步是多事件 OR 时，以实际命中的那条首步事件取值。
- `group.*` 继续遵循现有按组展开的含义：同一进入可出现在其所属的多个组中，但在每个组内，后续事件仍只能推进一次进入。实现时应在组内独立匹配，避免 `ARRAY JOIN` 产生的副本在同一组被重复计数。
- 点击某个 Breakdown 的步骤或流失数时，查看用户的查询必须使用与图表相同的进入记录和归属值。

## 方案选择

| 方案 | 优点 | 问题 |
| --- | --- | --- |
| 将事件 ID 直接作为现有 `windowFunnel` 分组键 | 改动看似小 | 一组只有一条事件，无法组成跨事件漏斗；按每个首步事件重扫用户事件还可能重复使用 B。不可采用。 |
| 对每个首步事件独立运行 `windowFunnel` | 每条进入较易解释 | `A₁ → A₂ → B` 容易将 B 同时计入两条进入，违背已确认的一对一口径；逐进入展开可能放大扫描量。 |
| **按用户有序事件流做一次确定性匹配** | 可落实一对一分配、部分完成、窗口和每次进入的 Breakdown | 需要新增查询路径，并验证高频用户的内存及查询延迟。推荐。 |

推荐在 ClickHouse 中先按项目、日期、步骤事件名及过滤条件缩小输入，再按用户构造有序流并执行匹配状态机，产出每条进入的 `entry_event_id`、`profile_id`、最高 `level` 和首步 Breakdown 值。具体采用数组折叠、分段流处理或其他 SQL 形式，以实际 ClickHouse 版本上的正确性和资源测试决定；不得仅将 `windowFunnel` 返回的最长链级别乘以首步事件数。ClickHouse 官方文档说明 `windowFunnel` 对同组多条链只返回最长链级别。

## 组件与接口变更

1. **配置和校验**：`zFunnelOptions.funnelGroup` 收敛为 `session_id | profile_id | event`，缺省仍按 `session_id`。报表创建、更新及查询入口共同校验非法值，避免当前 `string` 类型使未知值悄然回退到 Session。`Report.options` 已是 JSON，本变更不需要关系库字段迁移。
2. **编辑器**：`ReportSettings.tsx` 的 Funnel Group 增加 `Event` 并在选择时解释“每次首步事件计一次”。当前同一个设置也显示于 Conversion 图；Event 只在漏斗图开放，Conversion 图不暴露或接受该值，避免 `conversion.service.ts` 将未知值回退为 Session。
3. **查询服务**：`FunnelService` 保留 Session/Profile 的既有 `windowFunnel` 路径；Event 走新的进入记录路径。步骤解析、备选事件条件、全局过滤、Breakdown 值归一化和漏斗结果整理尽量共享。图表当前、对比期间必须分别按相同口径查询。
4. **结果契约**：现有步骤的 `count`、`percent`、`dropoffCount` 等字段形状保持不变；Event 模式下 `count` 表示进入次数。新增明确的计数单位元数据供界面与报告消费者显示。现有 `totalSessions` 字段若需兼容保留，应增加语义明确的 `totalEntries`，不能把 Event 次数在界面上标为 Sessions 或 Users。
5. **查看用户**：`getFunnelProfiles` 与图表共享进入记录。Event 模式下按 `profile_id` 去重显示用户，并为每个用户提供当前步骤的 `occurrenceCount`；查看流失时计数对应“该用户有多少条进入恰好停在此步”。用户行数可以小于图表次数。现有最多返回 1000 个用户的限制保持，但界面应说明列表截断不影响图表总次数。
6. **外部入口**：已保存漏斗报表的数据读取自然使用其 `options.funnelGroup`。独立的 Insights `groupBy` 直查接口及 Agent/MCP 生成参数当前只有 Session/Profile 语义，首版不增加 Event 值；后续若开放，需同步设计 `totalUsers` 等返回字段，不能把次数填进“用户数”。

## 验收与验证

| 场景 | 预期 |
| --- | --- |
| 同一用户同一会话内 `A B A B` | Event 两步均为 2；Session 仍最多为 1。 |
| 同一用户 `A A B` | Event 为 `2/1`，B 只归属一次进入。 |
| 同一用户 `A B B` | Event 为 `1/1`，第二个 B 不增加计数。 |
| 首步或后续步骤含多个备选事件、各自有过滤器 | 任一备选命中即可满足该步；全局过滤仍适用。 |
| 后续事件超出 Funnel Window 或报表结束时间 | 该次进入停在已完成的最高步骤。 |
| 同时间戳事件及事件可同时匹配多个步骤 | 严格/非严格模式符合上述规则，多次执行结果一致。 |
| 普通 Breakdown、`group.*`、Cohort Breakdown | 各桶之和与其归属规则一致；图表、查看用户及流失列表使用同一进入记录。 |
| 旧报表、Session、Profile 及 Conversion 图 | 结果与变更前一致，旧配置无须迁移。 |
| 空 `profile_id`、两台匿名设备各出一步 | 按设备拆成两个身份，不合并成一次转化（`1/0`）。 |
| 空 `profile_id` 且空 `device_id` | 每个事件自成一个身份，孤立的后续步骤无法推进（`1/0`）。 |
| 同一 `device_id`，首步具名、次步匿名 | `profile_id` 优先级高于 `device_id`，两者不合并（`1/0`）。 |

验证分为纯匹配规则测试、SQL `EXPLAIN`、真实 ClickHouse 行为测试和目标规模性能测试。性能测试至少覆盖 30 天约 1000 万事件、多次进入的高频用户、含 OR 与属性过滤的步骤、Breakdown、查看用户及并发报表；记录查询 p95、峰值内存、扫描行数与失败率。性能门槛须在上线前结合部署机器和既有报表基线确定；设计文档本身不代表已经通过规模验证。

## 实施边界

本设计不修改事件采集、会话划分、历史身份合并、Conversion 图统计口径或原始事件保留策略。若真实数据发现空 `profile_id`、重复事件 ID 或极端高频用户导致身份混合或内存失控，应先补充明确的处理规则和行为测试，再开放 Event 选项。

### 匿名身份处理规则（前置条件已满足）

Event 模式的分组键按以下优先级取值，实现见 `funnel.service.ts` 的 `buildFunnelCte`（`group === 'event'`）：

```text
user_key = profile_id
         -> __d_<device_id>    （profile_id 为空）
         -> __e_<event_id>     （profile_id 与 device_id 均为空）
```

要点：空 `profile_id` **不会**并成同一个用户；缺少设备标识时退化为“每个事件自成一个身份”，即匿名孤立事件无法互相推进漏斗，宁可少计也不虚增转化。

对应行为测试：`packages/db/src/services/funnel-event-anon.test.ts`（真实 ClickHouse）。每个用例都构造成“若把空 `profile_id` 合并成同一用户则数值翻转”，已用两种反向改动（去掉 fallback、令 `device_id` 优先）验证测试会失败而非空过。重复事件 ID 的对应测试见 `funnel-event-dedup.test.ts`；高频用户的内存与规模门槛仍属未完成的性能验证项。
