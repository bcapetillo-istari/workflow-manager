import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../components/ui';

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      action={
        <Link to="/">
          <Button variant="secondary">Back to workflows</Button>
        </Link>
      }
    />
  );
}
