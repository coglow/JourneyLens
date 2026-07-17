import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Drawer, Flex, Form, Input, Modal } from 'antd';
import {
  campaignBudgetSchema,
  campaignCreateSchema,
  type CampaignCreateInput,
  type CampaignDetail,
} from '@journeylens/shared';
import { getWriteErrorMessage, isSessionExpired } from '@/services/api';
import { createCampaign, updateCampaign } from '@/services/campaigns';

type CampaignFormValues = {
  name: string;
  description?: string;
  budgetAmount?: string;
};

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
  });
  const editing = campaign !== undefined;
  const mutation = useMutation({
    mutationFn: (values: CampaignFormValues) => {
      const amount = values.budgetAmount?.trim();
      return campaign === undefined
        ? createCampaign({
            name: values.name,
            description: values.description,
            ...(amount ? { budget: { amount } } : {}),
          } satisfies CampaignCreateInput)
        : updateCampaign(campaign.id, {
            name: values.name,
            description: values.description,
            budget: amount ? { amount } : null,
          });
    },
  });
  const submitting = mutation.isPending;

  useEffect(() => {
    if (open) {
      const values = {
        name: campaign?.name ?? '',
        description: campaign?.description ?? '',
        budgetAmount: campaign?.budget?.amount ?? '',
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
      values.budgetAmount !== initial.budgetAmount;
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
      mask={{ closable: !submitting }}
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
      <Form form={form} layout="vertical" onFinish={submit}>
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
      </Form>
    </Drawer>
  );
}
