// Delivers account email, currently just the password-reset code.
export interface EmailSender {
  sendPasswordResetCode(input: {
    to: string;
    code: string;
    expiresMinutes: number;
  }): Promise<void>;
}
