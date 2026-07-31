import { createInterface } from 'node:readline';

const NO_TTY_MESSAGE = '该命令需要在交互终端中运行，以便安全输入账号和密码';

function assertTty(): void {
  if (!process.stdin.isTTY) throw new Error(NO_TTY_MESSAGE);
}

/** 普通文本输入：用于账号标识，不属于秘密，但同样不写入命令参数。 */
export function readText(prompt: string): Promise<string> {
  assertTty();
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('输入已取消'));
    });
  });
}

/** 密码输入不回显，沿用运营账号初始化工具的本地安全输入方式。 */
export function readSecret(prompt: string): Promise<string> {
  assertTty();
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write(prompt);
    let secret = '';

    const cleanup = (error?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (error !== undefined) reject(error);
      else resolve(secret);
    };

    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          cleanup();
          return;
        }
        if (char === '\u0003') {
          cleanup(new Error('密码输入已取消'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          secret = secret.slice(0, -1);
          continue;
        }
        secret += char;
      }
    };

    stdin.on('data', onData);
  });
}
