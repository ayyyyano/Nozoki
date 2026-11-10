export function usageRecord(timestamp = '2026-11-10T00:30:00.000Z') {
  return {
    timestamp,
    latency_ms: 123,
    source: 'synthetic-account',
    auth_index: 'a1',
    tokens: {
      input_tokens: 100,
      output_tokens: 20,
      reasoning_tokens: 5,
      cached_tokens: 30,
      total_tokens: 120,
    },
    failed: false,
    provider: 'codex',
    model: 'synthetic-model',
    alias: '',
    endpoint: '/v1/responses',
    auth_type: 'oauth',
    request_id: 'synthetic-request',
  }
}
