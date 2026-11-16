// Keyword-derived scam type for aggregate trend reporting. The category is
// computed once per scan and stored on the row; dashboards only ever read the
// category name, never the message text.
const RULES: [string, RegExp][] = [
  ["gcash_bank", /gcash|maya\b|paymaya|paypal|\bbdo\b|\bbpi\b|metrobank|unionbank|landbank|security bank|otp|one-time pin|account (?:has been |is )?(?:locked|suspended|limited)|verify your account/i],
  ["fake_delivery", /deliver(?:y|ed|ing)?|package|parcel|courier|lbc|j\s*&\s*t|jnt|ninja\s*van|flash express|shopee|lazada|customs|shipping fee|redelivery/i],
  ["job_offer", /job offer|hiring|part[\s-]?time|work from home|earn (?:money|php|₱|\d)|daily income|salary|commission|recruit(?:er|ing)?|task-based/i],
  ["prize", /prize|winner|you (?:have )?won|congratulations|claim your|raffle|reward|free (?:iphone|load|data)|lucky draw/i],
];

export function scamCategory(text: string): string | null {
  for (const [category, pattern] of RULES) if (pattern.test(text)) return category;
  return null;
}
