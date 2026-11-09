import type { Kit } from './kit';
import { seedPayrollExtras } from './payroll';
import { seedCaseExtras } from './cases';
import { seedPeopleExtras } from './people';
import { seedSecurityExtras } from './security';

/** Scenario areas, in the order they run (payroll first: other areas read payslips and salaries). */
export const EXTRA_AREAS: Record<string, (kit: Kit) => Promise<void>> = {
  payroll: seedPayrollExtras,
  cases: seedCaseExtras,
  people: seedPeopleExtras,
  security: seedSecurityExtras,
};

/** Runs the chosen areas (all by default) against the Acme demo organization. */
export async function runDemoExtras(kit: Kit, areas: string[] = Object.keys(EXTRA_AREAS)): Promise<void> {
  for (const area of areas) {
    const run = EXTRA_AREAS[area];
    if (!run) throw new Error(`Unknown demo extras area "${area}". Choose from: ${Object.keys(EXTRA_AREAS).join(', ')}`);
    console.log(`Acme extras · ${area}`);
    await run(kit);
  }
}
