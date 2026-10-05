import { describe, expect, it } from 'vitest';
import { adState, EMPTY_AD_FORM, fromAd, fromLocalInput, isHttpUrl, toAdPayload, toLocalInput, validateAdForm, type AdFormValues } from './ad-form';
import type { Ad } from './types';

const valid: AdFormValues = {
  ...EMPTY_AD_FORM,
  title: '  Summer offer ',
  imageUrl: 'https://cdn.example.com/banner.png',
  clickUrl: 'https://example.com/offer',
  priority: '10',
  isActive: true,
};

describe('validateAdForm', () => {
  it('accepts a complete form', () => {
    expect(validateAdForm(valid)).toEqual({});
  });

  it('requires title and both URLs', () => {
    const errors = validateAdForm({ ...EMPTY_AD_FORM, title: '   ' });
    expect(errors.title).toBe('Title is required.');
    expect(errors.imageUrl).toBe('URL is required.');
    expect(errors.clickUrl).toBe('URL is required.');
  });

  it('rejects non-http URLs and over-long values', () => {
    expect(validateAdForm({ ...valid, imageUrl: 'javascript:alert(1)' }).imageUrl).toMatch(/http/);
    expect(validateAdForm({ ...valid, clickUrl: 'ftp://example.com' }).clickUrl).toMatch(/http/);
    expect(validateAdForm({ ...valid, clickUrl: 'example.com' }).clickUrl).toMatch(/http/);
    expect(validateAdForm({ ...valid, title: 'x'.repeat(192) }).title).toMatch(/191/);
    expect(validateAdForm({ ...valid, imageUrl: `https://example.com/${'a'.repeat(510)}` }).imageUrl).toMatch(/512/);
  });

  it('checks priority is a whole number within range', () => {
    expect(validateAdForm({ ...valid, priority: '' }).priority).toMatch(/whole number/);
    expect(validateAdForm({ ...valid, priority: '1.5' }).priority).toMatch(/whole number/);
    expect(validateAdForm({ ...valid, priority: '-1' }).priority).toMatch(/between/);
    expect(validateAdForm({ ...valid, priority: '10001' }).priority).toMatch(/between/);
    expect(validateAdForm({ ...valid, priority: '10000' }).priority).toBeUndefined();
  });

  it('rejects an end before the start', () => {
    expect(validateAdForm({ ...valid, startAt: '2026-10-02T10:00', endAt: '2026-10-01T10:00' }).endAt).toMatch(/after the start/);
    expect(validateAdForm({ ...valid, startAt: '2026-10-01T10:00', endAt: '2026-10-01T10:00' }).endAt).toBeUndefined();
  });

  it('rejects an unknown placement', () => {
    expect(validateAdForm({ ...valid, placement: 'POPUP' as never }).placement).toBeDefined();
  });
});

describe('payload conversion', () => {
  it('trims strings, converts priority and maps empty dates to null', () => {
    expect(toAdPayload(valid)).toEqual({
      title: 'Summer offer',
      imageUrl: 'https://cdn.example.com/banner.png',
      clickUrl: 'https://example.com/offer',
      placement: 'HOME_BANNER',
      priority: 10,
      isActive: true,
      startAt: null,
      endAt: null,
    });
  });

  it('round-trips datetime-local values through ISO', () => {
    const iso = fromLocalInput('2026-10-01T14:30');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(toLocalInput(iso)).toBe('2026-10-01T14:30');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
    expect(toLocalInput(null)).toBe('');
  });

  it('fills the form from an existing ad', () => {
    const ad: Ad = {
      id: 'a1',
      title: 'T',
      imageUrl: 'https://i.example.com/a.png',
      clickUrl: 'https://example.com',
      placement: 'MATCH_LIST',
      priority: 3,
      isActive: false,
      isVisibleNow: false,
      startAt: null,
      endAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(fromAd(ad)).toEqual({ title: 'T', imageUrl: ad.imageUrl, clickUrl: ad.clickUrl, placement: 'MATCH_LIST', priority: '3', isActive: false, startAt: '', endAt: '' });
  });
});

describe('isHttpUrl', () => {
  it('accepts only http(s) URLs with a host', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/a')).toBe(true);
    expect(isHttpUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
  });
});

describe('adState', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  it('derives the display state from isActive and the schedule', () => {
    expect(adState({ isActive: false, startAt: null, endAt: null }, now)).toBe('inactive');
    expect(adState({ isActive: true, startAt: null, endAt: null }, now)).toBe('visible');
    expect(adState({ isActive: true, startAt: '2026-10-02T00:00:00Z', endAt: null }, now)).toBe('scheduled');
    expect(adState({ isActive: true, startAt: null, endAt: '2026-09-30T00:00:00Z' }, now)).toBe('expired');
    expect(adState({ isActive: true, startAt: '2026-09-30T00:00:00Z', endAt: '2026-10-02T00:00:00Z' }, now)).toBe('visible');
  });
});
