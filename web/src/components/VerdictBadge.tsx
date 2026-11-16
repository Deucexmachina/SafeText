import type { ScanStatus, Verdict } from "../api";
import { VerdictTag, verdictKind } from "./verdict";

/* Badge with icon + label. A finished scan without a verdict reads as Inconclusive. */
export function VerdictBadge({ value }: { value: Verdict | ScanStatus | null }) {
  return <VerdictTag kind={verdictKind(value)} />;
}
