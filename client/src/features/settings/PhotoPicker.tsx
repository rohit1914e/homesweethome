// Pick, shrink and upload a profile picture. Used for your own photo and (Rohit) anyone's.
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Camera, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { downscaleToJpeg } from '@/features/cooking/image';
import { api, errorMessage } from '@/lib/api';
import { qk, queryClient } from '@/lib/queries';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 15 * 1024 * 1024; // before shrinking in the browser

export function refreshMembers() {
  void queryClient.invalidateQueries({ queryKey: qk.members });
  void queryClient.invalidateQueries({ queryKey: qk.me });
  void queryClient.invalidateQueries({ queryKey: ['auth', 'members'] });
}

/** memberId omitted = your own picture. */
export function PhotoPicker({ memberId, name, hasUpload, size = 'md' }: { memberId?: number; name: string; hasUpload: boolean; size?: 'sm' | 'md' }) {
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const path = memberId === undefined ? '/api/members/me/photo' : `/api/admin/members/${memberId}/photo`;
  const upload = useMutation({
    mutationFn: (image: string) => api.put(path, { image }),
    onSuccess: () => {
      toast.success(memberId === undefined ? 'Changed your photo' : `Changed ${name}'s photo`);
      refreshMembers();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.del(path),
    onSuccess: () => {
      toast.success(memberId === undefined ? 'Reset your photo' : `Reset ${name}'s photo`);
      refreshMembers();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function pick(file: File | undefined) {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return toast.error('Choose a JPEG, PNG or WebP picture.');
    if (file.size > MAX_FILE_BYTES) return toast.error('That picture is too large (15 MB max).');
    setPreparing(true);
    try {
      upload.mutate(await downscaleToJpeg(file));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPreparing(false);
    }
  }

  const btn = size === 'sm' ? 'sm' : 'md';
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size={btn}
        variant="secondary"
        icon={<Camera className="size-4" aria-hidden />}
        loading={preparing || upload.isPending}
        onClick={() => input.current?.click()}
        aria-label={memberId === undefined ? 'Change your photo' : `Change ${name}'s photo`}
      >
        {size === 'sm' ? 'Photo' : 'Change photo'}
      </Button>
      {hasUpload && (
        <Button
          type="button"
          size={btn}
          variant="ghost"
          icon={<RotateCcw className="size-4" aria-hidden />}
          loading={reset.isPending}
          onClick={() => reset.mutate()}
          aria-label={memberId === undefined ? 'Reset your photo' : `Reset ${name}'s photo`}
        >
          {size === 'sm' ? 'Reset' : 'Reset photo'}
        </Button>
      )}
      <input ref={input} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

/** True when the member's picture is an upload (not the default one shipped with the app). */
export const isUploaded = (avatarUrl: string | null) => !!avatarUrl?.startsWith('/api/members/');
