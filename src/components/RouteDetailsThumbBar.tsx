import React from 'react';
import { ArrowLeft, ArrowUpDown } from 'lucide-react-native';
import { scheme } from '../theme/tokens';
import { ThumbBar, ThumbBarDivider, ThumbBarItem } from './ThumbBar';

interface RouteDetailsThumbBarProps {
  onBack: () => void;
  onReverseRoute: () => void;
}

/**
 * Dolne menu szczegółów połączenia: powrót do listy i trasa powrotna.
 * Te same dwa przyciski co wszędzie, w tej samej pigułce pod kciukiem.
 */
export function RouteDetailsThumbBar({
  onBack,
  onReverseRoute,
}: RouteDetailsThumbBarProps) {
  return (
    <ThumbBar>
      <ThumbBarItem
        onPress={onBack}
        icon={<ArrowLeft size={18} color={scheme.onSurfaceVariant} />}
        label="Wróć"
        accessibilityLabel="Wróć do listy połączeń"
      />
      <ThumbBarDivider />
      <ThumbBarItem
        onPress={onReverseRoute}
        active
        icon={<ArrowUpDown size={18} color={scheme.onPrimaryContainer} />}
        label="Trasa powrotna"
        accessibilityLabel="Pokaż trasę powrotną"
      />
    </ThumbBar>
  );
}
