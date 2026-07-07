// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to payment_db per db/client.ts's env-var defaults).
import { sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db/client.js';
import { departmentBudgets } from './db/schema.js';
import { seedBudgetsIfEmpty } from './seed.js';

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE department_budgets`);
});

describe('seedBudgetsIfEmpty', () => {
  it('seeds department budgets from sample-invoices.json when the table is empty', async () => {
    await seedBudgetsIfEmpty();

    const rows = await db.select().from(departmentBudgets);
    const byDepartment = new Map(rows.map((r) => [r.department, r]));

    expect(byDepartment.get('marketing-2026Q2')?.total).toBe('1000.00');
    expect(byDepartment.get('engineering-2026Q2')?.total).toBe('50000.00');
    expect(byDepartment.get('sales-2026Q2')?.total).toBe('20000.00');
    expect(rows.every((r) => r.reserved === '0.00' && r.spent === '0.00')).toBe(true);
  });

  it('is a no-op if budgets are already populated', async () => {
    await seedBudgetsIfEmpty();
    await db.update(departmentBudgets).set({ reserved: '100.00' });

    await seedBudgetsIfEmpty();

    const rows = await db.select().from(departmentBudgets);
    expect(rows.every((r) => r.reserved === '100.00')).toBe(true);
  });
});
