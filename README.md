# JourneyLens

JourneyLens 是面向运营团队的营销自动化平台、支持 AI 辅助编排的客户旅程。运营人员可用自然语言描述营销需求，由 AI 辅助梳理条件并生成旅程草稿，也可通过可视化画布配置。平台支持活动排期、圈选人群、旅程模拟、执行追踪和监控统计等功能。

## 技术栈

- **前端**：React + Vite + antd + React Router + TanStack Query + Zustand，流程画布使用 React Flow
- **后端**：Fastify + Prisma + PostgreSQL + Zod + Redis + BullMQ

## 启动方法

前置要求：Node.js ≥ 24.18、pnpm 10、Docker。

```bash
# 1. 安装依赖
pnpm install

# 2. 在根目录创建 .env（不纳入版本控制），填入两个变量：
#    POSTGRES_PASSWORD=<自定义本地密码>
#    DATABASE_URL=<自定义数据库地址>

# 3. 启动本地 PostgreSQL
pnpm db:up

# 4. 应用数据库迁移
pnpm db:migrate

# 5. 创建运营账号（输入邮箱、显示名与密码）
pnpm operator:create

# 6. 初始化 2,000 名演示受众（固定种子生成，重复执行结果一致）
pnpm seed:audience

# 7. 启动 API 与前端开发服务
pnpm dev
```

启动后浏览器访问 <http://localhost:5173>；API 运行在 `http://localhost:3001`。
