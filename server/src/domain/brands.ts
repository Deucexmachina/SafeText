// Brands commonly impersonated in PH smishing, mapped to their official
// domains. Used by the stub analyzer and threat-intel adapters.
export interface Brand {
  label: string;
  aliases: string[];
  officialDomains: string[];
}

export const BRANDS: Brand[] = [
  { label: "GCash", aliases: ["gcash"], officialDomains: ["gcash.com", "gcash.ph"] },
  { label: "Maya", aliases: ["maya", "paymaya"], officialDomains: ["maya.ph", "paymaya.com"] },
  { label: "BDO", aliases: ["bdo"], officialDomains: ["bdo.com.ph"] },
  { label: "BPI", aliases: ["bpi"], officialDomains: ["bpi.com.ph"] },
  { label: "Metrobank", aliases: ["metrobank"], officialDomains: ["metrobank.com.ph"] },
  { label: "UnionBank", aliases: ["unionbank"], officialDomains: ["unionbankph.com"] },
  { label: "LANDBANK", aliases: ["landbank"], officialDomains: ["landbank.com", "landbank.gov.ph"] },
  { label: "Globe", aliases: ["globe"], officialDomains: ["globe.com.ph"] },
  { label: "Smart", aliases: ["smart"], officialDomains: ["smart.com.ph"] },
  { label: "DITO", aliases: ["dito"], officialDomains: ["dito.ph"] },
  { label: "Shopee", aliases: ["shopee"], officialDomains: ["shopee.ph", "shopee.com"] },
  { label: "Lazada", aliases: ["lazada"], officialDomains: ["lazada.com.ph", "lazada.com"] },
  { label: "DHL", aliases: ["dhl"], officialDomains: ["dhl.com"] },
  { label: "FedEx", aliases: ["fedex"], officialDomains: ["fedex.com"] },
  { label: "PHLPost", aliases: ["phlpost", "philpost"], officialDomains: ["phlpost.gov.ph"] },
  { label: "LBC", aliases: ["lbc"], officialDomains: ["lbcexpress.com"] },
  { label: "J&T Express", aliases: ["j&t", "jnt", "jtexpress"], officialDomains: ["jtexpress.ph"] },
  { label: "PayPal", aliases: ["paypal"], officialDomains: ["paypal.com"] },
  { label: "Netflix", aliases: ["netflix"], officialDomains: ["netflix.com"] },
  { label: "Amazon", aliases: ["amazon"], officialDomains: ["amazon.com"] },
  { label: "SSS", aliases: ["sss"], officialDomains: ["sss.gov.ph"] },
  { label: "PhilHealth", aliases: ["philhealth"], officialDomains: ["philhealth.gov.ph"] },
  { label: "BIR", aliases: ["bir"], officialDomains: ["bir.gov.ph"] },
];

export function brandsMentioned(text: string): Brand[] {
  const lower = text.toLowerCase();
  return BRANDS.filter((b) =>
    b.aliases.some((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)),
  );
}

export function hostIsOfficial(host: string, brand: Brand): boolean {
  return brand.officialDomains.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}
