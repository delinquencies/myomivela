// @ts-check
/** @type {import('./myo-launch.d.ts').LaunchBackend} */
export const launchBackend = {
  async saveIntake(intake) {
    const response=await fetch('/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intake)});
    const result=await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  },
  async beginDepositCheckout(_requestId) {
    // TODO(backend): Connect the selected payment provider, verify payment before confirmation, expire unpaid requests after 48 hours, and handle balances and refunds.
    throw new Error('MYO_DEPOSIT_CHECKOUT_UNAVAILABLE');
  },
};
