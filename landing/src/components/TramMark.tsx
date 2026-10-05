import { TramFront } from 'lucide-react';

/**
 * Ikona aplikacji — ta sama, którą system pokazuje przy powiadomieniu:
 * sylwet frontu tramwaju w kółku (R.drawable.ic_kilometr_tram, tintonane przez
 * `setColor(plan.accentColor)`).
 *
 * Android renderuje small icon jako biały sylwet na pasku koloru linii, więc
 * kształt pochodzi z drawable, a barwa z akcentu. Trzymamy to w jednym
 * komponencie, żeby nagłówek strony i powiadomienie w sekcji demo nie rozjechały
 * się kolorem ani kształtem.
 */
export function TramMark({
  size = 44,
  bg = '#00a884',
  fg = '#04362c',
}: {
  size?: number;
  bg?: string;
  fg?: string;
}) {
  return (
    <span
      className="tram-mark"
      style={{ width: size, height: size, background: bg }}
    >
      <TramFront size={size * 0.46} color={fg} strokeWidth={2} />
    </span>
  );
}