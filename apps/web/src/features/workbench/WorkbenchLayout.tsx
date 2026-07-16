import { Alert, Button, Divider, Flex, Layout, Menu, theme, Typography } from 'antd';
import type { CurrentAccount } from '@journeylens/shared';

const { Sider, Content } = Layout;

type WorkbenchLayoutProps = {
  account: CurrentAccount;
  loggingOut: boolean;
  logoutError: string | undefined;
  onLogout: () => void;
};

export function WorkbenchLayout({
  account,
  loggingOut,
  logoutError,
  onLogout,
}: WorkbenchLayoutProps) {
  const { token } = theme.useToken();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Flex
        role="banner"
        align="center"
        justify="space-between"
        wrap
        gap={16}
        style={{
          minHeight: 64,
          padding: '12px 24px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex align="center" gap={16}>
          <Typography.Text strong>JourneyLens</Typography.Text>
          <Divider orientation="vertical" style={{ margin: 0 }} />
          <Typography.Text type="secondary">活动</Typography.Text>
        </Flex>
        <Flex align="center" gap={16}>
          <Flex vertical style={{ minWidth: 0, maxWidth: 240 }}>
            <Typography.Text strong ellipsis>
              {account.displayName}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis={{ tooltip: account.email }}>
              {account.email}
            </Typography.Text>
          </Flex>
          <Button htmlType="button" loading={loggingOut} onClick={onLogout}>
            退出登录
          </Button>
        </Flex>
        {logoutError && (
          <Alert style={{ flexBasis: '100%' }} type="error" showIcon title={logoutError} />
        )}
      </Flex>
      <Layout>
        <Sider
          width="clamp(144px, 18vw, 208px)"
          theme="light"
          style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
        >
          <nav aria-label="主导航" style={{ padding: '12px 8px 0' }}>
            <Menu
              mode="inline"
              selectedKeys={['campaigns']}
              items={[{ key: 'campaigns', label: '活动' }]}
            />
          </nav>
        </Sider>
        <Content
          role="main"
          aria-label="活动工作区"
          style={{ minWidth: 0, padding: 24, background: token.colorBgContainer }}
        />
      </Layout>
    </Layout>
  );
}
