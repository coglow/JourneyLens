import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = {
  host: '127.0.0.1',
  port: '5433',
  database: 'journeylens_dev',
  user: 'journeylens_dev',
  schema: 'public',
  composeProject: 'journeylens_dev',
  composeService: 'postgres',
};
const composeFile = fileURLToPath(new URL('../compose.yaml', import.meta.url));

function fail(message) {
  console.error(`[db:rebuild] ${message}`);
  process.exit(1);
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? 'Docker 命令失败');
  }
  return result.stdout.trim();
}

function compose(args) {
  return docker([
    'compose',
    '--project-name',
    target.composeProject,
    '--file',
    composeFile,
    ...args,
  ]);
}

function verifyDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (value === undefined || value.trim() === '') {
    fail('DATABASE_URL 未设置，请检查根目录 .env；未执行任何清库操作。');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    fail('DATABASE_URL 格式无效；未执行任何清库操作。');
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== target.host ||
    url.port !== target.port ||
    decodeURIComponent(url.pathname.slice(1)) !== target.database ||
    decodeURIComponent(url.username) !== target.user ||
    url.searchParams.get('schema') !== target.schema
  ) {
    fail(
      `拒绝重建：仅允许本项目 ${target.database} 数据库（${target.host}:${target.port}/${target.database}?schema=${target.schema}）。连接串内容未显示。`,
    );
  }
}

function verifyComposeTarget() {
  const containers = compose(['ps', '--quiet', target.composeService]).split('\n').filter(Boolean);
  if (containers.length !== 1) {
    fail('本项目 PostgreSQL Compose 服务未唯一运行；未执行任何清库操作。');
  }

  const labels = docker([
    'inspect',
    '--format',
    '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}',
    containers[0],
  ]);
  if (labels !== `${target.composeProject}|${target.composeService}`) {
    fail('运行中的 PostgreSQL 容器不属于本项目 Compose 服务；未执行任何清库操作。');
  }

  const publishedPorts = compose(['port', target.composeService, '5432'])
    .split('\n')
    .filter(Boolean);
  const matchesTarget = publishedPorts.some((value) => {
    const separator = value.lastIndexOf(':');
    return value.slice(0, separator) === target.host && value.slice(separator + 1) === target.port;
  });
  if (!matchesTarget) {
    fail('本项目 PostgreSQL 服务未绑定 DATABASE_URL 指定的本地地址；未执行任何清库操作。');
  }

  const identity = compose([
    'exec',
    '-T',
    target.composeService,
    'psql',
    '-U',
    target.user,
    '-d',
    target.database,
    '-Atqc',
    "SELECT current_database() || '|' || current_user || '|' || (SELECT count(*)::text FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid())",
  ]);
  if (identity !== `${target.database}|${target.user}|0`) {
    fail('Compose 服务中的数据库身份或连接状态与已确认目标不符；未执行清库。');
  }
}

try {
  verifyDatabaseUrl();
  verifyComposeTarget();
} catch (error) {
  fail(`目标核对失败：${error instanceof Error ? error.message : '未知错误'}；未执行清库。`);
}

console.log(
  `[db:rebuild] 已确认仅重建 ${target.host}:${target.port}/${target.database} 的 public schema。`,
);
const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@journeylens/server',
    'exec',
    'prisma',
    'migrate',
    'reset',
    '--force',
    '--skip-seed',
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  fail(`Prisma 重建命令无法启动：${result.error.message}`);
}
process.exitCode = result.status ?? 1;
