'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, FormError, Select, TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import {
  AD_DURATION_PRESETS,
  AD_LIMITS,
  applyDurationPreset,
  fromAd,
  isHttpUrl,
  newAdForm,
  toAdPayload,
  validateAdForm,
  type AdDurationPreset,
  type AdFormErrors,
  type AdFormValues,
  type AdImageMode,
} from '@/lib/ad-form';
import { ApiError, apiRequest, apiUpload } from '@/lib/api';
import { AD_PLACEMENT_LABELS, AD_PLACEMENTS, type Ad, type AdPlacement } from '@/lib/types';

const FORM_ID = 'ad-form';

/** Maps backend validation messages ("imageUrl must be a URL…") onto form fields. */
function serverFieldErrors(error: ApiError): AdFormErrors {
  const fields: Array<keyof AdFormValues> = ['title', 'imageUrl', 'clickUrl', 'placement', 'priority', 'isActive', 'startAt', 'endAt'];
  const result: AdFormErrors = {};
  for (const message of error.errors) {
    const field = fields.find((name) => message.startsWith(`${name} `));
    if (field && !result[field]) {
      result[field] = message;
    }
  }
  return result;
}

interface AdFormModalProps {
  /** `null` creates a new ad. */
  ad: Ad | null;
  onClose: () => void;
  onSaved: (ad: Ad) => void;
}

/** Mount with a `key` per ad so the form resets when switching between ads. */
export function AdFormModal({ ad, onClose, onSaved }: AdFormModalProps) {
  const [values, setValues] = useState<AdFormValues>(() => (ad ? fromAd(ad) : newAdForm()));
  const [errors, setErrors] = useState<AdFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof AdFormValues>(key: K, value: AdFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    if (key === 'imageUrl') {
      setPreviewFailed(false);
    }
  };

  const setImageMode = (mode: AdImageMode) => {
    setValues((current) => ({ ...current, imageMode: mode }));
    setFormError(null);
  };

  const setDuration = (preset: AdDurationPreset) => {
    setValues((current) => ({
      ...current,
      ...applyDurationPreset(preset),
    }));
    setErrors((current) => ({ ...current, startAt: undefined, endAt: undefined }));
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setFormError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const uploaded = await apiUpload<{ imageUrl: string }>('/admin/ads/upload-image', body);
      set('imageUrl', uploaded.data.imageUrl);
      setPreviewFailed(false);
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.describe());
      } else {
        setFormError('Could not upload the image.');
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateAdForm(values);
    setErrors(found);
    setFormError(null);
    if (Object.values(found).some(Boolean)) {
      return;
    }
    setSaving(true);
    try {
      const saved = await apiRequest<Ad>(ad ? `/admin/ads/${ad.id}` : '/admin/ads', { method: ad ? 'PATCH' : 'POST', body: toAdPayload(values) });
      onSaved(saved.data);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(serverFieldErrors(error));
        setFormError(error.status === 404 ? 'This ad no longer exists.' : error.describe());
      } else {
        setFormError('Unexpected error. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const imageUrl = values.imageUrl.trim();
  const showPreview = isHttpUrl(imageUrl) && !previewFailed;
  const busy = saving || uploading;

  return (
    <Modal
      open
      size="lg"
      title={ad ? 'Edit ad' : 'New ad'}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving} disabled={uploading}>
            {ad ? 'Save changes' : 'Create ad'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={onSubmit} className="space-y-4">
        <FormError message={formError} />
        <Field label="Title" htmlFor="ad-title" error={errors.title} hint="Shown to admins only; also used as the image alt text in the app.">
          <TextInput id="ad-title" value={values.title} maxLength={AD_LIMITS.titleMax} invalid={Boolean(errors.title)} onChange={(e) => set('title', e.target.value)} required />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">Image</p>
          <div className="flex flex-wrap gap-2">
            <ModeChip active={values.imageMode === 'upload'} onClick={() => setImageMode('upload')} disabled={busy}>
              Select image (PC → R2)
            </ModeChip>
            <ModeChip active={values.imageMode === 'url'} onClick={() => setImageMode('url')} disabled={busy}>
              Image URL
            </ModeChip>
          </div>
          {values.imageMode === 'upload' ? (
            <Field label="Upload from computer" htmlFor="ad-file" error={errors.imageUrl} hint="JPEG, PNG, WebP or GIF · max 5 MB · stored in R2 bucket ads.">
              <input
                ref={fileRef}
                id="ad-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={busy}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
              />
              {uploading && <p className="mt-1 text-xs text-slate-500">Uploading…</p>}
              {imageUrl && <p className="mt-1 break-all text-xs text-slate-500">{imageUrl}</p>}
            </Field>
          ) : (
            <Field label="Image URL" htmlFor="ad-image" error={errors.imageUrl}>
              <TextInput
                id="ad-image"
                type="url"
                inputMode="url"
                placeholder="https://cdn.example.com/banner.png"
                value={values.imageUrl}
                maxLength={AD_LIMITS.urlMax}
                invalid={Boolean(errors.imageUrl)}
                onChange={(e) => set('imageUrl', e.target.value)}
                required
              />
            </Field>
          )}
          {showPreview && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external ad creatives; next/image would need every host whitelisted */}
              <img src={imageUrl} alt="Ad preview" className="mx-auto max-h-40 object-contain" referrerPolicy="no-referrer" onError={() => setPreviewFailed(true)} />
            </div>
          )}
          {previewFailed && isHttpUrl(imageUrl) && <p className="text-xs text-amber-700">The image could not be loaded. Check the URL is public.</p>}
        </div>

        <Field label="Click URL" htmlFor="ad-click" error={errors.clickUrl} hint="Opened when the user taps the ad.">
          <TextInput id="ad-click" type="url" inputMode="url" placeholder="https://example.com/offer" value={values.clickUrl} maxLength={AD_LIMITS.urlMax} invalid={Boolean(errors.clickUrl)} onChange={(e) => set('clickUrl', e.target.value)} required />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">How long should this ad run?</p>
          <div className="flex flex-wrap gap-2">
            {AD_DURATION_PRESETS.map((preset) => (
              <ModeChip key={preset.value} active={values.durationPreset === preset.value} onClick={() => setDuration(preset.value)} disabled={busy}>
                {preset.label}
              </ModeChip>
            ))}
          </div>
          {values.durationPreset !== 'custom' && (
            <p className="text-xs text-slate-500">
              Starts now and ends after {values.durationPreset} hour{values.durationPreset === '1' ? '' : 's'} (you can still tweak the times below).
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Placement" htmlFor="ad-placement" error={errors.placement}>
            <Select id="ad-placement" value={values.placement} invalid={Boolean(errors.placement)} onChange={(e) => set('placement', e.target.value as AdPlacement)}>
              {AD_PLACEMENTS.map((placement) => (
                <option key={placement} value={placement}>
                  {AD_PLACEMENT_LABELS[placement]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="ad-priority" error={errors.priority} hint={`${AD_LIMITS.priorityMin}–${AD_LIMITS.priorityMax}; higher is shown first.`}>
            <TextInput id="ad-priority" type="number" inputMode="numeric" min={AD_LIMITS.priorityMin} max={AD_LIMITS.priorityMax} step={1} value={values.priority} invalid={Boolean(errors.priority)} onChange={(e) => set('priority', e.target.value)} />
          </Field>
          <Field
            label="Start"
            htmlFor="ad-start"
            error={errors.startAt}
            hint={
              values.startAt ? (
                <ClearButton
                  onClick={() => {
                    set('startAt', '');
                    set('durationPreset', 'custom');
                  }}
                />
              ) : (
                'Empty: starts immediately.'
              )
            }
          >
            <TextInput
              id="ad-start"
              type="datetime-local"
              value={values.startAt}
              invalid={Boolean(errors.startAt)}
              onChange={(e) => {
                set('startAt', e.target.value);
                set('durationPreset', 'custom');
              }}
            />
          </Field>
          <Field
            label="End"
            htmlFor="ad-end"
            error={errors.endAt}
            hint={
              values.endAt ? (
                <ClearButton
                  onClick={() => {
                    set('endAt', '');
                    set('durationPreset', 'custom');
                  }}
                />
              ) : (
                'Empty: never ends.'
              )
            }
          >
            <TextInput
              id="ad-end"
              type="datetime-local"
              value={values.endAt}
              min={values.startAt || undefined}
              invalid={Boolean(errors.endAt)}
              onChange={(e) => {
                set('endAt', e.target.value);
                set('durationPreset', 'custom');
              }}
            />
          </Field>
        </div>
        <p className="text-xs text-slate-500">Times are in your browser&apos;s time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
        <Checkbox label="Active" description="Inactive ads are never shown, whatever the schedule." checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
      </form>
    </Modal>
  );
}

function ModeChip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
      } disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-indigo-600 hover:text-indigo-500">
      Clear
    </button>
  );
}
