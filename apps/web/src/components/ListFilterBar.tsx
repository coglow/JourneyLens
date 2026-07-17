import type { ReactNode } from 'react';
import { Button, Col, Flex, Form, Row, type FormInstance } from 'antd';
import styles from './ListFilterBar.module.css';

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
  return (
    <Form form={form} layout="inline" onFinish={onSearch} className={styles.form}>
      <Row gutter={[16, 16]} style={{ width: '100%' }}>
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
