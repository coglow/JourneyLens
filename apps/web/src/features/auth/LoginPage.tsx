import { useState } from 'react';
import { useColorMode } from '@/app/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Alert, Button, Divider, Form, Input, Layout, Typography } from 'antd';
import type { LoginRequest } from '@journeylens/shared';
import journeyPreviewUrl from '@/assets/login-journey-preview.svg';
import { getApiErrorMessage } from '@/services/api';
import { login } from '@/services/auth';
import { useAuth } from './auth-provider';
import styles from './LoginPage.module.css';

const DEMO_ACCOUNT: LoginRequest = { email: 'demo@example.com', password: 'demo123456' };

export function LoginPage() {
  const { mode, switching, toggleMode } = useColorMode();
  const [form] = Form.useForm<LoginRequest>();
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
    <Layout role="main" className={styles.page ?? ''}>
      <div className={styles.themeToggle}>
        <ThemeToggle mode={mode} switching={switching} onToggle={toggleMode} />
      </div>
      <section className={styles.hero} aria-label="JourneyLens 旅程营销平台">
        <div className={styles.brand}>
          <svg
            className={styles.brandIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x={3} y={3} width={8} height={8} rx={2} />
            <path d="M7 11v4a2 2 0 0 0 2 2h4" />
            <rect x={13} y={13} width={8} height={8} rx={2} />
          </svg>
          <span>JourneyLens</span>
        </div>
        <div className={styles.introduction}>
          <h2>编排一次旅程，看清每一次触达</h2>
          <Typography.Text type="secondary">
            旅程营销自动化平台，从旅程编排，到触达追踪
          </Typography.Text>
        </div>
        <figure className={styles.preview}>
          <img
            src={journeyPreviewUrl}
            style={{ colorScheme: mode }}
            width={900}
            height={540}
            alt="旅程编排界面示意图：根据条件发送邮件或等待，随后结束旅程"
          />
        </figure>
      </section>

      <section className={styles.loginPanel} aria-labelledby="login-heading">
        <div className={styles.loginContent}>
          <header className={styles.loginHeader}>
            <Typography.Title id="login-heading" level={1} className={styles.loginTitle ?? ''}>
              登录工作台
            </Typography.Title>
            <Typography.Text type="secondary">进入 JourneyLens 运营工作区</Typography.Text>
          </header>
          {loginError && (
            <Alert className={styles.loginError ?? ''} type="error" showIcon title={loginError} />
          )}
          <Form<LoginRequest>
            form={form}
            layout="vertical"
            size="large"
            styles={{ label: { fontSize: 16, fontWeight: 600 } }}
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
                placeholder="请输入邮箱"
                spellCheck={false}
                disabled={submitting}
              />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                name="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                disabled={submitting}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
              登录
            </Button>
          </Form>
          <Divider />
          <div className={styles.demoAccount}>
            <Typography.Title level={3} className={styles.demoTitle ?? ''}>
              首次体验？
            </Typography.Title>
            <Typography.Text type="secondary">填入演示账号后，点击登录即可体验。</Typography.Text>
            <Button
              size="large"
              block
              disabled={submitting}
              onClick={() => {
                form.setFieldsValue(DEMO_ACCOUNT);
                setLoginError(undefined);
              }}
            >
              填入演示账号
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
