import { DoorClosed } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={<DoorClosed />}
      title="This room doesn't exist"
      description="The page you opened isn't part of HomeSweetHome."
      action={<Link to="/" className="font-semibold text-lamp underline-offset-4 hover:underline">Go to the dashboard</Link>}
    />
  );
}
