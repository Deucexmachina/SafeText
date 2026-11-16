// Delivers account email, currently just the password-reset code.
export interface EmailSender {
  readonly configured: boolean;
  sendPasswordResetCode(input: {
    to: string;
    code: string;
    expiresMinutes: number;
  }): Promise<void>;
}
