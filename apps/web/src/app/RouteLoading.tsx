import { Flex, Spin } from 'antd';

/** 页面代码按需加载期间的占位：只替换内容区，外层布局保持可见。 */
export function RouteLoading() {
  return (
    <Flex justify="center" role="status" aria-label="正在加载页面" style={{ padding: '48px 0' }}>
      <Spin />
    </Flex>
  );
}
