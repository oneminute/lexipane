import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";

interface Props {
  children: ReactNode;
  onBackToLibrary: () => void;
}

interface State {
  error: Error | null;
}

export class ReaderErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("LexiPane Reader crashed", error, info);
  }

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <section className="reader-crash-card">
        <span className="eyebrow">Reader error</span>
        <h1>The book reader stopped unexpectedly.</h1>
        <p>
          LexiPane kept the rest of the application running so the error is
          visible instead of showing a blank window.
        </p>
        <pre>{error.message || String(error)}</pre>
        <div>
          <button
            className="primary-button"
            onClick={this.props.onBackToLibrary}
          >
            Back to Library
          </button>
        </div>
      </section>
    );
  }
}
