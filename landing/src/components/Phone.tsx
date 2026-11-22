import type { ReactNode } from 'react';
import './phone.css';

type PhoneProps = {
  className?: string;
  label: string;
  /** Hide the default dark status bar fill (e.g. for Lock Screen mode). */
  transparentStatusBar?: boolean;
  /** Clock shown in the Pixel status bar. */
  statusTime?: string;
  children: ReactNode;
};

/** Realistic Obsidian Pixel 9 Pro hardware frame (exact 9:20 proportions, punch-hole camera, no Dynamic Island). */
export function Phone({
  className = '',
  label,
  transparentStatusBar = false,
  statusTime = '09:05',
  children,
}: PhoneProps) {
  return (
    <div className={`pixel-phone ${className}`.trim()} role="img" aria-label={label}>
      <div className="pixel-hardware" aria-hidden="true">
        <span className="pixel-antenna pixel-antenna-tl" />
        <span className="pixel-antenna pixel-antenna-tr" />
        <span className="pixel-antenna pixel-antenna-bl" />
        <span className="pixel-antenna pixel-antenna-br" />
        <span className="pixel-btn pixel-btn-power" />
        <span className="pixel-btn pixel-btn-volume" />
      </div>
      <div className="pixel-bezel" aria-hidden="true">
        <span className="pixel-speaker" />
        <div className="pixel-screen">
          <div className="pixel-viewport">{children}</div>

          <div
            className={`pixel-status-bar ${transparentStatusBar ? 'is-transparent' : ''}`.trim()}
          >
            <span className="pixel-status-time">{statusTime}</span>
            <span className="pixel-punch" />
            <span className="pixel-status-icons">
              <svg width="13" height="10" viewBox="0 0 16 12" fill="none">
                <path
                  d="M1 3.6C4.9 0.2 11.1 0.2 15 3.6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <path
                  d="M3.6 6.4C6.1 4.2 9.9 4.2 12.4 6.4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="9.6" r="1.4" fill="currentColor" />
              </svg>
              <svg width="12" height="10" viewBox="0 0 14 12" fill="currentColor">
                <rect x="0.5" y="7.5" width="2.2" height="4" rx="0.6" />
                <rect x="4" y="5.2" width="2.2" height="6.3" rx="0.6" />
                <rect x="7.5" y="2.8" width="2.2" height="8.7" rx="0.6" />
                <rect x="11" y="0.5" width="2.2" height="11" rx="0.6" />
              </svg>
              <span className="pixel-battery">
                <span className="pixel-battery-fill" />
              </span>
            </span>
          </div>

          <span className="pixel-gesture-pill" />
          <span className="pixel-glass-sheen" />
        </div>
      </div>
    </div>
  );
}
