import React from "react";
import Link from "next/link";

type DenShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export default function DenShell({ title, subtitle, children }: DenShellProps) {
  return (
    <div className="den-bg">
      {/* Watermark mascot */}
      <img
        className="den-watermark"
        src="/brand/denny.png"
        alt=""
        aria-hidden="true"
      />

      <div className="den-card">
        <header className="den-header">
          <div className="den-brand">
            <img className="den-logo" src="/brand/den-logo.png" alt="Den Defenders" />
            <img className="den-avatar" src="/brand/denny.png" alt="Coach Denny" />
            <div>
              <div className="den-title">{title}</div>
              <div className="den-subtitle">
                {subtitle ?? "Call coaching + scoring for Den Defenders"}
              </div>
            </div>
          </div>

          <nav className="den-nav">
            <Link className="den-link" href="/">Home</Link>
            <Link className="den-link" href="/coach">Chat With Coach Denny</Link>
            <Link className="den-link" href="/score">Let Coach Denny Listen</Link>
          </nav>
        </header>

        

        <main className="den-main">{children}</main>
      </div>
    </div>
  );
}
