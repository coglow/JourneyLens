import {
  currentAccountResponseSchema,
  type CurrentAccount,
  type LoginRequest,
} from '@journeylens/shared';
import { request, requestVoid } from './api';

export async function getCurrentAccount(): Promise<CurrentAccount> {
  const body = await request({ url: '/userinfo', method: 'GET' }, currentAccountResponseSchema);
  return body.data;
}

export async function login(values: LoginRequest): Promise<CurrentAccount> {
  const body = await request(
    { url: '/auth/login', method: 'POST', data: values },
    currentAccountResponseSchema,
  );
  return body.data;
}

export async function logout(): Promise<void> {
  await requestVoid({ url: '/auth/logout', method: 'POST' });
}
