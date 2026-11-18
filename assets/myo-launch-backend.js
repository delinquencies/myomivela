// @ts-check
/** @type {import('./myo-launch.d.ts').LaunchBackend} */
export const launchBackend = {
  async saveIntake(_intake) {
    // TODO(backend): Authorize the client and persist intake, emergency consent and overnight disclosures securely.
    throw new Error('MYO_INTAKE_PERSISTENCE_UNAVAILABLE');
  },
  async beginDepositCheckout(_requestId) {
    // TODO(backend): Reprice and verify lead time, capacity and Meet & Greet eligibility on the server.
    // TODO(backend): Create deposit checkout, verify payment before confirmation, expire unpaid requests after 48 hours and release dates, then handle the balance and applicable refunds.
    throw new Error('MYO_DEPOSIT_CHECKOUT_UNAVAILABLE');
  },
};
