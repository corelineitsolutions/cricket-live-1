'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, FormError, Select, TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { AD_LIMITS, EMPTY_AD_FORM, fromAd, isHttpUrl, toAdPayload, validateAdForm, type AdFormErrors, type AdFormValues } from '@/lib/ad-form';
import { ApiError, apiRequest } from '@/lib/api';
import { humanize } from '@/lib/format';
import { AD_PLACEMENTS, type Ad, type AdPlacement } from '@/lib/types';

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
  const [values, setValues] = useState<AdFormValues>(() => (ad ? fromAd(ad) : EMPTY_AD_FORM));
  const [errors, setErrors] = useState<AdFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const set = <K extends keyof AdFormValues>(key: K, value: AdFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    if (key === 'imageUrl') {
      setPreviewFailed(false);
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

  return (
    <Modal
      open
      size="lg"
      title={ad ? 'Edit ad' : 'New ad'}
      onClose={saving ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
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
        <Field label="Image URL" htmlFor="ad-image" error={errors.imageUrl}>
          <TextInput id="ad-image" type="url" inputMode="url" placeholder="https://cdn.example.com/banner.png" value={values.imageUrl} maxLength={AD_LIMITS.urlMax} invalid={Boolean(errors.imageUrl)} onChange={(e) => set('imageUrl', e.target.value)} required />
        </Field>
        {showPreview && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external ad creatives; next/image would need every host whitelisted */}
            <img src={imageUrl} alt="Ad preview" className="mx-auto max-h-40 object-contain" referrerPolicy="no-referrer" onError={() => setPreviewFailed(true)} />
          </div>
        )}
        {previewFailed && isHttpUrl(imageUrl) && <p className="text-xs text-amber-700">The image could not be loaded. Check the URL is public.</p>}
        <Field label="Click URL" htmlFor="ad-click" error={errors.clickUrl} hint="Opened when the user taps the ad.">
          <TextInput id="ad-click" type="url" inputMode="url" placeholder="https://example.com/offer" value={values.clickUrl} maxLength={AD_LIMITS.urlMax} invalid={Boolean(errors.clickUrl)} onChange={(e) => set('clickUrl', e.target.value)} required />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Placement" htmlFor="ad-placement" error={errors.placement}>
            <Select id="ad-placement" value={values.placement} invalid={Boolean(errors.placement)} onChange={(e) => set('placement', e.target.value as AdPlacement)}>
              {AD_PLACEMENTS.map((placement) => (
                <option key={placement} value={placement}>
                  {humanize(placement)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="ad-priority" error={errors.priority} hint={`${AD_LIMITS.priorityMin}–${AD_LIMITS.priorityMax}; higher is shown first.`}>
            <TextInput id="ad-priority" type="number" inputMode="numeric" min={AD_LIMITS.priorityMin} max={AD_LIMITS.priorityMax} step={1} value={values.priority} invalid={Boolean(errors.priority)} onChange={(e) => set('priority', e.target.value)} />
          </Field>
          <Field label="Start" htmlFor="ad-start" error={errors.startAt} hint={values.startAt ? <ClearButton onClick={() => set('startAt', '')} /> : 'Empty: starts immediately.'}>
            <TextInput id="ad-start" type="datetime-local" value={values.startAt} invalid={Boolean(errors.startAt)} onChange={(e) => set('startAt', e.target.value)} />
          </Field>
          <Field label="End" htmlFor="ad-end" error={errors.endAt} hint={values.endAt ? <ClearButton onClick={() => set('endAt', '')} /> : 'Empty: never ends.'}>
            <TextInput id="ad-end" type="datetime-local" value={values.endAt} min={values.startAt || undefined} invalid={Boolean(errors.endAt)} onChange={(e) => set('endAt', e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">Times are in your browser&apos;s time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
        <Checkbox label="Active" description="Inactive ads are never shown, whatever the schedule." checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
      </form>
    </Modal>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-indigo-600 hover:text-indigo-500">
      Clear
    </button>
  );
}
