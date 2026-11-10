/** The server's minimum (PASSWORD_MIN_LENGTH defaults to 8 and is never lower). */
export const PASSWORD_MIN_LENGTH = 8

export type PasswordCheck = { id: 'length' | 'match'; label: string; ok: boolean }

/** What the sign-up form tells the person as they type — only rules the server actually enforces. */
export function passwordChecks(password: string, confirm: string): PasswordCheck[] {
  return [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH}+ characters`, ok: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'match', label: 'Passwords match', ok: password.length > 0 && password === confirm },
  ]
}
