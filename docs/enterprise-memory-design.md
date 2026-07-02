# KeyMemory 企业级多层级记忆底座 · 设计文档

> **分支**: `feat/enterprise-multi-tier-memory`
> **版本**: v0.1 (2026-07-02)
> **状态**: 设计已收敛,待 review 后进入实施

---

## 0. 文档定位

本文档是基于两轮定向调研(企业级 AI 记忆系统 + 多 Agent 团队形态)和多轮设计讨论收敛后的完整设计。作为后续所有代码改造的依据。本文档不讨论实现细节,只定义「做什么」和「为什么」。

---

## 1. 背景与目标

### 1.1 问题陈述

未来企业的最小工作单元正在从「岗位」收缩为「1 人 + 一群 AI Agent」。微软 2025 Work Trend Index 把这种形态命名为 **Frontier Firm(前沿公司)**,28% 的管理者已在考虑招聘「AI workforce manager」岗位。KeyMemory 当前架构是「单机 + 单用户 + 多 Agent」,无法承载这种组织形态。

### 1.2 目标

把 KeyMemory 改造成面向中小企业的多层级记忆底座,支持:

1. **四层记忆架构**:项目库 / 公司库 / 外部库 / 个人库
2. **老板意志传导链**:中小企业里老板是战略源,意志要能脱敏传导到项目和员工
3. **动态画像**:涌现式属性(非固定字段),人机双读,可看演化
4. **多 Agent 团队形态**:1人+多Agent 团队 和 WorkBuddy 式个人账户两种形态并存
5. **个人账户协作**:员工自带个人账户,通过项目区接入企业协作
6. **AI NAS 部署**:支持本地小模型 + 云端 fallback 双通道
7. **意志传导可视化**:MVP 差异化卖点

### 1.3 非目标

- 不做企业 SSO 全量对接(留接口)
- 不做多租户 SaaS 化(本期只做单企业自部署)
- 不做实时联邦查询外部源(L3 只读 ingestion)
- 不做完整时序知识图谱(留接口,可后置)

---

## 2. 四层记忆架构

### 2.1 四层定义

| 层 | scope | 存储策略 | 谁能写 | 谁能读 |
|---|---|---|---|---|
| L1 项目库 | `project` | 一项目一库 | 项目区成员 | 项目区成员 + admin |
| L2 公司库 | `company` | 单一集中库 | admin + 授权 contributor | 全员 |
| L3 第三方库 | `external` | 只读挂载 | 不写入,只 ingestion | 按授权 |
| L4 个人库 | `personal` | 一人一库 | 本人 | 本人(可显式 share) |

### 2.2 存储策略(混合分库)

- L4 个人库:一人一文件 (`personal/{user_id}.db`)
- L1 项目库:一项目区一文件 (`projects/{project_zone_id}.db`)
- L2 公司库:单一文件 (`company.db`)
- L3 第三方库:每数据源一文件,只读 (`external/{source}.db`)
- registry 库:存所有库元数据 + users + ACL + 审计日志 (`registry.db`)

隐私边界靠文件系统权限 + 进程级访问控制双重保证。

### 2.3 联邦检索 Query Router

```
search(query, user) {
  1. 解析 user 可见的 library 列表(从 registry)
  2. 按优先级并发查询各库:
     L1 当前项目库 → L4 个人库 → L2 公司库 → L3 第三方库
  3. 各库返回 top-K
  4. 合并去重(基于 content hash + 语义相似度)
  5. 重排序(加权:项目库 > 个人库 > 公司库 > 第三方库)
  6. 每条结果标注 source_library + scope
}
```

---

## 3. 老板意志传导链

### 3.1 设计原则

中小企业里老板就是战略系统,不需要 OKR/Jira。系统把老板的话结构化、脱敏、传导。

### 3.2 老板的四重身份

| 身份 | 在系统中的位置 | 特殊设计 |
|---|---|---|
| 战略源 | 意志的原始发出者 | 写入实时触发 + 跨 scope 传导,不归到老板个人,归到 org/project |
| 决策审计者 | 全局可见 | admin 级 ACL,能下钻 evidence 层 |
| 画像主体 | 老板本人也有 personal 库(L4) | 高度敏感,默认仅本人可见;可主动「提升」为公司画像 |
| 价值观锚 | 公司画像的源头之一 | 老板的取舍/偏好,经脱敏后投影为公司画像 |

### 3.3 意志传导链路

```
老板账户写入(战略源)
      │
      ▼ [实时触发 + 脱敏归一化]
公司画像层(L2)
  · "公司当前优先级"
  · "组织价值取向"
  · "决策风格"
      │
      ├──drives──→ 项目画像层(L1)
      │             · 项目当前阶段
      │             · 项目优先级
      │
      ├──aligns──→ 员工画像层(L4,仅可见聚合)
      │             · 近期任务焦点
      │
      └──constrains──→ 外部知识库(L3)
                        · 优先 ingestion 哪类资料
```

### 3.4 老板账户识别

配置文件直接写死,主账户默认为 boss:

```
config:
  boss_user_id: 主账户ID  # 首次启动时主账户自动成为 boss
```

新增账户流程:管理员创建账户 → 默认 `role=member` → 主账户(boss)可显式提升他人为 exec/pm。

### 3.5 选择性实时触发

不是所有写入都触发抽取,按 writer 的「画像权重」分级触发:

| writer 角色 | 触发模式 | 抽取范围 |
|---|---|---|
| boss | realtime | org.* + project.* |
| exec | realtime | org.* + project.* |
| pm | realtime | project.* |
| hr | realtime | user.*(显式同步) |
| member | batch_weekly | user.self.* |

去重保护:同一 writer + 同一 attribute_name,1 小时内只抽取一次(后到的强化 evidence 和 confidence)。

### 3.6 主体归因脱敏(关键设计)

画像属性写到哪个主体,和「谁说的」是两回事。

**数据模型拆两层:归属层(subject) + 证据层(evidence)**

- `persona_attributes`(归属层):完全没有「老板」字样,员工查公司画像看到的是「公司当前优先级」
- `persona_evidence`(证据层):记 source_writer_id,仅 admin 和本人能查
- 属性名归一化:不允许「老板当前优先级」,强制映射到「公司当前优先级」

### 3.7 老板意志 vs 员工偏好冲突仲裁

| 影响范围 | 仲裁规则 |
|---|---|
| 只涉及员工个人(沟通风格、工具选择) | 按员工偏好 |
| 牵涉老板(汇报格式、交付要求) | 按老板要求 |
| 边界模糊 | 默认按老板(安全侧) |

判定依据:`persona_attributes.impact_scope` 字段(`self_only` / `involves_boss` / `involves_team` / `company_wide`)。

---

## 4. 涌现式画像系统

### 4.1 核心原则:属性涌现,而非填表

画像不该是「填表」,而是「涌现」。有什么数据长什么属性,没数据就空着,不是缺失而是不存在。

- 大公司可以有「OKR_Q3」属性
- 小公司可以有「老板最近念叨的事」属性
- 二者平等存在,属性名是自由字符串

### 4.2 数据模型

```
persona_attributes (画像属性 - 归属层,脱敏后)
  id, scope[org|project|user], subject_id,
  attribute_name,              -- 归一化名(自由字符串)
  value_text,                  -- 人读摘要
  value_struct,                -- 机读 JSON
  value_vector,                -- 语义向量
  confidence,                  -- 0.0-1.0
  valid_from, valid_until,
  superseded_by,
  visibility[public|scope_internal|self_and_manager|self_only],
  impact_scope[self_only|involves_boss|involves_team|company_wide],
  override_priority,
  captured_at

persona_evidence (证据层 - 仅 admin/本人可查)
  id, attribute_id,
  source_writer_id, source_writer_role,
  source_type[boss_saying|exec_decision|meeting_note|agent_inferred|...],
  source_memory_id, captured_at

persona_relations (画像属性间关系)
  id, source_attr_id, target_attr_id,
  relation_type[drives|constrains|aligns_with|conflicts_with|depends_on],
  strength, reason, captured_at

persona_promotions (老板主动提升)
  id, source_user_id, source_attr_name,
  target_org_attr_id, promoted_by, promoted_at, reason

persona_disputes (员工申诉)
  id, attribute_id, disputed_by, reason,
  status[pending|resolved], resolved_by, resolution, created_at

persona_triggers (writer 触发规则配置)
  writer_role, trigger_mode[realtime|batch_weekly], attribute_scope
```

### 4.3 三态表达(每条画像字段都要满足)

| 态 | 形式 | 服务对象 |
|---|---|---|
| 人读摘要 | 自然语言段落 | 员工、管理者审计 |
| 机读结构 | JSON + 向量 | Agent 高效消费 |
| 时间序列 | 历史快照 + 演化事件流 | 看成长/漂移/迭代 |

### 4.4 三种采集路径

1. **显式同步**(大公司):对接 HRIS/OKR/Jira,定时把结构化字段转成属性写入。`source_type=hr_sync`,`confidence=1.0`。没这些系统的公司这条路径直接没有。
2. **Agent 会话实时抽取**(老板/exec/PM):写入触发,LLM 双阶段抽取。
3. **周期性聚合**(所有员工):每周扫一次记忆,聚合成画像属性。关注点漂移、近期决策、知识边界等。

### 4.5 双阶段抽取 + 归一化

```
阶段 1 · 抽取(原始命名)
  输入:记忆内容 + writer 上下文
  输出:原始属性名 + 属性值 + 主体判断 + 置信度

阶段 2 · 归一化映射
  输入:阶段 1 的原始属性名
  输出:归一化属性名 + 归一化主体 + 映射置信度
```

两阶段都由 LLM 执行(NAS 本地小模型优先,云端 fallback)。阶段 2 维护「属性名词典」做映射兜底,LLM 处理未覆盖新词。

### 4.6 画像属性关系网络

属性间建立关系,形成「主体-属性-主体」动态网络:

```
公司当前优先级 ──drives──→ 项目X.当前阶段(赶交付)
                  └──aligns_with──→ 客户A.合作状态(重点客户)
```

员工能理解「为什么项目X最近这么急」,但看不到「是老板说的」。

---

## 5. 多 Agent 团队形态

### 5.1 两种形态并存

| 维度 | 形态一:部门级 1人+多Agent | 形态二:WorkBuddy 式 1人1账户 |
|---|---|---|
| 编排主导 | 系统/流程 | 用户本人 |
| Agent 关系 | 强协作、有 handoff | 弱关联、各自独立 |
| 记忆重心 | 团队/项目共享 | 个人画像 |
| 治理复杂度 | 高(需审计链) | 低(账户隔离) |
| KeyMemory 承载 | 项目层 + 老板意志链 | 个人层 + agent_space |
| 典型场景 | 销售部带 4 个职能 Agent | HR 个人提效挂 5 个工具 Agent |

两种形态会并存于同一家公司。KeyMemory 四层架构同时兼容两者。

### 5.2 多 Agent 内部协作模式

采用 Anthropic 验证过的 orchestrator-worker + artifact+引用 模式:

- Orchestrator 持有任务全局 Memory(计划、进度、关键决策),上下文超 200K token 时主动落盘外部 Memory 再续跑
- Worker 不把全量结果塞回 Orchestrator,而是把结构化产物写到 artifact store,只回传轻量引用
- 任务边界、输出格式、工具范围由 Orchestrator 在 spawn 时显式下发

### 5.3 Agent 模板与实例分离

```
agent_templates (模板级 - 可继承)
  id, name, description, capabilities, typical_prompts,
  company_id, created_by, status[active|retired]

agent_instances (实例级 - 具体会话)
  id, template_id, session_id, owner_user_id,
  created_at, terminated_at
```

Agent 替换/下线时:模板级保留,实例级归档;过程记忆按 (user, project) 重组;偏好记忆清空。

### 5.4 共享 Agent 偏好回灌模板

共享 Agent 学到的偏好,经审核后回灌到 `agent_templates`,所有用户受益。

```
agent_learning_candidates 表
  id, agent_template_id, learned_attribute,
  source_user_id, evidence,
  status[pending_review|approved|rejected],
  reviewed_by, reviewed_at
```

Agent 学到东西先进入候选,admin/老板审核通过后才回灌模板。

---

## 6. 个人账户两种来源与归属规则

### 6.1 两种来源

| 来源 | 账户所有权 | 记忆归属 | Agent 配置权 |
|---|---|---|---|
| 公司帮员工买 | 公司 | 全部归公司(即使下班用) | 公司配,员工不能改 |
| 员工自注册+公司充值 | 员工 | 看上下文:用公司 Agent 做公司项目=归公司;纯私人=归员工 | 公司 Agent 强制,私人 Agent 可选 |

**核心判定依据不是「谁付钱」,是「用谁的 Agent + 在哪个项目区」。**

- 公司买的账户:100% 归公司,即使员工下班做私事,记忆也是公司的
- 员工自注册+公司充值:账户本身归员工,但只要进了公司配置的 Agent 或公司项目区,这部分记忆归公司

### 6.2 四种工作场景

| 场景 | 账户来源 | 项目区 | Agent 团 | 记忆归属 |
|---|---|---|---|---|
| 公司账户做公司项目 | 公司买 | ✅ 建了 | 公司配 | 公司+项目+员工 |
| 公司账户下班私用 | 公司买 | ❌ 没有 | 员工自选 | 公司(全部归公司) |
| 个人账户+充值做项目 | 员工注册公司充值 | ✅ 建了 | 公司配(强制) | 公司+项目+员工 |
| 个人账户+充值做私事 | 员工注册公司充值 | ❌ 没有 | 员工自选 | 员工个人 |

### 6.3 归属判定逻辑(应用层强制)

```
function determineOwnership(workContext):
  if workContext.tool_source == 'company_purchased':
    return 'company'  // 公司账户全部归公司
  
  if workContext.project_id != null:
    // 进了项目区,必须用公司 Agent 团
    if workContext.agent_team_id != project_zone.agent_team_id:
      reject('项目区必须使用绑定的 Agent 专家团')
    return 'company'  // 项目区内归公司
  
  // 个人账户+无项目区+私人 Agent
  return 'personal'
```

---

## 7. 项目区 + Agent 专家团(硬约束)

### 7.1 项目区是协作的唯一入口

**硬约束:没有项目区 = 没有协作上下文 = 纯私人事务**

- 员工 A 想和员工 B 协作 → 必须先建项目区 → 把 B 拉进项目区 → 在项目区内的对话才有协作归属
- 项目区外的对话,即使两个员工同时在线,也只是各自的私人记忆,不构成协作
- 这避免「私下协作」「影子协作」无法追溯的问题

### 7.2 项目区数据模型

```
project_zones 表(项目区)
  id,
  company_id,           -- 属于哪家公司
  name,                 -- "客户A交付项目"
  created_by,           -- 创建者(通常是 PM 或老板)
  created_at,
  status[active|archived|closed],
  agent_team_id,        -- 绑定的 Agent 专家团(强制非空)
  visibility[team|company|confidential],
  billing_type[company_project|reimbursed_personal]
```

### 7.3 Agent 专家团

```
agent_teams 表(Agent 专家团)
  id,
  company_id,           -- 属于哪家公司
  name,                 -- "销售专家团" / "研发专家团"
  description,
  created_by,           -- 公司 admin 或老板
  created_at,
  status[active|retired]

agent_team_members 表(专家团由哪些 Agent 组成)
  id, team_id, agent_template_id, role[lead|specialist|worker]
```

### 7.4 强制规则

1. 公司项目区**必须绑定**一个 agent_team
2. 员工在项目区内**只能调用**该 team 里的 Agent
3. 员工的私人 Agent **不能进项目区**(防止私人 Agent 学到公司机密)
4. Agent 专家团由公司统一配置,员工不能自建团队加进项目区

---

## 8. 员工身份识别

### 8.1 方案组合:A 为主 + B 为合规底座 + D 为 UX 兜底

| 方案 | 机制 | 角色 |
|---|---|---|
| A. 会话级显式上下文(MCP) | 每次调用携带 user_id+session_id+project_id+agent_id 四元组 | 默认方案 |
| B. OAuth Token Exchange(RFC 8693) | 用户 token → 降权 agent_token,内嵌 act 声明 | 合规场景叠加 |
| D. 工作空间隐式识别(IM) | Slack channel/飞书群作为上下文边界 | IM 内嵌兜底 |

### 8.2 MCP 企业级管控

MCP server 配置由公司 IT 管理,员工不能自行修改 user_id/project_id。这直接解决了「客户端伪造 user_id」问题——身份路由的源头由企业管控。

```
mcp_config 表(企业级管控)
  id, company_id, config_payload,
  updated_by[admin|boss], updated_at,
  enforced_scopes[user_id|project_id|company_id]
```

MCP server 启动时从企业配置读取身份映射,不从客户端请求里拿。客户端只能传 session 级上下文(当前在做什么),传不了身份级字段(我是谁)。

### 8.3 老板意志委托上下文

意志下发时携带 `delegated_by` 链(类似 A2A 的 `on_behalf_of`),让下游 Agent 始终知道意志最初来自哪位老板。

---

## 9. 记忆归属模型

### 9.1 混合归属(关键决策)

单一归属必失信息,采用混合归属:

| 记忆类型 | 归属键 | 说明 |
|---|---|---|
| 人类员工动态画像 | `user_id` | 个人层,离职随人走 |
| Agent 角色/能力画像 | `agent_template_id` | 模板级,Agent 替换时可继承 |
| 偏好/交互习惯 | `user_id × agent_id` | 「A 喜欢让 X Agent 简短回答」 |
| 任务过程记忆 | `user_id × agent_id × project_id` | 三元组,最小完备键 |
| 团队/组织/老板意志 | `team_id` / `project_id` | 公司层 + 项目层 |
| 共享 Agent 的普遍经验 | `agent_template_id` + 标签 | 与个人偏好隔离,可全量回灌 |

### 9.2 跨员工协作记忆归属

**有共同项目区**:记忆同时归属 `user_A` + `user_B` + `project_zone_id` + `company_id`(四重归属)。

**无共同项目区**(纯私人对话):归企业层 `company_id` only(因为公司配发工具上的所有对话记忆属于公司)。

### 9.3 memories 表最终扩展

```
memories (最终扩展)
  + actor_user_id          -- 操作者(谁在打字)
  + participant_user_ids   -- 参与者(JSON 数组,跨员工协作时多人)
  + project_zone_id        -- 项目区(非空=协作场景)
  + company_id             -- 公司归属(公司账户或项目区内必填)
  + agent_team_id          -- 用的 Agent 专家团
  + ownership_type         -- company | personal
  + tool_source            -- company_purchased | personal_with_credit | personal_pure
  + library_id             -- 归属哪个库
  + scope                  -- 冗余字段,加速路由
  + visibility             -- private|project|company|public
  + valid_until            -- 记忆 TTL
  + confidence             -- 可信度
```

**强约束:**
- `project_zone_id` 非空 → `company_id` 必须非空
- `project_zone_id` 非空 → `agent_team_id` 必须等于项目区绑定的 team
- `tool_source=company_purchased` → `ownership_type=company`
- `participant_user_ids` 多人 → `project_zone_id` 必须非空(协作必须在项目区)

### 9.4 工作上下文

```
work_contexts 表(决定记忆归属的上下文)
  id,
  user_id,              -- 操作者
  company_id,           -- 所属公司(可空,纯私人=空)
  project_zone_id,      -- 当前项目区(可空,但空=纯私人,无协作)
  agent_team_id,        -- 使用的 Agent 专家团(可空,空=私人 Agent)
  tool_source,          -- company_purchased | personal_with_credit | personal_pure
  mcp_config_id,        -- MCP 配置(公司管控)
  session_id,
  started_at, ended_at
```

每次 Agent 调用时,系统先解析 work_context(从 MCP 配置 + 项目邀请关系推导),记忆写入时自动打上对应归属。

### 9.5 个人账户接入企业项目流程

1. 公司项目区 admin 邀请张三(发邀请链接)
2. 张三在个人账户里接受邀请
3. 系统创建 `project_members` 记录:`project_zone_id + 张三 + role=collaborator + invited_by`
4. 张三在项目区上下文下的所有对话,自动归 `company + project_zone + 张三`
5. 张三退出项目区时,项目记忆留下,张三个人部分导出

---

## 10. 离职/转岗/Agent 替换治理

### 10.1 完整生命周期

| 阶段 | 记忆处理 |
|---|---|
| 在职(active) | 三元组归属,正常读写 |
| 请假(suspended) | 个人记忆冻结只读,Agent 实例停摆,恢复后续跑 |
| 转岗(transferred) | 个人画像随人走;旧项目过程记忆留在原项目层,归属改 project_zone_id only,user_id 脱敏 |
| 离职(offboarded) | 个人画像按 GDPR 可携带权导出给本人;项目记忆转移给接手人;共享 Agent 普遍经验经审核后保留 |
| Agent 替换(agent_retired) | 旧 Agent 结构化画像导出为 Agent Card;过程记忆按 (user, project) 重组;偏好记忆清空 |
| 全量归档(archived) | 超保留期冷存储,仅合规审计可读 |

### 10.2 审计

每步都产生 `memory_transition_event` 审计记录(who/what/when/why/destination)。

### 10.3 users 表扩展

```
users 表补 user_status: active|suspended|transferred|offboarded|archived
```

---

## 11. evidence ACL 规则

A + B 组合:

| 查询场景 | 普通员工 | exec/PM | boss | admin |
|---|---|---|---|---|
| 自己 user 主体的 evidence | ✅ | ✅ | ✅ | ✅ |
| 他人 user 主体的 evidence | ❌ | ✅ | ✅ | ✅ |
| org 主体的 evidence | ❌ | ✅ | ✅ | ✅ |
| project 主体的 evidence | ❌ | ✅(仅负责项目) | ✅ | ✅ |
| source_writer_role=boss 的 evidence | ❌ | ❌ | ✅(本人) | ✅ |

核心原则:员工对自己的画像完全透明(可看可申诉),但无法反推组织和他人。老板来源的 evidence 是最高敏感级。

---

## 12. LLM Provider 双通道

### 12.1 算力拓扑

```
远程大模型(Claude/GPT)
  · Agent 对话
  · 复杂推理

KeyMemory 主服务(SQLite + REST/MCP)
  · 记忆 CRUD
  · 检索路由
  · Loop Harness

NAS 本地小模型(ollama)  ← 预留接口,有 NAS 时启用
  · 属性抽取 + 归一化(双阶段)
  · Embedding 生成
  · SelfCheck 评分
  · 知识库 ingestion
  · 梦境整理
```

### 12.2 配置驱动

```
KEYMEMORY_LLM_PROVIDER=auto  # auto | local | cloud
KEYMEMORY_LLM_BASE_URL=http://localhost:11434/v1  # ollama 或 OpenAI 兼容
KEYMEMORY_LLM_API_KEY=sk-xxx  # 云端 key,本地可留空
KEYMEMORY_LLM_MODEL=qwen3-4b
KEYMEMORY_EMBED_MODEL=bge-small-zh
```

`provider=auto` 时:启动探测 ollama 端口 → 通则用本地,不通则用云端 key。用户无感切换。

### 12.3 LLMProvider 抽象层

```
packages/server/src/core/llm-provider.ts
  class LLMProvider {
    detect(): 'local' | 'cloud'
    extractAttributes(memory, writerContext): Promise<ExtractResult>
    normalizeAttributeName(rawName): Promise<NormalizedName>
    selfCheckScore(memory, projectContext): Promise<Score>
    embed(text): Promise<number[]>
    judgeConflict(attrA, attrB): Promise<ConflictResult>
  }
```

---

## 13. 意志传导可视化(MVP 差异化卖点)

### 13.1 老板视角:指挥台

- 节点 = 画像属性(归一化名 + 当前值)
- 边 = persona_relations(drives/aligns_with/conflicts_with)
- 冲突边红色高亮,让老板立刻看到「哪里不对齐」
- 点击节点 → 下钻 evidence(老板/admin 可见)
- 时间轴滑块 → 回放传导链路演化

### 13.2 员工视角:对齐台

- 员工看到「公司方向 → 我的任务」的传导链,但看不到是老板个人的意思
- 公司画像只显示归一化属性 + 时间
- 自己的画像完全透明,可申诉

### 13.3 技术实现

- 后端:`persona_graph_get(subject_id, depth)` 图遍历 API + `persona_timeline_get(attribute_id)` 时间序列
- 前端:复用现有 NebulaGraph.tsx 做图渲染,新增「指挥台」「对齐台」两个视图组件,时间轴用 Timeline.tsx 改造

---

## 14. 数据模型总览(完整 schema)

### 14.1 新增表

```sql
-- 用户与组织
users (id, name, email, role[boss|exec|pm|member|admin],
       is_main_account, user_status, company_id, created_at)

companies (id, name, created_at)

-- 记忆库
libraries (id, name, scope[personal|project|company|external],
           owner_user_id, project_zone_id, source, db_path,
           access_policy, created_at)

-- 项目区与 Agent 团
project_zones (id, company_id, name, created_by, created_at,
               status, agent_team_id, visibility, billing_type)

project_members (project_zone_id, user_id, role[owner|editor|viewer],
                 invited_by, joined_at)

agent_teams (id, company_id, name, description, created_by,
             created_at, status)

agent_team_members (id, team_id, agent_template_id, role[lead|specialist|worker])

agent_templates (id, name, description, capabilities, typical_prompts,
                 company_id, created_by, status[active|retired])

agent_instances (id, template_id, session_id, owner_user_id,
                 created_at, terminated_at)

agent_learning_candidates (id, agent_template_id, learned_attribute,
                           source_user_id, evidence,
                           status[pending_review|approved|rejected],
                           reviewed_by, reviewed_at)

-- 画像
persona_attributes (id, scope, subject_id, attribute_name,
                    value_text, value_struct, value_vector,
                    confidence, valid_from, valid_until, superseded_by,
                    visibility, impact_scope, override_priority, captured_at)

persona_evidence (id, attribute_id, source_writer_id, source_writer_role,
                  source_type, source_memory_id, captured_at)

persona_relations (id, source_attr_id, target_attr_id,
                   relation_type, strength, reason, captured_at)

persona_promotions (id, source_user_id, source_attr_name,
                    target_org_attr_id, promoted_by, promoted_at, reason)

persona_disputes (id, attribute_id, disputed_by, reason,
                  status, resolved_by, resolution, created_at)

persona_triggers (writer_role, trigger_mode, attribute_scope)

-- 工作上下文与权限
work_contexts (id, user_id, company_id, project_zone_id,
               agent_team_id, tool_source, mcp_config_id,
               session_id, started_at, ended_at)

memory_acl (id, memory_id, user_id, project_zone_id, agent_id,
            permission[read|write|admin])

memory_transitions (id, event_type, memory_id, actor_user_id,
                    from_owner, to_owner, reason, timestamp)

mcp_config (id, company_id, config_payload, updated_by,
            updated_at, enforced_scopes)
```

### 14.2 现有表扩展

```sql
memories (+)
  actor_user_id, participant_user_ids, project_zone_id, company_id,
  agent_team_id, ownership_type, tool_source,
  library_id, scope, visibility, valid_until, confidence

loop_runs (+)
  assigned_user_id, visibility[private|team|company]
```

---

## 15. 改造步骤

### Step 1:数据模型落地
- 新建 migration 加所有新表
- 扩展 memories / loop_runs 字段
- 配置文件加 boss_user_id

### Step 2:LLMProvider 抽象层
- 新建 `llm-provider.ts`,实现 detect + 双通道
- 把现有 onnx.ts embedding 接入
- 抽取/归一化/SelfCheck 接口定义

### Step 3:画像抽取与传导核心
- 双阶段抽取 pipeline
- 老板实时触发钩子
- persona_relations 自动建关系
- evidence ACL 实现

### Step 4:意志传导可视化
- 后端图遍历 API
- 前端指挥台 + 对齐台
- 时间轴回放

### Step 5:双视角与权限
- 老板/员工视角切换
- evidence 下钻与 ACL 校验
- 项目区 + Agent 专家团强制约束

---

## 16. MVP 范围

### MVP 必做(Phase 1)

| 模块 | 内容 | 优先级 |
|---|---|---|
| 用户与权限 | users + role + 主账户=boss | P0 |
| 记忆库分层 | libraries + 四层 scope | P0 |
| 画像属性表 | persona_attributes + evidence + relations | P0 |
| 双阶段抽取 | LLMProvider 抽象 + 本地/云端双通道 | P0 |
| 老板实时触发 | writer_role=boss 实时抽取 + 脱敏归一 | P0 |
| 意志传导关系 | persona_relations + 自动建关系 | P0 |
| 传导可视化 | 前端图视图 | P0 |
| 双视角 UI | 老板指挥台 + 员工对齐台 | P0 |
| evidence ACL | A+B 组合规则 | P0 |
| 项目区 + Agent 专家团 | 硬约束落地 | P0 |

### MVP 后(Phase 2)

| 模块 | 内容 |
|---|---|
| 属性申诉流程 | persona_disputes 完整闭环 |
| 老板主动提升 | persona_promotions UI |
| 周期聚合 | 普通员工画像的周级聚合 |
| 离线同步 | 本地+NAS 双向同步 |
| 第三方库 ingestion | Notion/飞书/Confluence connector |
| 共享 Agent 偏好回灌 | agent_learning_candidates 审核闭环 |
| 离职/转岗治理 | memory_transitions 完整生命周期 |

### NAS 专属(Phase 3)

| 模块 | 内容 |
|---|---|
| ollama 集成 | 本地小模型通道激活 |
| 加密独立库 | 老板 personal 库升级 |
| NAS 部署 | Docker/systemd 常驻 |

---

## 17. 未解决问题与后续决策点

1. **跨员工 Agent 协作的记忆归属**:已决策为双方+project+企业层,待实施时验证
2. **共享 Agent 学到的偏好是否回灌模板**:已决策为经审核后回灌,审核流程待细化
3. **老板意志与员工个人偏好的冲突仲裁**:已决策为看影响范围,impact_scope 字段已加
4. **MCP 身份传递的安全性**:已决策为公司管控 MCP 配置,员工不能改 user_id
5. **NAS 硬件配置**:待用户确认 NAS 设备后定小模型选型
6. **行为指纹(方案 E)的合规边界**:EU AI Act 与个保法下,推断式身份识别可能需单独告知同意
7. **长时序记忆的事实失效**:是否需要全量上时序图谱,投入产出比未论证
8. **Agent 间「提醒」机制**:一个 Agent 发现重要信息如何主动 push 给其他 Agent,目前开源框架均为被动 handoff
9. **跨企业协作**:不同公司的员工通过个人账户协作的记忆归属,本期不处理

---

## 18. 参考资料

### 调研来源
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system)
- [Microsoft 2025 Work Trend Index — The Frontier Firm](https://www.microsoft.com/en-us/microsoft-365/blog/?p=276582)
- [Zep: Temporal Knowledge Graph (arXiv 2501.13956)](https://arxiv.org/abs/2501.13956)
- [Mem0 Memory Types](https://docs.mem0.ai/core-concepts/memory-types)
- [Letta Memory Blocks](https://github.com/letta-ai/letta)
- [CrewAI Memory System](https://github.com/crewAIInc/crewAI)
- [MCP Protocol](https://modelcontextprotocol.io/introduction)
- [Google A2A Protocol](https://github.com/google-a2a/a2a)
- [OAuth 2.0 Token Exchange (RFC 8693)](https://datatracker.ietf.org/doc/html/rfc8693)

### KeyMemory 现有代码
- [packages/server/src/core/isolation-rules.ts](file:///c:/Users/zexin/Desktop/KeyMemory/packages/server/src/core/isolation-rules.ts) - 现有隔离规则
- [packages/server/src/core/project.ts](file:///c:/Users/zexin/Desktop/KeyMemory/packages/server/src/core/project.ts) - 项目模型
- [packages/server/src/core/loop-harness.ts](file:///c:/Users/zexin/Desktop/KeyMemory/packages/server/src/core/loop-harness.ts) - Loop 任务
- [packages/server/src/core/auto.ts](file:///c:/Users/zexin/Desktop/KeyMemory/packages/server/src/core/auto.ts) - SelfCheck 与自动记忆
- [packages/server/src/db/sqlite.ts](file:///c:/Users/zexin/Desktop/KeyMemory/packages/server/src/db/sqlite.ts) - 数据库
- [packages/server/src/embed/onnx.ts](file:///c:/Users/zexin/Desktop/KeyMemory/packages/server/src/embed/onnx.ts) - 本地 embedding
- [packages/web/src/components/NebulaGraph.tsx](file:///c:/Users/zexin/Desktop/KeyMemory/packages/web/src/components/NebulaGraph.tsx) - 图可视化
- [packages/web/src/components/Timeline.tsx](file:///c:/Users/zexin/Desktop/KeyMemory/packages/web/src/components/Timeline.tsx) - 时间轴

---

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-07-02 | v0.1 | 初始设计,基于两轮调研和多轮讨论收敛 |
