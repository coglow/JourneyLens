/** 等待时长统一按秒保存，30 天覆盖本次模拟的最大等待窗口。 */
export const JOURNEY_WAIT_MAX_SECONDS = 30 * 24 * 60 * 60;

/** 消息主题与正文的共享长度限制：配置文本和替换后的结果使用同一口径。 */
export const JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH = 200;
export const JOURNEY_MESSAGE_BODY_MAX_LENGTH = 2_000;
