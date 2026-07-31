import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
// pnpm 会把分隔符 `--` 一并传入；账号工具只接受 --email 和 --display-name。
if (args[0] === '--') args.shift();
const build = spawnSync('pnpm', ['--filter', '@journeylens/server', 'run', 'build'], {
  stdio: 'inherit',
});

if (build.error) {
  console.error(`operator:create 构建无法启动：${build.error.message}`);
  process.exitCode = 1;
} else if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const cli = spawnSync(
    process.execPath,
    ['--env-file-if-exists=.env', 'apps/server/dist-tools/tools/cli/main.js', ...args],
    { stdio: 'inherit' },
  );
  if (cli.error) {
    console.error(`operator:create CLI 无法启动：${cli.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = cli.status ?? 1;
  }
}
