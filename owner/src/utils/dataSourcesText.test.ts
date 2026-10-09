import {
  DATA_SOURCES_FOOTER, DATA_SOURCES_POINTS, DATA_SOURCES_TITLE, GOOGLE_RESULTS_ATTRIBUTION,
} from './dataSourcesText';

describe('owner data-source wording', () => {
  const all = [DATA_SOURCES_TITLE, ...DATA_SOURCES_POINTS, DATA_SOURCES_FOOTER, GOOGLE_RESULTS_ATTRIBUTION].join(' ');

  it('names Google Maps as the source of the listing details', () => {
    expect(DATA_SOURCES_POINTS.join(' ')).toMatch(/Google Maps/);
    expect(GOOGLE_RESULTS_ATTRIBUTION).toMatch(/Powered by Google/);
  });

  it('says nutrition values are estimates unless the owner verifies them', () => {
    expect(DATA_SOURCES_POINTS.join(' ')).toMatch(/estimates unless you verify/);
  });

  it('tells chain owners the menu is central and how to ask for a correction (a Support Ticket)', () => {
    expect(DATA_SOURCES_POINTS.join(' ')).toMatch(/chain/);
    expect(DATA_SOURCES_POINTS.join(' ')).toMatch(/managed centrally/);
    expect(DATA_SOURCES_POINTS.join(' ')).toMatch(/Support Ticket/);
  });

  it('says it is not affiliated with Google, and does not claim to record any agreement', () => {
    expect(DATA_SOURCES_FOOTER).toMatch(/Not affiliated with or endorsed by Google/);
    expect(all).not.toMatch(/\bagree\b|\bconsent\b/i);
  });

  it('has no empty or repeated lines', () => {
    expect(DATA_SOURCES_POINTS.every((p) => p.trim().length > 20)).toBe(true);
    expect(new Set(DATA_SOURCES_POINTS).size).toBe(DATA_SOURCES_POINTS.length);
  });
});
