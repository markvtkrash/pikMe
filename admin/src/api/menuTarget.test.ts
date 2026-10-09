jest.mock('./supabase', () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn(), rpc: jest.fn() } }));

import { extractMenuFromImage, extractMenuFromText } from './restaurantAuth';

function mockFetch(status: number, body: any) {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function sentBody(): any {
  const [, options] = (global.fetch as jest.Mock).mock.calls[0];
  return JSON.parse(options.body);
}

beforeEach(() => jest.clearAllMocks());

describe('extractMenuFromImage / extractMenuFromText: who the menu is for', () => {
  it('sends a claimed restaurant\'s id as restaurantId, as before', async () => {
    mockFetch(200, { success: true, itemCount: 3 });
    await extractMenuFromImage('r1', 'Joe', 'data:image/jpeg;base64,AAA', 'tok');
    expect(sentBody()).toMatchObject({ restaurantId: 'r1', restaurantName: 'Joe', imageBase64: 'data:image/jpeg;base64,AAA' });
    expect(sentBody()).not.toHaveProperty('placeId');

    mockFetch(200, { success: true, itemCount: 2 });
    await extractMenuFromText('r1', 'Joe', 'Burger', 'tok');
    expect(sentBody()).toMatchObject({ restaurantId: 'r1', restaurantName: 'Joe', menuText: 'Burger' });
    expect(sentBody()).not.toHaveProperty('placeId');
  });

  it('sends a restaurant nobody has claimed by its Google place ID, with no restaurantId', async () => {
    mockFetch(200, { success: true, itemCount: 3 });
    await extractMenuFromImage({ placeId: 'ChIJabcdefghij' }, 'Jalapenos', 'data:image/jpeg;base64,AAA', 'tok');
    expect(sentBody()).toMatchObject({ placeId: 'ChIJabcdefghij', restaurantName: 'Jalapenos' });
    expect(sentBody()).not.toHaveProperty('restaurantId');

    mockFetch(200, { success: true, itemCount: 2 });
    await extractMenuFromText({ placeId: 'ChIJabcdefghij' }, 'Jalapenos', 'Tacos', 'tok', true, [{ name: 'Taco' }]);
    expect(sentBody()).toMatchObject({ placeId: 'ChIJabcdefghij', restaurantName: 'Jalapenos', menuText: 'Tacos', force: true, items: [{ name: 'Taco' }] });
    expect(sentBody()).not.toHaveProperty('restaurantId');
  });

  it('sends the admin\'s login with the request, and throws the server\'s message on failure', async () => {
    mockFetch(403, { error: 'Forbidden' });
    await expect(extractMenuFromText({ placeId: 'ChIJabcdefghij' }, 'Jalapenos', 'Tacos', 'tok')).rejects.toThrow('Forbidden');
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer tok');
  });
});
