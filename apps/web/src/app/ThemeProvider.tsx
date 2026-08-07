import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { theme } from './theme';

type ColorMode = 'light' | 'dark';
type ColorModeContextValue = { mode: ColorMode; switching: boolean; toggleMode: () => void };
const ColorModeContext = createContext<ColorModeContextValue | null>(null);

export function useColorMode(): ColorModeContextValue {
  const context = useContext(ColorModeContext);
  if (context === null) throw new Error('useColorMode 必须在 ThemeProvider 内使用');
  return context;
}

/** 在动态 ConfigProvider 内读取实际颜色，根底色与容器始终使用同一份主题。 */
function ThemeSurface({ mode, children }: { mode: ColorMode; children: ReactNode }) {
  const { token } = antdTheme.useToken();
  useLayoutEffect(() => {
    document.documentElement.dataset.colorMode = mode;
    document.documentElement.style.backgroundColor = token.colorBgLayout;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', token.colorBgLayout);
  }, [mode, token.colorBgLayout]);
  return (
    <AntApp style={{ minHeight: '100vh', background: token.colorBgLayout }}>{children}</AntApp>
  );
}

/** 主题只改变展示；保持路由、查询客户端与业务子树挂载，不进入草稿修改历史。 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(() =>
    document.documentElement.dataset.colorMode === 'dark' ? 'dark' : 'light',
  );
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);

  function toggleMode() {
    if (switchingRef.current) return;
    const nextMode = mode === 'dark' ? 'light' : 'dark';
    const update = () => {
      // 浏览器捕获新画面前必须完成 React 提交及根底色同步。
      flushSync(() => setMode(nextMode));
      try {
        localStorage.setItem('journeylens-color-mode', nextMode);
      } catch {
        // 浏览器禁止保存偏好时，仍保留本次页面内的选择。
      }
    };
    if (
      !document.startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      update();
      return;
    }
    switchingRef.current = true;
    setSwitching(true);
    const transition = document.startViewTransition(update);
    const finish = () => {
      switchingRef.current = false;
      setSwitching(false);
    };
    // 跳过或中断过渡时同样释放按钮，不重复执行模式取反。
    void transition.finished.then(finish, finish);
  }

  return (
    <ColorModeContext.Provider value={{ mode, switching, toggleMode }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          ...theme,
          // 应用只有一个根主题，复用同一变量作用域，重新挂载时也不重复生成作用域。
          cssVar: { key: 'journeylens' },
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        }}
        modal={{ mask: { closable: false } }}
        drawer={{ mask: { closable: false } }}
      >
        <ThemeSurface mode={mode}>{children}</ThemeSurface>
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
}
