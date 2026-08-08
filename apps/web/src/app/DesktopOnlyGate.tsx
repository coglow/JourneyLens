import { DesktopOutlined } from '@ant-design/icons';
import { Modal, Result, theme } from 'antd';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

/** 与 antd md 断点对齐：小于 768px 视为手机与平板竖屏，不提供工作台界面。 */
const NARROW_QUERY = '(max-width: 767.98px)';

/**
 * 提示层必须盖住全部 antd 浮层：容器最高 2000、Message 2010、Notification 2050、Tooltip 1070。
 * 取值高于它们即可，不需要额外维护层级关系。
 */
const NOTICE_Z_INDEX = 3000;

function subscribe(onChange: () => void) {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getIsNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

function NarrowNotice() {
  const { token } = theme.useToken();
  return (
    <Modal
      open
      centered
      closable={false}
      footer={null}
      keyboard={false}
      mask={{ closable: false }}
      zIndex={NOTICE_Z_INDEX}
      width={368}
      styles={{
        mask: { background: token.colorBgLayout },
        container: { background: 'transparent', boxShadow: 'none', padding: 24 },
        body: { padding: 0 },
      }}
    >
      <Result
        icon={<DesktopOutlined style={{ fontSize: 40, color: token.colorPrimary }} />}
        title="当前窗口太窄"
        subTitle={
          <>
            为了您更好的操作体验，
            <br />
            请使用电脑浏览器打开本页面
          </>
        }
        styles={{
          root: { padding: 0 },
          icon: { marginBottom: 20 },
          title: {
            margin: 0,
            fontSize: 20,
            fontWeight: 600,
            lineHeight: 1.4,
            color: token.colorText,
          },
          subTitle: {
            marginTop: 8,
            fontSize: 14,
            lineHeight: 1.7,
            color: token.colorTextSecondary,
          },
        }}
      />
    </Modal>
  );
}

export function DesktopOnlyGate({ children }: { children: ReactNode }) {
  const isNarrow = useSyncExternalStore(subscribe, getIsNarrow);
  // 是否曾经在宽屏下挂载过业务界面。首帧同步取值，避免先渲染工作台再切走。
  const [enteredWide, setEnteredWide] = useState(() => !getIsNarrow());

  useEffect(() => {
    if (!isNarrow) setEnteredWide(true);
  }, [isNarrow]);

  if (!enteredWide) return <NarrowNotice />;

  return (
    <>
      {children}
      {isNarrow && <NarrowNotice />}
    </>
  );
}
