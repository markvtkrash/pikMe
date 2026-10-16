import { transcriptFrom, VOICE_PERMISSION_MESSAGE } from './voiceSearch';

describe('transcriptFrom', () => {
  it('takes the best guess', () => {
    expect(transcriptFrom({ results: [{ transcript: 'pizza near me' }, { transcript: 'piza near me' }] })).toBe('pizza near me');
  });
  it('tidies spaces and a closing full stop', () => {
    expect(transcriptFrom({ results: [{ transcript: '  Thai   food. ' }] })).toBe('Thai food');
    expect(transcriptFrom({ results: [{ transcript: 'tacos?!' }] })).toBe('tacos');
  });
  it('is null when there is nothing to search for', () => {
    expect(transcriptFrom(null)).toBeNull();
    expect(transcriptFrom(undefined)).toBeNull();
    expect(transcriptFrom({})).toBeNull();
    expect(transcriptFrom({ results: [] })).toBeNull();
    expect(transcriptFrom({ results: [{ transcript: '   ' }] })).toBeNull();
    expect(transcriptFrom({ results: [{ transcript: '...' }] })).toBeNull();
    expect(transcriptFrom({ results: [{}] })).toBeNull();
  });
  it('has a plain message for a refused permission', () => {
    expect(VOICE_PERMISSION_MESSAGE).toMatch(/microphone/);
  });
});
