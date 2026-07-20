import type { ReactNode } from 'react';
import { Flex, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
type PageHeaderProps = {
  title: ReactNode;
  /** 标题行上方的返回入口。 */
  back?: ReactNode;
  /** 标题行右侧的操作区。 */
  actions?: ReactNode;
};

export function PageHeader({ title, back, actions }: PageHeaderProps) {
  return (
    <div>
      <Flex vertical gap={12}>
        {back !== undefined && (
          <div>
            <ArrowLeftOutlined style={{ color: 'var(--ant-color-primary, #1677ff)' }} /> {back}
          </div>
        )}
        <Flex justify="space-between" align="flex-start" gap={16} wrap>
          <div style={{ minWidth: 0 }}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
          </div>
          {actions !== undefined && (
            <Flex gap={8} wrap style={{ flexShrink: 0 }}>
              {actions}
            </Flex>
          )}
        </Flex>
      </Flex>
    </div>
  );
}
