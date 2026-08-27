import apiClient from './client';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function registerRequest(
  input: RegisterInput
): Promise<RegisterResponse> {
  const { data } = await apiClient.post<RegisterResponse>(
    '/auth/register',
    input
  );
  return data;
}

export async function loginRequest(
  input: LoginInput
): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', input);
  return data;
}
