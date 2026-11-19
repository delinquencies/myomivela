// Use the real three-step care form in broader portal regression journeys.
export async function fillCareIntake(page,{authorization='no',spendingLimit='0',notes='Sample care details'} = {}) {
  const form = page.locator('[data-care-action=intake]');
  await form.locator('[name=service][value=walk]').check();
  for (let step = 0; step < 3; step++) {
    const panel = form.locator('[data-intake-step="'+step+'"]');
    await panel.waitFor();
    for (const field of await panel.locator('textarea:visible,input:not([type=radio]):not([type=checkbox]):visible').all()) {
      if (await field.getAttribute('name') === 'spendingLimit') await field.fill(spendingLimit);
      else if (!(await field.inputValue()).trim()) await field.fill(notes);
    }
    if (step === 2) await panel.locator('[name=vetAuthorization][value='+authorization+']').check();
    await form.locator('[data-intake-save]').click();
    if (step < 2) await form.locator('[data-intake-step="'+(step+1)+'"]:visible').waitFor();
    else await page.locator('#feedback').filter({hasText:/Saved\.|Guardado\./}).waitFor();
  }
}
