import { z } from 'zod';
import { journeyDraftDefinitionSchema } from '../journeys/journey-draft.js';
import { JOURNEY_ENTRY_BEHAVIOR_VALUES } from '../journeys/journey-events.js';

export const AI_DRAFT_DESCRIPTION_MAX_LENGTH = 2_000;
/** 单次返回的新问题上限；累计补答只受请求体大小限制，不再增加轮次编号。 */
export const AI_DRAFT_QUESTION_MAX_COUNT = 5;
export const AI_DRAFT_QUESTION_LABEL_MAX_LENGTH = 200;
export const AI_DRAFT_OPTION_MIN_COUNT = 2;
export const AI_DRAFT_OPTION_MAX_COUNT = 10;
export const AI_DRAFT_OPTION_TEXT_MAX_LENGTH = 100;
export const AI_DRAFT_ANSWER_MAX_LENGTH = 500;
export const AI_DRAFT_REASON_MAX_LENGTH = 500;

const questionLabelSchema = z
  .string({ error: '问题说明不能为空' })
  .trim()
  .min(1, '问题说明不能为空')
  .max(
    AI_DRAFT_QUESTION_LABEL_MAX_LENGTH,
    `问题说明最多 ${AI_DRAFT_QUESTION_LABEL_MAX_LENGTH} 个字符`,
  );

// 开放数值、时长等无法列全的信息用短文本，问题本身不带默认值。
const textQuestionSchema = z
  .object({
    type: z.literal('text'),
    label: questionLabelSchema,
  })
  .strict();

const optionSchema = z
  .object({
    value: z
      .string({ error: '选项值不能为空' })
      .trim()
      .min(1, '选项值不能为空')
      .max(AI_DRAFT_OPTION_TEXT_MAX_LENGTH, `选项值最多 ${AI_DRAFT_OPTION_TEXT_MAX_LENGTH} 个字符`),
    label: z
      .string({ error: '选项名称不能为空' })
      .trim()
      .min(1, '选项名称不能为空')
      .max(
        AI_DRAFT_OPTION_TEXT_MAX_LENGTH,
        `选项名称最多 ${AI_DRAFT_OPTION_TEXT_MAX_LENGTH} 个字符`,
      ),
  })
  .strict();

const singleChoiceQuestionSchema = z
  .object({
    type: z.literal('single_choice'),
    label: questionLabelSchema,
    options: z
      .array(optionSchema)
      .min(AI_DRAFT_OPTION_MIN_COUNT, `单选问题至少需要 ${AI_DRAFT_OPTION_MIN_COUNT} 个选项`)
      .max(AI_DRAFT_OPTION_MAX_COUNT, `单选问题最多 ${AI_DRAFT_OPTION_MAX_COUNT} 个选项`)
      .refine(
        (options) => new Set(options.map((option) => option.value)).size === options.length,
        '同一问题的选项值不能重复',
      ),
  })
  .strict();

export const aiDraftQuestionSchema = z.discriminatedUnion('type', [
  textQuestionSchema,
  singleChoiceQuestionSchema,
]);

export const aiDraftQuestionsSchema = z
  .array(aiDraftQuestionSchema)
  .min(1, '请至少提出一个需要补充的问题')
  .max(AI_DRAFT_QUESTION_MAX_COUNT, `一次最多提出 ${AI_DRAFT_QUESTION_MAX_COUNT} 个问题`);

// 问题与答案成对提交，服务端不保存上一轮问题，也不为核对轮次额外编号。
export const aiDraftClarificationSchema = z
  .object({
    question: aiDraftQuestionSchema,
    answer: z
      .string({ error: '补充信息不能为空' })
      .trim()
      .min(1, '补充信息不能为空')
      .max(AI_DRAFT_ANSWER_MAX_LENGTH, `补充信息最多 ${AI_DRAFT_ANSWER_MAX_LENGTH} 个字符`),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.question.type !== 'single_choice') return;
    if (!value.question.options.some((option) => option.value === value.answer)) {
      ctx.addIssue({
        code: 'custom',
        path: ['answer'],
        message: '请选择问题提供的选项',
      });
    }
  });

export const journeyAiDraftRequestSchema = z
  .object({
    // 进入行为是运营在窗口内明确选择的生成约束，不由模型根据描述推断。
    entryBehavior: z.enum(JOURNEY_ENTRY_BEHAVIOR_VALUES, { error: '请选择有效的进入行为' }),
    description: z
      .string({ error: '请填写旅程描述' })
      .trim()
      .min(1, '请填写旅程描述')
      .max(
        AI_DRAFT_DESCRIPTION_MAX_LENGTH,
        `旅程描述最多 ${AI_DRAFT_DESCRIPTION_MAX_LENGTH} 个字符`,
      ),
    clarifications: z.array(aiDraftClarificationSchema).optional(),
  })
  .strict();

const readyResultSchema = z
  .object({
    status: z.literal('ready'),
    // 坐标由前端按当前布局方向计算，生成结果只表达节点、配置和连线。
    draftDefinition: journeyDraftDefinitionSchema,
  })
  .strict();

const needsInputResultSchema = z
  .object({
    status: z.literal('needs_input'),
    questions: aiDraftQuestionsSchema,
  })
  .strict();

/** 模型原始结果与公开响应共用不支持说明的校验，保持同一套长度和文案约束。 */
export const aiDraftUnsupportedResultSchema = z
  .object({
    status: z.literal('unsupported'),
    reason: z
      .string({ error: '请说明不支持的业务部分' })
      .trim()
      .min(1, '请说明不支持的业务部分')
      .max(AI_DRAFT_REASON_MAX_LENGTH, `说明最多 ${AI_DRAFT_REASON_MAX_LENGTH} 个字符`),
  })
  .strict();

export const journeyAiDraftResultSchema = z.discriminatedUnion('status', [
  readyResultSchema,
  needsInputResultSchema,
  aiDraftUnsupportedResultSchema,
]);

export const journeyAiDraftResponseSchema = z.object({ data: journeyAiDraftResultSchema }).strict();

export type AiDraftQuestion = z.infer<typeof aiDraftQuestionSchema>;
export type AiDraftClarification = z.infer<typeof aiDraftClarificationSchema>;
export type JourneyAiDraftRequest = z.output<typeof journeyAiDraftRequestSchema>;
export type JourneyAiDraftRequestInput = z.input<typeof journeyAiDraftRequestSchema>;
export type JourneyAiDraftResult = z.infer<typeof journeyAiDraftResultSchema>;
