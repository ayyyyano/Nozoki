// Explicit offline fixtures. Never inserted into the daily database.
export const tailscaleFixture = () => ({
  devices: [
    {
      id: 'legacy-1',
      nodeId: 'n-fixture-online',
      hostname: 'Fixture laptop',
      connectedToControl: true,
      addresses: ['100.64.1.2', 'fd7a:115c:a1e0::2'],
      user: 'private@example.invalid',
      nodeKey: 'private-node-key',
    },
    {
      nodeId: 'n-fixture-offline',
      hostname: 'Fixture server',
      connectedToControl: false,
      lastSeen: '2026-11-02T00:00:00Z',
      addresses: ['100.64.1.3'],
    },
    { nodeId: 'n-fixture-unknown', hostname: 'Fixture unknown', addresses: [] },
  ],
})
export const tailscaleCredentials = JSON.stringify({
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
})
