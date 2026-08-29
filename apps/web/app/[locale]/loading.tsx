export default function Loading() {
  return (
    <main className="app-shell loading-shell" aria-busy="true" aria-live="polite">
      <div className="loading-bar" />
      <div className="loading-hero" />
      <div className="loading-grid">
        <div />
        <div />
        <div />
        <div />
      </div>
    </main>
  );
}
