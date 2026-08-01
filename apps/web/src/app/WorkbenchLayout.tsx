import {
  AppstoreOutlined,
  HistoryOutlined,
  SolutionOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Alert, Avatar, Button, Flex, Layout, Menu, theme, Typography } from 'antd';
import type { CurrentAccount } from '@journeylens/shared';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import styles from './WorkbenchLayout.module.css';

const { Sider, Content } = Layout;
const SIDEBAR_WIDTH = '220px';
const navigationItems = [
  {
    key: 'campaigns',
    label: '活动',
    path: '/campaigns',
    icon: <AppstoreOutlined aria-hidden="true" />,
  },
  { key: 'segments', label: '分群', path: '/segments', icon: <TeamOutlined aria-hidden="true" /> },
  {
    key: 'executions',
    label: '执行记录',
    path: '/executions',
    icon: <HistoryOutlined aria-hidden="true" />,
  },
  {
    key: 'events',
    label: '行为记录',
    path: '/events',
    icon: <SolutionOutlined aria-hidden="true" />,
  },
] as const;

type WorkbenchLayoutProps = {
  account: CurrentAccount;
  loggingOut: boolean;
  logoutError: string | undefined;
  onLogout: () => void;
  children: ReactNode;
};

export function WorkbenchLayout({
  account,
  loggingOut,
  logoutError,
  onLogout,
  children,
}: WorkbenchLayoutProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const activeItem =
    navigationItems.find(({ path }) => location.pathname.startsWith(path)) ?? navigationItems[0]!;

  function navigateToMenu(key: string): void {
    const item = navigationItems.find((navigationItem) => navigationItem.key === key);
    if (item !== undefined) navigate(item.path);
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <header
        className={styles.header}
        role="banner"
        style={{
          background: token.colorBgContainer,
          borderBottomColor: token.colorBorderSecondary,
        }}
      >
        <div className={styles.headerRow}>
          <div
            className={styles.brand}
            data-collapsed={collapsed}
            style={{
              width: collapsed ? 64 : SIDEBAR_WIDTH,
              borderRightColor: token.colorBorderSecondary,
            }}
          >
            <div
              className={styles.logo}
              data-collapsed={collapsed}
              style={{ background: token.colorPrimary }}
              aria-hidden="true"
            >
              JL
            </div>
            {!collapsed && (
              <Typography.Text strong className={styles.brandName ?? ''}>
                JourneyLens
              </Typography.Text>
            )}
          </div>
          <Flex className={styles.headerMain} align="center" gap={20} wrap>
            <Button
              className={styles.collapseButton ?? ''}
              type="text"
              size="large"
              aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <nav aria-label="当前位置" className={styles.pageLocation}>
              <Typography.Text type="secondary">运营工作台 / </Typography.Text>
              <Typography.Text strong>{activeItem.label}</Typography.Text>
            </nav>
            <Flex className={styles.account} align="center" gap={16}>
              <Flex align="center" gap={8} className={styles.accountInfo}>
                <Avatar
                  style={{ backgroundColor: 'var(--ant-color-primary, #1677ff)' }}
                  size="small"
                  icon={<UserOutlined />}
                />
                <Typography.Text strong ellipsis>
                  {account.displayName}
                </Typography.Text>
              </Flex>
              <Button htmlType="button" loading={loggingOut} onClick={onLogout}>
                退出登录
              </Button>
            </Flex>
          </Flex>
        </div>
        {logoutError && (
          <Alert className={styles.logoutAlert ?? ''} type="error" showIcon title={logoutError} />
        )}
      </header>
      <Layout>
        <Sider
          width={SIDEBAR_WIDTH}
          collapsedWidth={64}
          collapsed={collapsed}
          trigger={null}
          theme="light"
        >
          <nav aria-label="主导航" className={styles.nav}>
            <Menu
              mode="inline"
              inlineCollapsed={collapsed}
              selectedKeys={[activeItem.key]}
              style={{ borderInlineEnd: 'none' }}
              items={navigationItems.map(({ key, label, icon }) => ({ key, label, icon }))}
              onClick={({ key }) => navigateToMenu(key)}
            />
          </nav>
        </Sider>
        <Content
          role="main"
          aria-label={`${activeItem.label}工作区`}
          style={{ minWidth: 0, padding: 24 }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
