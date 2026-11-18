export type Service = 'walk' | 'dropIn' | 'overnight';
export type PetKind = 'dog' | 'cat' | 'exotic';
export interface EstimateInput {
  service: Service;
  date: string;
  pets: readonly { kind: PetKind; ageYears?: number }[];
  duration?: 30 | 60;
  nights?: number;
  lastMinute?: boolean;
}
export interface Estimate {
  lines: {code:string; cents:number}[];
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  requiresCustomQuote: boolean;
}
export interface IntakeSubmission {
  service: Service;
  pets: string;
  feeding: string;
  health: string;
  medication: string;
  behavior: string;
  vaccines: string;
  vet: string;
  emergency: string;
  decisionMakers: string;
  vetAuthorization: 'yes' | 'no';
  spendingLimit: number;
  overnightAlone?: string;
  overnightBehavior?: string;
}
export interface LaunchBackend {
  saveIntake(intake: IntakeSubmission): Promise<{id:string}>;
  beginDepositCheckout(requestId:string): Promise<{url:string}>;
}
