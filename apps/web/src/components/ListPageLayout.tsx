import type { ReactNode } from 'react';
import { Card, Flex, Spin } from 'antd';

type ListPageLayoutProps = {
  filters: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  /** 首次加载时为 true，卡片内显示加载占位，此时不渲染 children。 */
  loading?: boolean;
  /** 加载占位的读屏说明，loading 为 true 时必填。 */
  loadingLabel?: string;
  children: ReactNode;
};

export function ListPageLayout({
  filters,
  toolbar,
  footer,
  loading = false,
  loadingLabel,
  children,
}: ListPageLayoutProps) {
  return (
    <Flex vertical gap={16}>
      <Card styles={{ body: { padding: '16px 24px' } }}>{filters}</Card>
      <Card>
        {toolbar && (
          <Flex justify="end" style={{ marginBottom: 16 }}>
            {toolbar}
          </Flex>
        )}
        {loading ? (
          <Flex
            justify="center"
            role="status"
            aria-label={loadingLabel}
            style={{ padding: '48px 0' }}
          >
            <Spin />
          </Flex>
        ) : (
          children
        )}
        {footer && (
          <Flex justify="end" style={{ marginTop: 16 }}>
            {footer}
          </Flex>
        )}
      </Card>
    </Flex>
  );
}
