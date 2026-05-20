import React from 'react';

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  error: Error | null;
  attempt: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error, errorInfo);
  }

  retry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-100 p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="text-red-400 text-lg font-bold">3D preview crashed</div>
            <div className="text-gray-400 text-sm">
              {this.props.fallbackMessage ?? 'Your settings are preserved. You can try again or adjust controls.'}
            </div>
            <div className="text-gray-500 text-xs font-mono break-all">
              {this.state.error.message}
            </div>
            <button
              onClick={this.retry}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    // The `key` forces a remount of the subtree on retry, clearing any sticky state.
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}
