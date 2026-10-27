import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isUnauthorized } from '../auth/unauthorized';
import { Button, ErrorState } from '../components/ui';

interface Props {
  children: ReactNode;
  onUnauthorized: () => void;
}
interface State {
  error: unknown;
}

/** Catches render errors; a 401 GatewayError signs the user out instead of showing an error. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (isUnauthorized(error)) {
      this.props.onUnauthorized();
      this.setState({ error: null });
      return;
    }
    console.error('Unhandled render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="mx-auto mt-16 max-w-xl">
          <ErrorState title="The page failed to render" error={this.state.error} />
          <div className="mt-3">
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
