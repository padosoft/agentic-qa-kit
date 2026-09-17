import { BudgetReaper, PostgresBudgetLedger } from '@aqa/cost';

/** One-shot entrypoint for Kubernetes CronJob/systemd timer deployments. */
export async function runBudgetReaper(): Promise<number> {
  const dsn = process.env.AQA_BUDGET_LEDGER_DSN?.trim();
  if (!dsn) throw new Error('AQA_BUDGET_LEDGER_DSN is required');
  const ledger = new PostgresBudgetLedger(dsn);
  try {
    const reaped = await new BudgetReaper(ledger).runOnce();
    console.info(JSON.stringify({ reaped }));
    return reaped;
  } finally {
    await ledger.close?.();
  }
}

if (process.argv[1]?.endsWith('budget-reaper-cli.js')) {
  runBudgetReaper().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'budget reaper failed');
    process.exitCode = 1;
  });
}
