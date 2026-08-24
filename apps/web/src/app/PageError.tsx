import { Button, Flex, Result } from 'antd';

type PageErrorProps = {
  standalone?: boolean;
};

/**
 * 路由渲染或页面代码加载失败时的兜底页。
 * React.lazy 加载失败后不会重新发起请求，恢复只能靠重新加载页面。
 */
export function PageError({ standalone = false }: PageErrorProps) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: standalone ? '100vh' : 320, padding: 24 }}
    >
      <Result
        status="warning"
        title="页面暂时无法打开"
        subTitle="请重新加载页面再试一次"
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载页面
          </Button>
        }
      />
    </Flex>
  );
}
