import type { Invoice, PolicyViolation, Role } from '@approvalflow/shared';
import { getToken } from './auth.js';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    throw new ApiError(401, 'No/invalid token — please log in again.');
  }
  if (res.status === 403) {
    throw new ApiError(403, 'Your role is not allowed to do this.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface LoginResponse {
  token: string;
}

export function login(name: string, role: Role): Promise<LoginResponse> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, role }) });
}

export interface SubmitResponse {
  trackingId: string;
  correlationId: string;
  status?: 'duplicate';
}

export function submit(invoice: Invoice): Promise<SubmitResponse> {
  return request('/api/submissions', { method: 'POST', body: JSON.stringify(invoice) });
}

export interface SubmissionStatus {
  id: string;
  trackingId: string;
  correlationId: string;
  status: string;
  reason: string;
  submittedAt: string;
}

export function getSubmissionById(id: string): Promise<SubmissionStatus> {
  return request(`/api/submissions/${id}`);
}

// The backend 302-redirects tracking->id; fetch follows it automatically (same origin, so
// Authorization survives), landing on the same response shape as getSubmissionById.
export function getSubmissionByTracking(trackingId: string): Promise<SubmissionStatus> {
  return request(`/api/submissions/tracking/${trackingId}`);
}

export interface MySubmissionRow {
  id: string;
  trackingId: string;
  vendor: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  status: string;
  reason: string;
  createdAt: string;
}

// A server-backed history of everything the logged-in name has submitted — persists across
// navigation/refresh, unlike relying on the browser to remember a tracking id.
export function getMySubmissions(): Promise<MySubmissionRow[]> {
  return request('/api/submissions/mine');
}

export interface QueueItem {
  queueId: string;
  submissionId: string;
  status: string;
  department: string;
  amount: string;
  submitter: string;
  agentRecommendation?: string;
  agentConfidence?: number;
  agentReasoning?: string;
  rulesCited?: string[];
  violations?: PolicyViolation[];
  correlationId: string;
  createdAt: string;
}

export function getQueue(): Promise<QueueItem[]> {
  return request('/api/queue');
}

export interface ActionResult {
  queueId: string;
  submissionId: string;
  status: 'ok';
}

export function approve(queueId: string, approverId: string): Promise<ActionResult> {
  return request(`/api/approve/${queueId}`, {
    method: 'POST',
    body: JSON.stringify({ approverId }),
  });
}

export function reject(queueId: string, approverId: string, note?: string): Promise<ActionResult> {
  return request(`/api/reject/${queueId}`, {
    method: 'POST',
    body: JSON.stringify({ approverId, note }),
  });
}

export function requestInfo(queueId: string, note: string): Promise<ActionResult> {
  return request(`/api/request-info/${queueId}`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export interface DashboardStats {
  totalDecisions: number;
  byRoute: Record<string, number>;
  moneyAutoApproved: number;
  moneyHumanApproved: number;
}

export function getDashboard(): Promise<DashboardStats> {
  return request('/api/dashboard');
}
