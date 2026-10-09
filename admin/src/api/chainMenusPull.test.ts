jest.mock('./supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));
jest.mock('./reports', () => ({
  fetchAllPages: jest.fn(),
}));

import { pullChainMenuNow } from './chainMenus';

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = fetchMock;
});

function response(ok: boolean, status: number, body: unknown, jsonThrows = false) {
  return {
    ok,
    status,
    json: jsonThrows ? () => Promise.reject(new Error('not json')) : () => Promise.resolve(body),
  };
}

describe('pullChainMenuNow', () => {
  it('asks the function to build the chain now, using the admin token and a forced pull', async () => {
    fetchMock.mockResolvedValue(response(true, 200, { status: 'ok', itemCount: 30, chain: 'Taco Bell' }));
    await pullChainMenuNow('chain-1', 'admin-token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/get-chain-menu$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer admin-token');
    expect(JSON.parse(init.body)).toEqual({ chainId: 'chain-1', force: true });
  });

  it('returns the function result', async () => {
    fetchMock.mockResolvedValue(response(true, 200, { status: 'ok', itemCount: 30, chain: 'Taco Bell' }));
    await expect(pullChainMenuNow('c', 't')).resolves.toEqual({ status: 'ok', itemCount: 30, chain: 'Taco Bell' });
  });

  it('throws the server error message (for example a non-admin)', async () => {
    fetchMock.mockResolvedValue(response(false, 403, { error: 'Forbidden' }));
    await expect(pullChainMenuNow('c', 't')).rejects.toThrow('Forbidden');
  });

  it('explains a failure that has no JSON body (the server cancelled a slow request)', async () => {
    fetchMock.mockResolvedValue(response(false, 546, null, true));
    await expect(pullChainMenuNow('c', 't')).rejects.toThrow(/did not finish \(HTTP 546\)/);
  });

  it('turns a client-side timeout into a plain message', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(pullChainMenuNow('c', 't')).rejects.toThrow(/taking longer than expected/);
  });

  it('passes other network errors through unchanged', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));
    await expect(pullChainMenuNow('c', 't')).rejects.toThrow('Network request failed');
  });
});
