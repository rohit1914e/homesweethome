import { useEffect, useId, useState } from 'react';
import type { CleaningCategory, CleaningTask } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button, Dialog, TextArea, TextField } from '@/components/ui';
import { useMembers, useMeta } from '@/lib/queries';
import { CATEGORIES, CATEGORY_LABELS, useCleaningActions } from './api';

/** Rohit only: assign new duties (several categories at once) or edit / reassign one duty. */
export function AssignDialog({ task, onClose }: { task?: CleaningTask; onClose: () => void }) {
  const formId = useId();
  const { members } = useMembers();
  const today = useMeta().data?.today ?? '';
  const { assign, update } = useCleaningActions();
  const [memberId, setMemberId] = useState<number | null>(task?.memberId ?? null);
  const [date, setDate] = useState(task?.date ?? today);
  const [cats, setCats] = useState<CleaningCategory[]>(task ? [task.category] : []);
  const [customTitle, setCustomTitle] = useState(task?.customTitle ?? '');
  const [instructions, setInstructions] = useState(task?.instructions ?? '');
  const [error, setError] = useState<string | null>(null);
  // The room's "today" may arrive after the dialog opens.
  useEffect(() => {
    if (!date && today) setDate(today);
  }, [today, date]);
  const saving = assign.isPending || update.isPending;

  const toggle = (c: CleaningCategory) => setCats((cur) => (task ? [c] : cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  function submit() {
    if (!memberId) return setError('Choose who does it.');
    if (!date) return setError('Choose a date.');
    if (!cats.length) return setError('Pick at least one task.');
    if (cats.includes('custom') && !customTitle.trim()) return setError('Describe the custom task.');
    setError(null);
    const custom = cats.includes('custom') ? customTitle.trim() : undefined;
    if (task) {
      update.mutate({ id: task.id, memberId, date, category: cats[0], customTitle: custom ?? null, instructions } as never, { onSuccess: onClose });
    } else {
      assign.mutate({ memberId, date, categories: cats, customTitle: custom, instructions }, { onSuccess: onClose });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? 'Edit cleaning duty' : 'Assign cleaning duties'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={formId} loading={saving}>{task ? 'Save changes' : cats.length > 1 ? `Assign ${cats.length} duties` : 'Assign duty'}</Button>
        </>
      }
    >
      <form id={formId} className="mt-3 flex flex-col gap-5 text-jasmine" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Who</legend>
          <div className="grid grid-cols-3 gap-2">
            {members.map((m) => (
              <label key={m.id} className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-chip border p-2 text-sm ${memberId === m.id ? 'border-lamp bg-lamp-soft' : 'border-seam text-dusk hover:border-haze'}`}>
                <input type="radio" name="clean-who" className="sr-only" checked={memberId === m.id} onChange={() => setMemberId(m.id)} />
                <Avatar member={m} size="md" />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>

        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{task ? 'Task' : 'Tasks (pick one or more)'}</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = cats.includes(c);
              return (
                <label key={c} className={`cursor-pointer rounded-chip border px-3 py-1.5 text-sm font-medium ${on ? 'border-lamp bg-lamp-soft text-jasmine' : 'border-seam text-dusk hover:border-haze'}`}>
                  <input type={task ? 'radio' : 'checkbox'} name="clean-cat" className="sr-only" checked={on} onChange={() => toggle(c)} />
                  {CATEGORY_LABELS[c]}
                </label>
              );
            })}
          </div>
        </fieldset>

        {cats.includes('custom') && (
          <TextField label="Describe the custom task" maxLength={120} value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Clean the fridge" />
        )}
        <TextArea label="Instructions (optional)" maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Under the beds too. Use the new mop." />
        {error && <p role="alert" className="text-sm text-chili">{error}</p>}
      </form>
    </Dialog>
  );
}
