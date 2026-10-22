export const PRO_PLAN_CODES = ['SIX_MONTH', 'ONE_YEAR'] as const;
export type ProPlanCodeValue = (typeof PRO_PLAN_CODES)[number];

export type ProPlanDefinition = {
  code: ProPlanCodeValue;
  label: string;
  durationMonths: number;
  amountPaise: number;
  amountInr: number;
  /** Razorpay plan id from dashboard (plan_…). */
  razorpayPlanIdEnv: 'RAZORPAY_PLAN_6M_ID' | 'RAZORPAY_PLAN_1Y_ID';
};

/** Fixed Pro packages shown on the paywall. Amounts are INR. */
export const PRO_PLANS: ProPlanDefinition[] = [
  {
    code: 'SIX_MONTH',
    label: '6 months',
    durationMonths: 6,
    amountPaise: 99900,
    amountInr: 999,
    razorpayPlanIdEnv: 'RAZORPAY_PLAN_6M_ID',
  },
  {
    code: 'ONE_YEAR',
    label: '1 year',
    durationMonths: 12,
    amountPaise: 179900,
    amountInr: 1799,
    razorpayPlanIdEnv: 'RAZORPAY_PLAN_1Y_ID',
  },
];

export function proPlanByCode(code: string): ProPlanDefinition | undefined {
  return PRO_PLANS.find((p) => p.code === code);
}
