import type { AnalysisResult, Verdict } from "../../domain/types.js";
import type { ScamAnalyzer } from "./ScamAnalyzer.js";
import {
  extractPhoneNumbers,
  extractUrls,
  hostnameOf,
} from "../../domain/extract.js";
import { brandsMentioned, hostIsOfficial } from "../../domain/brands.js";
import { classifyUrl } from "../threatintel/StubUrlThreatIntel.js";
import { sleep } from "../../lib/sleep.js";

interface Signal {
  points: number;
  reason: string;
}

const SHORTENERS = /\b(bit\.ly|tinyurl|cutt\.ly|rebrand\.ly|rb\.gy|goo\.gl|is\.gd|buff\.ly|ow\.ly|shorturl\.at|tiny\.cc)\b/i;

function quote(m: RegExpMatchArray | null): string {
  return m ? `"${m[0]}"` : "";
}

// Heuristic stand-in for the real LLM analyzer. Produces a weighted score
// from human-readable signals so results look like a real model's output.
export class StubScamAnalyzer implements ScamAnalyzer {
  async analyze(input: {
    text: string;
    senderId?: string | null;
  }): Promise<AnalysisResult> {
    await sleep(500);

    const { text } = input;
    const signals: Signal[] = [];
    const urls = extractUrls(text);
    const phones = extractPhoneNumbers(text);

    const add = (re: RegExp, points: number, reason: (m: RegExpMatchArray | null) => string) => {
      const m = text.match(re);
      if (m) signals.push({ points, reason: reason(m) });
    };

    add(
      /\b(urgent|immediately|right now|within\s+\d+\s*(?:hours?|hrs?|minutes?|mins?|days?)|expires?|expiring|suspended|suspension|locked|blocked|frozen|deactivat\w*|final\s+(?:notice|warning)|last\s+(?:chance|warning)|act\s+now|avoid\s+(?:penalty|closure|deactivation|permanent)|limited\s+time)\b/i,
      30,
      (m) => `Creates urgency or threatens account action (${quote(m)})`,
    );
    add(
      /\bverify\s+(?:your\s+)?(?:identity|account|number|otp|details)\b/i,
      16,
      (m) => `Asks you to verify your account (${quote(m)})`,
    );
    add(
      /\b(congratulations|you(?:'ve| have)?\s+won|winner|prize|claim\s+(?:your|now|it)|raffle|jackpot|reward|lucky\s+\w+|selected\s+(?:as|to)|free\s+(?:gift|iphone|cash|money|load))\b/i,
      25,
      (m) => `Promises a prize or reward (${quote(m)})`,
    );
    add(
      /\b(loan|pre-?approved|no\s+collateral|disburse|easy\s+cash|pera|pautang|lending|cash\s+advance|0%\s+interest)\b/i,
      18,
      (m) => `Offers a loan or instant cash (${quote(m)})`,
    );
    add(
      /\b(send|share|enter|reply|provide|give|input|submit|text\s+back)\b.{0,40}\b(otp|one[-\s]?time|password|passcode|pin|mpin|cvv|card\s+number|account\s+number|verification\s+code|full\s+name|address|birthday|id\s+number)\b/is,
      32,
      (m) => `Requests sensitive information (${quote(m)})`,
    );
    add(
      /\b(processing\s+fee|release\s+fee|customs\s+(?:fee|charge|duty)|redelivery|payment\s+of|service\s+charge|shipping\s+fee|pay\s+(?:the\s+)?php)\b/i,
      12,
      (m) => `Asks for a payment or fee (${quote(m)})`,
    );
    add(
      /\b(click|tap|open)\s+(?:the\s+)?(?:link|here|this)\b|\bcall\s+(?:this\s+number|now|back)\b|\breply\s+(?:stop|yes|now)\b/i,
      8,
      (m) => `Pushes you to click a link or reply (${quote(m)})`,
    );

    // Brand impersonation
    const mentioned = brandsMentioned(text);
    for (const brand of mentioned.slice(0, 2)) {
      signals.push({ points: 15, reason: `Mentions ${brand.label}, a brand scammers often impersonate` });
    }
    for (const brand of mentioned) {
      const foreign = urls
        .map((u) => hostnameOf(u))
        .filter((h): h is string => !!h && !hostIsOfficial(h, brand));
      if (foreign.length > 0) {
        signals.push({
          points: 25,
          reason: `Links to ${foreign[0]}, which is not ${brand.label}'s official domain`,
        });
        break;
      }
    }

    // Suspicious links
    let flagged = 0;
    for (const url of urls) {
      const host = hostnameOf(url) ?? url;
      if (classifyUrl(url)) {
        if (SHORTENERS.test(host)) {
          signals.push({ points: 12, reason: `Hides the real destination behind a link shortener (${host})` });
        } else {
          signals.push({ points: 22, reason: `Links to a suspicious domain (${host})` });
        }
        flagged++;
      }
      if (flagged >= 2) break;
    }

    // Legit protective phrasing pulls the score down
    add(
      /\b(never\s+share|do\s+not\s+share|will\s+never\s+ask)\b/i,
      -25,
      () => "Includes typical legitimate safety advice",
    );

    const score = Math.max(
      0,
      signals.reduce((sum, s) => sum + s.points, 0),
    );

    let verdict: Verdict;
    let confidence: number;
    if (score >= 60) {
      verdict = "MALICIOUS";
      confidence = Math.min(96, 70 + score - 60);
    } else if (score >= 25) {
      verdict = "SUSPICIOUS";
      confidence = Math.min(85, 58 + (score - 25));
    } else {
      verdict = "SAFE";
      confidence = Math.min(94, 80 + (24 - Math.min(score, 24)));
    }

    const reasons = signals
      .filter((s) => s.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 4)
      .map((s) => s.reason);
    if (verdict === "SAFE") {
      const protective = signals.find((s) => s.points < 0);
      if (protective) reasons.push(protective.reason);
      if (reasons.length === 0) {
        reasons.push("No common scam indicators detected");
      }
    }

    return {
      verdict,
      confidence,
      reasons: reasons.slice(0, 5),
      entities: {
        senderId: input.senderId ?? null,
        urls,
        phoneNumbers: phones,
      },
    };
  }
}
