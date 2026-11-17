// Localized result-card guidance. English is the default; the Filipino set is
// conversational Taglish, matching how local scam texts actually read.
export type Lang = "en" | "tl";

export const strings = {
  en: {
    whatNext: "What to do next",
    riskyNote: "Risky words and links are highlighted.",
    wasRight: "Was this right?",
    yes: "Yes",
    no: "No — report",
    thanks: "Thanks — your report was sent to the SafeText team.",
    thanksConfirm: "Thanks for confirming.",
    steps: {
      MALICIOUS: [
        "Do not click the link or reply to the message.",
        "Never share your OTP, password, or PIN — no real company asks for them.",
        "Block the sender's number.",
        "Report it to the CICC hotline 1326, or to your bank or GCash through their official app.",
        "Already sent money or details? Call your bank right away to flag the transaction.",
      ],
      SUSPICIOUS: [
        "Verify first — open the official app or type the website yourself instead of tapping the link.",
        "Do not share your OTP or password with anyone.",
        "Not sure it is real? Do not proceed with the transaction.",
        "Report repeated texts to the CICC hotline 1326.",
      ],
      SAFE: [
        "This looks safe, but stay careful anyway.",
        "Still avoid sharing your OTP or password.",
        "If there is a link, typing the website yourself is always safer.",
      ],
      INCONCLUSIVE: [
        "The check did not finish — try again or paste the message text.",
        "Until you have a result, do not click any link in the message.",
      ],
    } as Record<string, string[]>,
  },
  tl: {
    whatNext: "Ano ang gagawin ko?",
    riskyNote: "Naka-highlight ang mga delikadong salita at link.",
    wasRight: "Tama ba ang resulta?",
    yes: "Tama",
    no: "Mali — i-report",
    thanks: "Salamat — naipadala ang report mo sa SafeText team.",
    thanksConfirm: "Salamat sa pagkumpirma.",
    steps: {
      MALICIOUS: [
        "Huwag i-click ang link at huwag mag-reply sa mensahe.",
        "Huwag ibahagi ang OTP, password, o PIN — walang lehitimong kumpanya na humihingi nito.",
        "I-block ang number ng nagpadala.",
        "I-report sa CICC hotline 1326, o sa iyong banko o GCash gamit ang official app.",
        "Nakapagpadala ka na ba ng pera o info? Tawagan agad ang banko mo.",
      ],
      SUSPICIOUS: [
        "I-verify muna — buksan ang official app o i-type mismo ang website sa halip na i-tap ang link.",
        "Huwag ibigay ang OTP o password kahit kanino.",
        "Kung hindi ka sigurado, huwag ituloy ang transaction.",
        "Kung paulit-ulit ang mga text, i-report sa CICC hotline 1326.",
      ],
      SAFE: [
        "Mukhang ligtas ang mensahe, pero mag-ingat pa rin.",
        "Huwag pa ring ibahagi ang OTP o password.",
        "Kung may link, mas ligtas i-type mismo ang website sa browser.",
      ],
      INCONCLUSIVE: [
        "Hindi natapos ang pagsusuri — subukan ulit o i-paste ang text ng mensahe.",
        "Habang wala pang resulta, huwag munang i-click ang anumang link.",
      ],
    } as Record<string, string[]>,
  },
} as const;
