import { G, Path, Svg } from 'react-native-svg';
import { isRailAgency, RAIL_ICON_SPECS } from '../services/railIconPaths';

export { isRailAgency };

export function RailIcon({
  agency,
  size,
  color,
}: {
  agency?: string;
  size: number;
  color: string;
}) {
  if (!agency || !isRailAgency(agency)) return null;
  const spec = RAIL_ICON_SPECS[agency];
  const paths = spec.paths.map((d, idx) => <Path key={idx} d={d} />);
  const hasScale = 'scale' in spec && spec.scale != null;
  const hasTranslateY = 'translateY' in spec && spec.translateY != null;
  const transform = hasScale
    ? hasTranslateY
      ? `scale(${spec.scale}) translate(0, ${spec.translateY})`
      : `scale(${spec.scale})`
    : undefined;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      {transform ? <G transform={transform}>{paths}</G> : paths}
    </Svg>
  );
}
