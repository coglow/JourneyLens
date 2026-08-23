import { Button, Layout, Result } from 'antd';
import { useNavigate } from 'react-router';

/** 地址不存在时的兜底页面：说明找不到内容，并提供回到概览的入口。 */
export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <Layout
      role="main"
      aria-label="找不到页面"
      style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <Result
        status="404"
        title="找不到这个页面"
        subTitle="地址可能输入有误，或者这个页面已经不存在。"
        extra={
          <Button type="primary" onClick={() => navigate('/overview')}>
            返回首页
          </Button>
        }
      />
    </Layout>
  );
}
