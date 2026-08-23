# JourneyLens

JourneyLens 是面向运营团队的客户旅程营销自动化平台。

平台提供人群圈选、可视化旅程编排、模拟验证、版本发布与执行追踪，覆盖营销旅程从搭建、上线到运行观察的完整过程。

AI 生成旅程把自然语言描述的需求转成可编辑的旅程初稿，减少手工拖拽的工作量。

旅程上线前，可根据设定的用户资料和行为时间线预演分支走向与消息内容；

执行追踪以用户为单位记录节点经过、分支选择和等待结果，可按执行明细逐条回看。

[在线体验](https://journeylens.coglow.top)：https://journeylens.coglow.top

## 项目预览

**运营概览**

<a href="docs/screenshots/operations-overview.png"><img src="docs/screenshots/operations-overview.png" width="680" alt="运营概览中的近 7 天指标、近期活动与活动状态分布"></a>

|                                                                                                                                                                                           |                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **人群圈选**<br/><a href="docs/screenshots/audience-segmentation.png"><img src="docs/screenshots/audience-segmentation.png" width="400" alt="人群圈选中的嵌套条件、排除组与人数预估"></a> | **可视化旅程编排**<br/><a href="docs/screenshots/journey-editor.png"><img src="docs/screenshots/journey-editor.png" width="400" alt="旅程编排画布与节点配置面板"></a>       |
| **活动运行概览**<br/><a href="docs/screenshots/campaign-overview.png"><img src="docs/screenshots/campaign-overview.png" width="400" alt="活动运行概览与执行状态统计"></a>                 | **执行过程追踪**<br/><a href="docs/screenshots/execution-detail.png"><img src="docs/screenshots/execution-detail.png" width="400" alt="执行详情中的节点路径与步骤结果"></a> |

## 功能架构

```mermaid
---
config:
  flowchart:
    subGraphTitleMargin:
      top: 10
      bottom: 6
---
flowchart TB
  subgraph setup["搭建与上线"]
    direction LR
    A["活动管理<br/>新建 / 启动 / 暂停 / 恢复 / 结束"]
    S["人群圈选<br/>制定规则 · 预估人数"]
    J["旅程编排<br/>画布编排 · AI 起草 · 旅程模拟"]
    V["发布版本<br/>固定流程与入口分群规则"]
    A -->|创建旅程| J
    S -.->|可选入口人群| J
    J --> V
  end

  subgraph run["旅程运行"]
    direction LR
    E["接收用户行为"]
    M["匹配入口"]
    X["分支 · 等待 · 消息触达<br/>达成活动目标可提前退出"]
    E --> M
    M -->|符合条件时进入| X
  end

  subgraph observe["运行观察"]
    direction LR
    B["行为记录"]
    D["执行记录"]
    O["活动、旅程统计"]
    B --- D
    D --- O
  end

  setup -->|按发布版本匹配| run
  run -->|查看行为与执行结果| observe
  %% B --- D 和 D --- O 仅用于横排，连线编号从 0 开始。
  linkStyle 5,6 stroke:transparent
```

活动进行中，系统按最新发布版本的入口规则匹配用户行为，已经进入的用户继续按进入时发布的版本运行。

接收成功的行为都可在行为记录中查看。

进入旅程后，可在执行详情回看经过的步骤和结果，也可按发布版本查看汇总统计。

## 关键实现

### 圈选规则与人数预估

圈选条件以“全部满足、任一满足、排除”的规则树保存。

共享字段目录限定各属性可用的比较方式与取值，前后端复用同一套规则校验。

编辑器会标出能识别的条件冲突。如果一组条件明确互相矛盾、不可能命中任何用户，服务端直接拒绝保存。

人数预估和旅程入口判断共用**同一份递归求值逻辑**，保持条件判断口径一致。

相关实现：规则定义与校验 [`segment-rule.ts`](packages/shared/src/segments/segment-rule.ts)、预估请求 [`useSegmentPreview.ts`](apps/web/src/features/segments/hooks/useSegmentPreview.ts)、服务端求值 [`rule-evaluator.ts`](apps/server/src/modules/segments/rule-evaluator.ts)、分群服务 [`segments/service.ts`](apps/server/src/modules/segments/service.ts)。

### 可视化编排与流程检查

画布基于 React Flow，以节点和连线表示旅程步骤与分支。

新增连线时复用**共享的图结构校验**，检查循环连接、重复连接和分支出口数量。

自动排列使用 Dagre 计算横向或纵向布局，再将双分支各自独有的后续节点调整到两侧，保留公共汇合节点的位置。

编辑器自动排列与 AI 候选预览**共用同一套布局计算**，版本页直接渲染发布时保存的坐标。

每个操作记录一个撤销点，一次拖动只记一次。

复制粘贴会重建节点和连线标识，保留所选节点之间的连接。

撤销、重做恢复的是画布结构和布局，节点配置保留最新值，不进入历史。

相关实现：画布状态与撤销 [`useJourneyCanvas.ts`](apps/web/src/features/journeys/hooks/useJourneyCanvas.ts)、草稿结构与流程校验 [`journey-draft.ts`](packages/shared/src/journeys/journey-draft.ts)、布局计算 [`journey-layout.ts`](apps/web/src/features/journeys/journey-layout.ts)。

### AI 起草与流程校验

起草时先选定进入旅程的用户行为，再描述营销需求。

服务端把可用的节点、字段和规则提供给模型。

关键信息不足时返回补充问题。信息足够时，生成的方案要经过**结构、流程完整性和入口行为一致性检查**。

运营人员预览并确认后，方案才会应用到画布，之后的编辑、保存和发布沿用同一套旅程规则。

相关实现：起草服务 [`ai-draft-service.ts`](apps/server/src/modules/journeys/ai-draft-service.ts)、方案结构校验 [`ai-draft-output.ts`](apps/server/src/modules/journeys/ai-draft-output.ts)。

### 草稿编辑与发布版本

草稿自动保存与手动保存走同一套保存流程，用**修订号**识别并发修改。

发布时把旅程内容和当时的入口分群一起存成快照版本，执行记录指向具体快照版本。

之后改草稿或改分群，已经跑过的执行仍按发布时的内容计算。

相关实现：自动保存 [`useJourneyDraftPersistence.ts`](apps/web/src/features/journeys/hooks/useJourneyDraftPersistence.ts)、发布版本 [`version-service.ts`](apps/server/src/modules/journeys/version-service.ts)。

### 行为驱动与持久化执行

行为保存与旅程执行创建在**同一事务**内完成。

同一行为标识和相同内容的重复提交返回原结果，不会重复创建执行。

后台的推进循环从数据库里读取运行中或等待中的执行，按节点规则继续往下推进并记录步骤。

等待中的步骤连截止时间一起存在数据库里，服务重启后会接着处理没跑完的执行。

相关实现：行为接收与去重 [`events/service.ts`](apps/server/src/modules/events/service.ts)、推进循环 [`runner.ts`](apps/server/src/modules/executions/runner.ts)、运行调度 [`scheduler.ts`](apps/server/src/modules/executions/scheduler.ts)。

## 技术架构

项目采用 pnpm workspace 管理前端、服务端和共享包。前后端共用请求与响应定义、字段目录和业务校验规则，业务实现按模块组织。

| 层次       | 技术                                                      |
| ---------- | --------------------------------------------------------- |
| 前端       | React 19、TypeScript、Vite、Ant Design 6、CSS Modules     |
| 路由与请求 | React Router、TanStack Query、Axios                       |
| 流程画布   | React Flow、Dagre                                         |
| 服务端     | Node.js 24、Fastify 5、Prisma 6                           |
| 数据与校验 | PostgreSQL 16、Zod 4                                      |
| AI 起草    | DeepSeek，使用 OpenAI 兼容协议调用                        |
| 验证与规范 | Vitest、Testing Library、Testcontainers、ESLint、Prettier |

```mermaid
flowchart LR
    Web[运营工作台<br/>React · antd · React Flow]
    Shared[共享定义与校验规则<br/>packages/shared]
    Model[模型服务<br/>AI 辅助起草]
    DB[(PostgreSQL)]

    subgraph Server[服务端 · 同一进程]
        API[业务服务<br/>Fastify]
        Runner[旅程推进循环]
    end

    Web -->|业务请求| API
    Web -.->|复用| Shared
    API -.->|复用| Shared
    API -->|经 Prisma| DB
    Runner -->|经 Prisma 读取状态与记录步骤| DB
    API -->|生成旅程方案| Model
```

## 本地运行

### 环境要求

- Node.js `>=24.18.0 <25`。
- pnpm `10.13.1`。
- Docker 与 Docker Compose，用于运行 PostgreSQL。

以下命令均在仓库根目录执行。

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

在根目录创建 `.env`，将两处 `replace_with_your_local_password` 替换为同一个本地数据库密码：

```dotenv
POSTGRES_PASSWORD=replace_with_your_local_password
DATABASE_URL=postgresql://journeylens_dev:replace_with_your_local_password@127.0.0.1:5433/journeylens_dev?schema=public
```

数据库名称、用户名和端口与 [`compose.yaml`](compose.yaml) 一致。密码包含特殊字符时，连接地址中的密码部分需要进行 URL 编码。`.env` 已被版本控制忽略。

启用 AI 起草时，在同一文件中增加以下配置，密钥填写为自己的服务端密钥：

```dotenv
AI_DRAFT_API_KEY=replace_with_your_api_key
```

| 变量                | 用途                                     | 默认值                     |
| ------------------- | ---------------------------------------- | -------------------------- |
| `AI_DRAFT_API_KEY`  | 启用 AI 起草的模型服务密钥，由服务端读取 | —                          |
| `AI_DRAFT_MODEL`    | 模型名称                                 | `deepseek-v4-flash`        |
| `AI_DRAFT_BASE_URL` | 模型服务地址                             | `https://api.deepseek.com` |
| `PORT`              | 后端监听端口                             | `3001`                     |

修改 AI 配置后重新启动后端。前端开发代理连接后端的 `3001` 端口，变更后端端口时同步调整 [`vite.config.ts`](apps/web/vite.config.ts)。

### 3. 初始化数据库

```bash
pnpm db:up
pnpm db:migrate
```

### 4. 创建运营账号与初始化受众

通过参数指定邮箱和显示名，密码在终端中按提示输入：

```bash
pnpm operator:create --email operator@example.com --display-name "运营人员"
pnpm seed:audience
```

受众初始化命令按固定种子生成 2,000 名样本用户，包含会员等级、城市、消费、活跃和偏好等属性。重复运行会重新生成这批受众，并清理这些用户关联的行为与执行记录。

### 5. 启动服务

```bash
pnpm dev
```

| 入口         | 地址                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| 运营工作台   | [http://localhost:5173](http://localhost:5173)                         |
| 后端服务地址 | `http://localhost:3001`                                                |
| 服务存活检查 | [http://localhost:3001/health/live](http://localhost:3001/health/live) |

使用刚创建的运营账号登录。后端在启动时构建代码。修改后端代码后，需要重新启动后端服务。

## 体验流程

1. **圈选人群**：进入分群页面，按会员等级、城市、活跃情况等属性组合规则，预估匹配人数与占比，保存分群。
2. **创建活动与旅程**：创建活动，设置目标行为，在活动中创建旅程并关联入口分群。
3. **编排流程**：选择进入旅程的行为，添加条件、等待、消息和结束节点并连接分支。也可以通过 AI 起草生成初始方案，再在画布中调整。
4. **模拟验证**：填写模拟用户资料，点击模拟，检查分支、等待结果和消息内容。
5. **发布与启动**：保存草稿并发布版本，回到活动启动运行。
6. **观察运行**：接收符合入口条件的用户行为后，在活动运行概览、行为记录和执行记录中查看运行结果，进入执行详情检查节点路径与目标达成情况。

<details>
<summary>提交一条浏览商品行为，观察完整执行</summary>

新建一条不限入口人群的旅程，将开始行为设为“浏览商品”，连接消息和结束节点，填写消息内容，发布并启动所属活动。在另一个终端执行以下命令，准备一名样本用户并提交浏览行为：

```bash
cat > /tmp/journeylens-users.json <<'JSON'
[
  {
    "externalId": "readme-user-001",
    "displayName": "小林",
    "attributes": {
      "vipLevel": "gold",
      "city": "上海"
    }
  }
]
JSON

pnpm upstream:user --file /tmp/journeylens-users.json

cat > /tmp/journeylens-product-viewed.json <<'JSON'
{
  "audienceExternalId": "readme-user-001",
  "events": [
    {
      "type": "product_viewed",
      "payload": {
        "productId": "product-001",
        "productName": "无线耳机",
        "price": 299
      }
    }
  ]
}
JSON

pnpm upstream:event --file /tmp/journeylens-product-viewed.json
```

按终端提示输入运营账号邮箱与密码。

命令接收行为后输出执行详情地址，打开即可查看从开始、消息到结束的节点记录。每次运行会为行为生成新的标识。

</details>

自定义用户资料可通过 `pnpm upstream:user --file <用户样本文件>` 创建或更新。

用户标识与行为样本中的 `audienceExternalId` 对应。

工具入口见 [`upstream-user.ts`](apps/server/tools/cli/upstream-user.ts) 与 [`upstream-event.ts`](apps/server/tools/cli/upstream-event.ts)。

## 项目结构

```text
journeylens/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/          # 应用入口、全局 Provider 与路由
│   │       ├── features/     # 业务页面、业务组件与交互逻辑
│   │       ├── components/   # 跨模块公共组件
│   │       ├── hooks/        # 跨模块复用的 Hook
│   │       ├── services/     # 前端请求与错误转换
│   │       └── utils/        # 日期、字段与表格工具
│   └── server/
│       ├── src/
│       │   ├── modules/      # 各业务模块：接口、服务与领域规则
│       │   ├── plugins/      # 公共插件
│       │   ├── db/           # 数据库连接
│       │   ├── api-tests/    # 接口测试
│       │   └── test-support/ # 测试环境与数据构造
│       ├── prisma/           # 数据结构与迁移
│       └── tools/cli/        # 账号、受众与行为工具
├── packages/
│   └── shared/
│       └── src/
│           ├── audience/     # 受众字段目录
│           ├── dto/          # 请求与响应定义
│           ├── journeys/     # 旅程草稿与流程校验
│           └── segments/     # 分群规则与校验
├── docs/
│   └── screenshots/          # 界面截图
├── scripts/                  # 本地开发命令入口
└── compose.yaml              # 本地 PostgreSQL 配置
```

## 开发命令

| 命令                | 用途                        |
| ------------------- | --------------------------- |
| `pnpm dev`          | 构建共享包并启动前后端      |
| `pnpm dev:web`      | 构建共享包并启动前端        |
| `pnpm dev:server`   | 构建并启动后端              |
| `pnpm typecheck`    | 类型检查                    |
| `pnpm test`         | 运行前后端测试，需要 Docker |
| `pnpm build`        | 构建前端与后端              |
| `pnpm lint`         | 代码规范检查                |
| `pnpm format:check` | 全仓库格式检查              |

## 版权说明

本仓库代码仅用于展示，未授予任何复制、修改或分发许可。
