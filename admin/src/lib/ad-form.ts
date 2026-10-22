import { AD_PLACEMENTS, type Ad, type AdPayload, type AdPlacement } from './types';

/** Mirrors the backend CreateAdDto rules so most mistakes are caught before submitting. */
export const AD_LIMITS = { titleMax: 191, urlMax: 512, priorityMin: 0, priorityMax: 10_000 } as const;

export const AD_DURATION_PRESETS = [
  { value: '1', label: '1 hour' },
  { value: '2', label: '2 hours' },
  { value: '3', label: '3 hours' },
  { value: '6', label: '6 hours' },
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
  { value: 'custom', label: 'Custom schedule' },
] as const;

export type AdDurationPreset = (typeof AD_DURATION_PRESETS)[number]['value'];
export type AdImageMode = 'upload' | 'url';

export interface AdFormValues {
  title: string;
  imageUrl: string;
  clickUrl: string;
  placement: AdPlacement;
  priority: string;
  isActive: boolean;
  /** `datetime-local` value in the browser's time zone, or ''. */
  startAt: string;
  endAt: string;
  /** How the image is provided in the UI (not sent to the API). */
  imageMode: AdImageMode;
  /** Duration preset for new/edit scheduling (not sent to the API). */
  durationPreset: AdDurationPreset;
}

export type AdFormErrors = Partial<Record<keyof AdFormValues, string>>;

export const EMPTY_AD_FORM: AdFormValues = {
  title: '',
  imageUrl: '',
  clickUrl: '',
  placement: 'HOME',
  priority: '0',
  isActive: true,
  startAt: '',
  endAt: '',
  imageMode: 'upload',
  durationPreset: 'custom',
};

const pad = (value: number) => String(value).padStart(2, '0');

/** ISO -> `YYYY-MM-DDTHH:mm` in local time, for `<input type="datetime-local">`. */
export function toLocalInput(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value (local time) -> ISO in UTC, or null when empty/invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Apply a duration preset: start = now, end = now + hours (unless custom). */
export function applyDurationPreset(preset: AdDurationPreset, now = new Date()): Pick<AdFormValues, 'startAt' | 'endAt' | 'durationPreset'> {
  if (preset === 'custom') {
    return { durationPreset: 'custom', startAt: '', endAt: '' };
  }
  const hours = Number(preset);
  const start = new Date(now);
  const end = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return {
    durationPreset: preset,
    startAt: toLocalInput(start.toISOString()),
    endAt: toLocalInput(end.toISOString()),
  };
}

export function validateAdForm(values: AdFormValues): AdFormErrors {
  const errors: AdFormErrors = {};
  const title = values.title.trim();
  if (!title) {
    errors.title = 'Title is required.';
  } else if (title.length > AD_LIMITS.titleMax) {
    errors.title = `Title must be at most ${AD_LIMITS.titleMax} characters.`;
  }

  for (const field of ['imageUrl', 'clickUrl'] as const) {
    const value = values[field].trim();
    if (!value) {
      errors[field] = field === 'imageUrl' ? 'Upload an image or paste an image URL.' : 'URL is required.';
    } else if (!isHttpUrl(value)) {
      errors[field] = 'Enter a full http:// or https:// URL.';
    } else if (value.length > AD_LIMITS.urlMax) {
      errors[field] = `URL must be at most ${AD_LIMITS.urlMax} characters.`;
    }
  }

  if (!AD_PLACEMENTS.includes(values.placement)) {
    errors.placement = 'Choose a placement.';
  }

  const priority = Number(values.priority);
  if (values.priority.trim() === '' || !Number.isInteger(priority)) {
    errors.priority = 'Priority must be a whole number.';
  } else if (priority < AD_LIMITS.priorityMin || priority > AD_LIMITS.priorityMax) {
    errors.priority = `Priority must be between ${AD_LIMITS.priorityMin} and ${AD_LIMITS.priorityMax}.`;
  }

  const startAt = fromLocalInput(values.startAt);
  const endAt = fromLocalInput(values.endAt);
  if (values.startAt && !startAt) {
    errors.startAt = 'Invalid date.';
  }
  if (values.endAt && !endAt) {
    errors.endAt = 'Invalid date.';
  }
  if (values.durationPreset !== 'custom' && !values.endAt) {
    errors.endAt = 'Choose how long this ad should run.';
  }
  if (startAt && endAt && Date.parse(endAt) < Date.parse(startAt)) {
    errors.endAt = 'End must be after the start.';
  }
  return errors;
}

export function toAdPayload(values: AdFormValues): AdPayload {
  return {
    title: values.title.trim(),
    imageUrl: values.imageUrl.trim(),
    clickUrl: values.clickUrl.trim(),
    placement: values.placement,
    priority: Number(values.priority),
    isActive: values.isActive,
    startAt: fromLocalInput(values.startAt),
    endAt: fromLocalInput(values.endAt),
  };
}

export function fromAd(ad: Ad): AdFormValues {
  return {
    title: ad.title,
    imageUrl: ad.imageUrl,
    clickUrl: ad.clickUrl,
    placement: ad.placement,
    priority: String(ad.priority),
    isActive: ad.isActive,
    startAt: toLocalInput(ad.startAt),
    endAt: toLocalInput(ad.endAt),
    imageMode: 'url',
    durationPreset: 'custom',
  };
}

export function newAdForm(now = new Date()): AdFormValues {
  return {
    ...EMPTY_AD_FORM,
    ...applyDurationPreset('3', now),
  };
}

export type AdState = 'visible' | 'scheduled' | 'expired' | 'inactive';

export function adState(ad: Pick<Ad, 'isActive' | 'startAt' | 'endAt'>, now = Date.now()): AdState {
  if (!ad.isActive) {
    return 'inactive';
  }
  if (ad.endAt && Date.parse(ad.endAt) < now) {
    return 'expired';
  }
  if (ad.startAt && Date.parse(ad.startAt) > now) {
    return 'scheduled';
  }
  return 'visible';
}
