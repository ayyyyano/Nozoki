declare module '#nozoki-cloudflare-entry' {
  const worker: {
    fetch(request: Request, env: unknown, context: unknown): Promise<Response>
    [key: string]: unknown
  }
  export default worker
}
