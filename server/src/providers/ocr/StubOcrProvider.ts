import type { OcrResult } from "../../domain/types.js";
import type { OcrProvider } from "./OcrProvider.js";
import { sleep } from "../../lib/sleep.js";

// Canned "extractions" — a spread of scammy and legit SMS so different
// screenshots produce believable, varied results.
const SAMPLES: OcrResult[] = [
  {
    senderId: "GCASH",
    confidence: 0.97,
    text: "GCash Alert: Your account has been temporarily suspended due to unusual activity. Verify your identity within 24 hours to avoid permanent deactivation: https://gcash-verify.top/login",
  },
  {
    senderId: "PHLPost",
    confidence: 0.95,
    text: "PHLPost: Package #PH-88213 is held at customs. Pay the PHP 145.00 release fee within 48 hrs or it will be returned to sender: https://phlpost-release.xyz/pay",
  },
  {
    senderId: "SHOPEE-PH",
    confidence: 0.96,
    text: "CONGRATULATIONS! You WON P50,000 in the Shopee 12.12 raffle draw! Claim your prize now at https://bit.ly/shp-claim50k — just reply with your full name and address. Questions? Call 09175551234",
  },
  {
    senderId: "PesoLoan",
    confidence: 0.94,
    text: "URGENT! Your P25,000 cash loan has been APPROVED. No collateral needed, release in 5 minutes. Disburse now at https://peso-fast.loan/app or call 09987654321",
  },
  {
    senderId: "BDO",
    confidence: 0.98,
    text: "BDO: Your one-time PIN is 482913. It expires in 5 minutes. Never share this code with anyone. If you did not request this, call our hotline at 8702-6000.",
  },
];

export class StubOcrProvider implements OcrProvider {
  async extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrResult> {
    await sleep(700);
    // Deterministic pick so the same screenshot always "reads" the same.
    const pick = input.bytes.length === 0 ? 0 : input.bytes[0] % SAMPLES.length;
    return { ...SAMPLES[pick] };
  }
}
