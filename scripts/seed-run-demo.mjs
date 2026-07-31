import { spawnSync } from 'node:child_process';

const build = spawnSync('pnpm', ['--filter', '@journeylens/server', 'run', 'build'], {
  stdio: 'inherit',
});

if (build.error) {
  console.error(`seed:run-demo 构建无法启动：${build.error.message}`);
  process.exitCode = 1;
} else if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const cli = spawnSync(
    process.execPath,
    ['--env-file-if-exists=.env', 'apps/server/dist-tools/tools/cli/seed-run-demo.js'],
    { stdio: 'inherit' },
  );
  if (cli.error) {
    console.error(`seed:run-demo CLI 无法启动：${cli.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = cli.status ?? 1;
  }
}
