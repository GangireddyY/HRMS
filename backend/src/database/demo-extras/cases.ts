import { seedComplianceExtras } from './cases-compliance';
import { seedGrievanceExtras } from './cases-grievances';
import type { Kit } from './kit';

/** Grievance, POSH, compliance (policies, statutory filings) and exit scenarios. */
export async function seedCaseExtras(kit: Kit): Promise<void> {
  await seedGrievanceExtras(kit);
  await seedComplianceExtras(kit);

  // Manoj resigns; neither his manager nor HR has accepted it yet.
  await kit.step('Cases: Manoj’s resignation waiting for acceptance', async () => {
    const manoj = await kit.as('manoj@acme.test');
    const mine = await manoj.get('/exits/mine');
    if (mine.current || mine.history.length) return 'skipped';
    await manoj.post('/exits/resign', { reason: 'HIGHER_STUDIES', reasonDetail: 'Starting a full-time MBA programme in January', requestedLastDay: kit.day(30) });
  });
}
