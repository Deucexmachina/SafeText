export function resetEmail(input: {
  code: string;
  expiresMinutes: number;
}): { subject: string; text: string } {
  return {
    subject: "Your SafeText password reset code",
    text: [
      "Someone requested a password reset for your SafeText account.",
      "",
      `Verification code: ${input.code}`,
      "",
      `The code expires in ${input.expiresMinutes} minutes and can only be used once.`,
      "If this wasn't you, ignore this email — your password stays unchanged.",
    ].join("\n"),
  };
}
