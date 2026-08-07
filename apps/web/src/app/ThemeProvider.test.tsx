import html from '../../index.html?raw';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ThemeProvider, useColorMode } from './ThemeProvider';

function Controls() {
  const { mode, switching, toggleMode } = useColorMode();
  return (
    <>
      <ThemeToggle mode={mode} switching={switching} onToggle={toggleMode} />
      <input aria-label="草稿" defaultValue="待保存内容" />
    </>
  );
}
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
function mount() {
  // 执行真实的头部初始化代码，验证保存值进入 React 的完整衔接。
  new Function('document', 'localStorage', bootstrap)(document, localStorage);
  return render(
    <ThemeProvider>
      <Controls />
    </ThemeProvider>,
  );
}
beforeEach(() => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.append(meta);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'startViewTransition');
  localStorage.removeItem('journeylens-color-mode');
  delete document.documentElement.dataset.colorMode;
  document.documentElement.style.removeProperty('background-color');
  document.querySelector('meta[name="theme-color"]')?.remove();
});
describe('主题与浏览器过渡', () => {
  it('缺少 Provider 时暴露装配错误', () => {
    expect(() => renderHook(() => useColorMode())).toThrow(
      'useColorMode 必须在 ThemeProvider 内使用',
    );
  });
  it.each([null, 'unknown', 'light', 'dark'])('从保存值 %s 恢复正确模式', (stored) => {
    if (stored !== null) localStorage.setItem('journeylens-color-mode', stored);
    mount();
    expect(document.documentElement.dataset.colorMode).toBe(stored === 'dark' ? 'dark' : 'light');
    expect(
      screen.getByRole('button', { name: stored === 'dark' ? '切换为浅色模式' : '切换为深色模式' }),
    ).toBeTruthy();
    const color = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    expect(color).toBe(stored === 'dark' ? '#000000' : '#f5f5f5');
  });
  it('切换保留同一个输入元素及内容，重新挂载恢复已保存选择', () => {
    const view = mount();
    const input = screen.getByLabelText('草稿');
    fireEvent.change(input, { target: { value: '尚未保存' } });
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    expect(screen.getByLabelText('草稿')).toBe(input);
    expect((input as HTMLInputElement).value).toBe('尚未保存');
    expect(localStorage.getItem('journeylens-color-mode')).toBe('dark');
    view.unmount();
    mount();
    expect(screen.getByRole('button', { name: '切换为浅色模式' })).toBeTruthy();
  });
  it('浏览器禁止读写偏好时仍可切换', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('禁止读取');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('禁止写入');
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    expect(document.documentElement.dataset.colorMode).toBe('dark');
  });
  it.each([false, true])('原生过渡结束异常=%s 时也恢复按钮，并在捕获前同步主题', async (failed) => {
    let update!: () => void;
    let finish!: () => void;
    const finished = new Promise<void>((resolve, reject) => {
      finish = () => (failed ? reject(new Error('跳过')) : resolve());
    });
    const start = vi.fn((callback: () => void) => {
      update = callback;
      return { finished };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    mount();
    const button = screen.getByRole('button', { name: '切换为深色模式' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(start).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);
    act(() => update());
    expect(document.documentElement.dataset.colorMode).toBe('dark');
    expect(localStorage.getItem('journeylens-color-mode')).toBe('dark');
    await act(async () => finish());
    expect(screen.getByRole('button', { name: '切换为浅色模式' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
  it('减少动效时不创建原生过渡', () => {
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    mount();
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.colorMode).toBe('dark');
  });
});
