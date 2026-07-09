import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAuthorizedTestHarnessRequest } from './internal.js';

const ORIGINAL_SECRET = process.env.TEST_HARNESS_SECRET;

beforeEach(() => {
  process.env.TEST_HARNESS_SECRET = 'correct-secret';
});

afterEach(() => {
  process.env.TEST_HARNESS_SECRET = ORIGINAL_SECRET;
});

describe('isAuthorizedTestHarnessRequest — guards /internal/mock-provider/force-fail', () => {
  it('rejects a missing header', () => {
    expect(isAuthorizedTestHarnessRequest(undefined)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(isAuthorizedTestHarnessRequest('wrong-secret')).toBe(false);
  });

  it('rejects when TEST_HARNESS_SECRET is unset, even if the header happens to be empty too', () => {
    delete process.env.TEST_HARNESS_SECRET;
    expect(isAuthorizedTestHarnessRequest('')).toBe(false);
    expect(isAuthorizedTestHarnessRequest(undefined)).toBe(false);
  });

  it('accepts the matching secret', () => {
    expect(isAuthorizedTestHarnessRequest('correct-secret')).toBe(true);
  });
});
