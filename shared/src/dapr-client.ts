/**
 * Thin wrapper over the Dapr HTTP API (no SDK dependency — ADR-002). Every service talks to its
 * own sidecar at localhost:{DAPR_HTTP_PORT}.
 */

const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT ?? '3500';
const DAPR_BASE_URL = `http://localhost:${DAPR_HTTP_PORT}/v1.0`;

export class DaprError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'DaprError';
  }
}

async function assertOk(res: Response, action: string): Promise<Response> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DaprError(`Dapr ${action} failed with status ${res.status}`, res.status, body);
  }
  return res;
}

/** Synchronous service invocation via the local Dapr sidecar. */
export async function invokeService<T>(
  appId: string,
  method: string,
  options: {
    httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const { httpMethod = 'GET', body, headers = {} } = options;
  const init: RequestInit = {
    method: httpMethod,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${DAPR_BASE_URL}/invoke/${appId}/method/${method}`, init);
  await assertOk(res, `invoke ${appId}/${method}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Publish an event over a Dapr pub/sub component. */
export async function publishEvent(
  pubsubName: string,
  topic: string,
  data: unknown,
  correlationId: string,
): Promise<void> {
  const res = await fetch(`${DAPR_BASE_URL}/publish/${pubsubName}/${topic}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      traceparent: correlationId,
    },
    body: JSON.stringify(data),
  });
  await assertOk(res, `publish ${pubsubName}/${topic}`);
}

/** Save one or more keys in a Dapr state store. */
export async function saveState(
  storeName: string,
  entries: { key: string; value: unknown }[],
): Promise<void> {
  const res = await fetch(`${DAPR_BASE_URL}/state/${storeName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entries),
  });
  await assertOk(res, `save state on ${storeName}`);
}

/** Read a single key from a Dapr state store. Returns undefined if the key is absent. */
export async function getState<T>(storeName: string, key: string): Promise<T | undefined> {
  const res = await fetch(`${DAPR_BASE_URL}/state/${storeName}/${encodeURIComponent(key)}`);
  if (res.status === 204) return undefined;
  await assertOk(res, `get state ${storeName}/${key}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : undefined;
}

/** Read a secret from a Dapr secret store. */
export async function getSecret(storeName: string, name: string): Promise<Record<string, string>> {
  const res = await fetch(`${DAPR_BASE_URL}/secrets/${storeName}/${encodeURIComponent(name)}`);
  await assertOk(res, `get secret ${storeName}/${name}`);
  return (await res.json()) as Record<string, string>;
}
