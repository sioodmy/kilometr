import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { useStrings } from '../i18n';
import { SCREENSHOTS, SCREENSHOT_SIZE, type Screen } from '../screenshots';

export function Phone({
  screen = 'home',
  className = '',
}: {
  screen?: Screen;
  className?: string;
}) {
  const s = useStrings().preview;
  const source = SCREENSHOTS[screen];
  const [failedSource, setFailedSource] = useState<string | null>(null);

  return (
    <div className={`phone ${className}`}>
      <div className="phone-screen">
        {source && source !== failedSource ? (
          <img
            src={source}
            alt={s[screen]}
            width={SCREENSHOT_SIZE.width}
            height={SCREENSHOT_SIZE.height}
            onError={() => setFailedSource(source)}
          />
        ) : (
          <div
            className="screenshot-placeholder"
            role="img"
            aria-label={s.placeholderLabel(s[screen])}
          >
            <ImageIcon aria-hidden="true" />
            <span>{s[screen]}</span>
            <small>{s.placeholder}</small>
            <small>{s.device}</small>
          </div>
        )}
      </div>
    </div>
  );
}
