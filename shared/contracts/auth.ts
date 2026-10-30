export type SessionDto = { viewer: 'guest' } | { viewer: 'admin'; email: string }
export interface CsrfDto {
  token: string
}
