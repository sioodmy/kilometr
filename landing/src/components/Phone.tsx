import { useLayoutEffect, useRef, type ReactNode } from 'react';
import './phone.css';

const nativeWidth = 393;

type PhoneProps = {
  className?: string;
  label: string;
  children: ReactNode;
};

/** Obudowa iPhone'a; ekran wypełnia przekazany zrzut lub slajdy. */
export function Phone({ className = '', label, children }: PhoneProps) {
  const screen = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = screen.current;
    if (!element) return;
    const resize = (width: number) => {
      element.style.setProperty('--phone-scale', String(width / nativeWidth));
    };
    resize(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) resize(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`phone ${className}`.trim()} role="img" aria-label={label}>
      <div className="iphone-hardware" aria-hidden="true">
        <span className="iphone-button iphone-button-action" />
        <span className="iphone-button iphone-button-volume-up" />
        <span className="iphone-button iphone-button-volume-down" />
        <span className="iphone-button iphone-button-power" />
      </div>
      <div className="phone-screen" ref={screen} aria-hidden="true">
        <div className="phone-home">
          {children}
          <div className="iphone-island">
            <span className="iphone-camera" />
          </div>
        </div>
      </div>
    </div>
  );
}
