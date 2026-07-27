import { Button } from "@waflo/ui";

export default function NotFound() {
  return (
    <main className="marketing-container marketing-content">
      <img src="/brand/waflo-logo-primary-horizontal.svg" alt="Waflo" style={{ width: 140 }} />
      <p className="marketing-kicker" style={{ marginTop: "4rem" }}>
        404
      </p>
      <h1>This page has moved out of the flow.</h1>
      <p className="marketing-content__lead">The page you requested could not be found.</p>
      <a href="/en">
        <Button>Return home</Button>
      </a>
    </main>
  );
}
