import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import type { LoginRequest } from '@journeylens/shared';
import { getApiErrorMessage } from '@/services/api';
import { login } from '@/services/auth';
import { useAuth } from './auth-provider';

export function LoginPage() {
  const { signIn } = useAuth();
  const [loginError, setLoginError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(values: LoginRequest): Promise<void> {
    setSubmitting(true);
    setLoginError(undefined);
    try {
      signIn(await login(values));
    } catch (error) {
      setLoginError(getApiErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <Card style={{ width: 440, maxWidth: '100%' }}>
      <Typography.Title level={1}>登录 JourneyLens</Typography.Title>
      {loginError && (
        <Alert style={{ marginBottom: 24 }} type="error" showIcon title={loginError} />
      )}
      <Form<LoginRequest>
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => void submitLogin(values)}
      >
        <Form.Item
          label="邮箱"
          name="email"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input
            name="email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            disabled={submitting}
          />
        </Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password name="password" autoComplete="current-password" disabled={submitting} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} block>
          登录
        </Button>
      </Form>
    </Card>
  );
}
