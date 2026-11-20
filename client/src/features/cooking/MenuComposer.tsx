// Rohit's publish / edit form. Photos are shrunk in the browser before upload.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { Menu, MenuInput } from '@shared/types';
import { Button, Dialog } from '@/components/ui';
import { useMeta } from '@/lib/queries';
import { useMenuAdmin } from './api';
import { downscaleToJpeg } from './image';

const field =
  'w-full rounded-chip border border-seam bg-wall px-3 py-2.5 text-jasmine placeholder:text-haze focus-visible:border-lamp focus-visible:outline-none';

export function MenuComposer({ menu, onClose }: { menu?: Menu; onClose: () => void }) {
  const meta = useMeta().data;
  const { publish, update } = useMenuAdmin();
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(menu?.title ?? '');
  const [description, setDescription] = useState(menu?.description ?? '');
  const [menuDate, setMenuDate] = useState(menu?.menuDate ?? meta?.today ?? '');
  /** undefined = untouched (keep existing on edit), null = removed, string = new data URL */
  const [image, setImage] = useState<string | null | undefined>(undefined);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuDate && meta?.today) setMenuDate(meta.today);
  }, [menuDate, meta?.today]);

  const preview = image === undefined ? (menu?.imageUrl ?? null) : image;
  const saving = publish.isPending || update.isPending;

  async function onPick(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    setError(null);
    try {
      setImage(await downscaleToJpeg(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be used.');
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError('Give the menu a title.');
      return;
    }
    if (!menuDate) {
      setError('Pick the date this menu is for.');
      return;
    }
    if (menu) {
      const input: Partial<MenuInput> = {};
      if (t !== menu.title) input.title = t;
      if (description.trim() !== menu.description) input.description = description.trim();
      if (menuDate !== menu.menuDate) input.menuDate = menuDate;
      if (image !== undefined) input.image = image;
      if (Object.keys(input).length === 0) {
        onClose();
        return;
      }
      update.mutate({ id: menu.id, input }, { onSuccess: onClose });
    } else {
      const input: MenuInput = { title: t, description: description.trim(), menuDate };
      if (image) input.image = image;
      publish.mutate(input, { onSuccess: onClose });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={menu ? 'Edit menu' : 'Publish a menu'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving} disabled={preparing}>
            {menu ? 'Save changes' : 'Publish menu'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="mt-3 flex flex-col gap-4 text-jasmine" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">What’s cooking</span>
          <input
            className={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            placeholder="Rice, sambar and potato fry"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">
            Details <span className="font-normal text-haze">(optional)</span>
          </span>
          <textarea
            className={`${field} min-h-20 resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            placeholder="Ready by 8 pm. Tell me by 5 so I cook enough."
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">For</span>
          <input
            type="date"
            className={`${field} [color-scheme:dark]`}
            value={menuDate}
            onChange={(e) => setMenuDate(e.target.value)}
            required
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold" id={`${formId}-photo`}>
            Photo <span className="font-normal text-haze">(optional)</span>
          </span>
          {preview ? (
            <div className="relative overflow-hidden rounded-chip border border-seam">
              <img src={preview} alt="Preview of the menu photo" className="aspect-[4/3] w-full object-cover" />
              <div className="absolute right-2 bottom-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={preparing}>
                  Replace
                </Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setImage(null)}>
                  Remove photo
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={preparing}
              aria-describedby={`${formId}-photo`}
              className="flex aspect-[4/3] max-h-44 w-full flex-col items-center justify-center gap-2 rounded-chip border border-dashed border-seam bg-night/40 text-dusk transition-colors hover:border-lamp hover:text-jasmine"
            >
              <ImagePlus className="size-7" aria-hidden />
              <span className="text-sm font-semibold">{preparing ? 'Preparing photo…' : 'Add a photo'}</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-labelledby={`${formId}-photo`}
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-chili">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
