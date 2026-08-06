import type { ThemeConfig } from 'antd';

/** 全局主题配置，集中维护 Token 与组件定制。 */
export const theme: ThemeConfig = {
  components: {
    Badge: { statusSize: 7 },
    Menu: {
      fontSize: 15,
      iconSize: 14,
      iconMarginInlineEnd: 12,
      collapsedIconSize: 18,
      groupTitleFontSize: 13,
      itemBorderRadius: 6,
    },
  },
};
