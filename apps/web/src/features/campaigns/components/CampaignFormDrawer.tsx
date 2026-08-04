import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Typography,
} from 'antd';
import {
  CAMPAIGN_GOAL_EVENT_TYPES,
  CAMPAIGN_GOAL_PRODUCT_EVENT_TYPES,
  JOURNEY_EVENT_TYPE_LABELS,
  campaignBudgetSchema,
  campaignCreateSchema,
  type CampaignCreateInput,
  type CampaignDetail,
  type CampaignGoalEventType,
} from '@journeylens/shared';
import { getWriteErrorMessage, isSessionExpired } from '@/services/api';
import { createCampaign, updateCampaign } from '@/services/campaigns';
import { campaignGoalText } from '../campaign-goal';

type CampaignFormValues = {
  name: string;
  description?: string;
  budgetAmount?: string;
  goalEventType: CampaignGoalEventType | '';
  goalSameProduct?: boolean;
};

/** 不设置目标是一个明确选项，不自动代选任何一个目标。 */
const GOAL_OPTIONS = [
  { value: '', label: '不设置目标' },
  ...CAMPAIGN_GOAL_EVENT_TYPES.map((eventType) => ({
    value: eventType,
    label: JOURNEY_EVENT_TYPE_LABELS[eventType],
  })),
];

function hasProductGoalOption(eventType: string): boolean {
  return (CAMPAIGN_GOAL_PRODUCT_EVENT_TYPES as readonly string[]).includes(eventType);
}

function goalPayload(
  values: CampaignFormValues,
): { eventType: CampaignGoalEventType; sameProduct: boolean } | null {
  if (values.goalEventType === '') return null;
  return { eventType: values.goalEventType, sameProduct: values.goalSameProduct === true };
}

type CampaignFormDrawerProps = {
  open: boolean;
  campaign?: CampaignDetail;
  onCancel: () => void;
  onSaved: (campaign: CampaignDetail) => void;
  restoreFocus: () => void;
};

export function CampaignFormDrawer({
  open,
  campaign,
  onCancel,
  onSaved,
  restoreFocus,
}: CampaignFormDrawerProps) {
  const [form] = Form.useForm<CampaignFormValues>();
  const [error, setError] = useState<string>();
  const initialValues = useRef<CampaignFormValues>({
    name: '',
    description: '',
    budgetAmount: '',
    goalEventType: '',
  });
  const editing = campaign !== undefined;
  // 目标是否还能改由服务端给出，前端不凭活动状态自行推断。
  const goalEditable = campaign === undefined || campaign.goalEditable;
  const mutation = useMutation({
    mutationFn: (values: CampaignFormValues) => {
      const amount = values.budgetAmount?.trim();
      // 目标已固定时不提交 goal，其他资料照常保存。
      const goal = goalEditable ? { goal: goalPayload(values) } : {};
      return campaign === undefined
        ? createCampaign({
            name: values.name,
            description: values.description,
            ...(amount ? { budget: { amount } } : {}),
            ...goal,
          } satisfies CampaignCreateInput)
        : updateCampaign(campaign.id, {
            name: values.name,
            description: values.description,
            budget: amount ? { amount } : null,
            ...goal,
          });
    },
  });
  const submitting = mutation.isPending;

  useEffect(() => {
    if (open) {
      const values: CampaignFormValues = {
        name: campaign?.name ?? '',
        description: campaign?.description ?? '',
        budgetAmount: campaign?.budget?.amount ?? '',
        goalEventType: campaign?.goal?.eventType ?? '',
        goalSameProduct: campaign?.goal?.sameProduct ?? false,
      };
      initialValues.current = values;
      form.resetFields();
      form.setFieldsValue(values);
      setError(undefined);
    }
  }, [campaign, form, open]);

  function close(): void {
    form.resetFields();
    setError(undefined);
    onCancel();
  }

  function requestClose(): void {
    if (submitting) return;
    const values = form.getFieldsValue(true);
    const initial = initialValues.current;
    const changed =
      values.name !== initial.name ||
      values.description !== initial.description ||
      values.budgetAmount !== initial.budgetAmount ||
      (goalEditable &&
        (values.goalEventType !== initial.goalEventType ||
          (values.goalSameProduct === true) !== (initial.goalSameProduct === true)));
    if (!changed) {
      close();
      return;
    }

    let discardConfirmed = false;
    Modal.confirm({
      title: editing ? '放弃修改？' : '放弃填写？',
      content: '已填写的内容不会保存。',
      okText: editing ? '放弃修改' : '放弃填写',
      cancelText: '继续填写',
      okButtonProps: { danger: true },
      focusable: { autoFocusButton: 'cancel' },
      onOk: () => {
        discardConfirmed = true;
        close();
      },
      afterClose: () => {
        if (discardConfirmed) restoreFocus();
      },
    });
  }

  async function submit(values: CampaignFormValues): Promise<void> {
    if (submitting) return;
    setError(undefined);

    try {
      onSaved(await mutation.mutateAsync(values));
    } catch (requestError) {
      if (!isSessionExpired(requestError)) setError(getWriteErrorMessage(requestError));
    }
  }

  return (
    <Drawer
      title={editing ? '编辑活动' : '新建活动'}
      open={open}
      size="large"
      closable={{ disabled: submitting, 'aria-label': '关闭' }}
      keyboard={!submitting}
      focusable={{ focusTriggerAfterClose: false }}
      onClose={requestClose}
      footer={
        <Flex justify="end" gap={8}>
          <Button disabled={submitting} onClick={requestClose}>
            取消
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={submitting}
            onClick={() => form.submit()}
          >
            {submitting ? (editing ? '正在保存…' : '正在创建…') : editing ? '保存修改' : '创建活动'}
          </Button>
        </Flex>
      }
      afterOpenChange={(visible) => {
        if (!visible) restoreFocus();
      }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        onValuesChange={(changed: Partial<CampaignFormValues>) => {
          // 换成不支持商品的目标时清掉旧勾选，避免提交非法组合。
          if (changed.goalEventType !== undefined && !hasProductGoalOption(changed.goalEventType)) {
            form.setFieldValue('goalSameProduct', false);
          }
        }}
      >
        {error && <Alert style={{ marginBottom: 16 }} type="error" showIcon title={error} />}
        <Form.Item
          label="活动名称"
          name="name"
          required
          rules={[
            {
              validator: async (_, value: string | undefined) => {
                const result = campaignCreateSchema.safeParse({ name: value ?? '' });
                if (!result.success) throw new Error('名称去除首尾空格后需为 1 到 180 个字符');
              },
            },
          ]}
        >
          <Input autoComplete="off" placeholder="请输入活动名称" />
        </Form.Item>
        <Form.Item
          label="说明"
          name="description"
          rules={[
            {
              validator: async (_, value: string | undefined) => {
                if ((value?.trim().length ?? 0) > 4000) {
                  throw new Error('说明去除首尾空格后不能超过 4000 个字符');
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={4} showCount placeholder="请输入活动说明" />
        </Form.Item>
        <Form.Item
          label="预算金额"
          name="budgetAmount"
          rules={[
            {
              validator: async (_, value: string | undefined) => {
                if (!value?.trim()) return;
                if (!campaignBudgetSchema.safeParse({ amount: value.trim() }).success) {
                  throw new Error('请输入非负金额，最多 12 位整数和 2 位小数');
                }
              },
            },
          ]}
        >
          <Input inputMode="decimal" autoComplete="off" placeholder="如 100.00" />
        </Form.Item>
        {goalEditable ? (
          <>
            <Form.Item
              label="活动目标"
              name="goalEventType"
              extra="用户达成目标后，该次参与结束；活动本身和其他用户不受影响。"
            >
              <Select options={GOAL_OPTIONS} disabled={submitting} />
            </Form.Item>
            {/* 只有购买和预约目标才提供同商品选项。 */}
            <Form.Item
              noStyle
              shouldUpdate={(previous, next) => previous.goalEventType !== next.goalEventType}
            >
              {({ getFieldValue }) =>
                hasProductGoalOption(getFieldValue('goalEventType')) ? (
                  <Form.Item
                    name="goalSameProduct"
                    valuePropName="checked"
                    extra={
                      getFieldValue('goalEventType') === 'reservation_created'
                        ? '例如：用户看了商品 A，之后预约 A 才算达成，预约 B 不算。'
                        : '例如：用户看了商品 A，之后买 A 才算达成，买 B 不算。'
                    }
                  >
                    <Checkbox disabled={submitting}>只算同一件商品</Checkbox>
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </>
        ) : (
          <Form.Item label="活动目标">
            <Typography.Text>
              {campaign?.goal === undefined || campaign.goal === null
                ? '未设置目标'
                : campaignGoalText(campaign.goal)}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
              已有发布旅程，目标不能修改
            </Typography.Paragraph>
          </Form.Item>
        )}
      </Form>
    </Drawer>
  );
}
