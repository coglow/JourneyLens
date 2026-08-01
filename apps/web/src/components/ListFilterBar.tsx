import type { ReactNode } from 'react';
import { Button, Col, Flex, Form, Grid, Row, type FormInstance } from 'antd';
import styles from './ListFilterBar.module.css';

/** 窄屏一列、中屏两列、宽屏三列、超宽屏四列。 */
export const listFilterColProps = { xs: 24, sm: 24, md: 12, lg: 8, xxl: 6 } as const;

type ListFilterBarProps<Values> = {
  form: FormInstance<Values>;
  onSearch: (values: Values) => void;
  onReset: () => void;
  children: ReactNode;
};

export function ListFilterBar<Values>({
  form,
  onSearch,
  onReset,
  children,
}: ListFilterBarProps<Values>) {
  const screens = Grid.useBreakpoint();
  // 首次渲染还没测出断点（screens.md 为 undefined），按宽屏排版避免先竖排再横排的跳动。
  const horizontalLabel = screens.md !== false;

  return (
    <Form
      form={form}
      // 窄屏统一将标签放在上方；其余屏幕使用等宽标签，控件沿用 antd 的剩余空间分配。
      layout={horizontalLabel ? 'horizontal' : 'vertical'}
      labelCol={horizontalLabel ? { flex: '80px' } : {}}
      labelAlign="left"
      onFinish={onSearch}
      className={styles.form}
    >
      <Row gutter={[16, 16]}>
        {children}
        <Col flex="auto">
          <Flex justify="end" gap={8}>
            <Button onClick={onReset}>重置</Button>
            <Button type="primary" htmlType="submit">
              查询
            </Button>
          </Flex>
        </Col>
      </Row>
    </Form>
  );
}
