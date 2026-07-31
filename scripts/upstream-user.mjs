import { spawnSync } from 'node:child_process';

const build = spawnSync('pnpm', ['--filter', '@journeylens/server', 'run', 'build'], {
  stdio: 'inherit',
});

if (build.error) {
  console.error(`upstream:user 构建无法启动：${build.error.message}`);
  process.exitCode = 1;
} else if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const cli = spawnSync(
    process.execPath,
    ['--env-file-if-exists=.env', 'apps/server/dist-tools/tools/cli/upstream-user.js', ...args],
    { stdio: 'inherit' },
  );
  if (cli.error) {
    console.error(`upstream:user CLI 无法启动：${cli.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = cli.status ?? 1;
  }
}
