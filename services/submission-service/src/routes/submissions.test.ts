// Unit test with a mocked `invokeService` — no live decision-service/sidecar needed, same
// approach as supplement.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupDecision } from './submissions.js';

const { invokeServiceMock } = vi.hoisted(() => ({ invokeServiceMock: vi.fn() }));

vi.mock('@approvalflow/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@approvalflow/shared')>();
  return { ...actual, invokeService: invokeServiceMock };
});

beforeEach(() => {
  invokeServiceMock.mockReset();
});

describe('lookupDecision — M14/M15 (structured logging, fail cleanly not silently)', () => {
  it('returns the decision on success without logging anything', async () => {
    const decision = { route: 'auto_approve', violations: [] };
    invokeServiceMock.mockResolvedValue(decision);
    const warn = vi.fn();

    const result = await lookupDecision('sub-1', 'corr-1', { warn });

    expect(result).toEqual(decision);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a warning with correlationId and submissionId when decision-service is unreachable, and returns undefined instead of throwing', async () => {
    const error = new Error('connection refused');
    invokeServiceMock.mockRejectedValue(error);
    const warn = vi.fn();

    const result = await lookupDecision('sub-1', 'corr-1', { warn });

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const [logObject, message] = warn.mock.calls[0]!;
    expect(logObject).toMatchObject({ err: error, correlationId: 'corr-1', submissionId: 'sub-1' });
    expect(message).toContain('decision-service');
  });
});
