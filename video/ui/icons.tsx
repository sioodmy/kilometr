// @expo/vector-icons/MaterialIcons dla zrzutów: ten sam font i mapa glifów co w aplikacji.
import { Text, type TextProps } from 'react-native';
import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json';

const map: Record<string, number> = glyphs;

export default function MaterialIcons({
  name,
  size = 24,
  color,
  style,
  ...props
}: TextProps & { name: string; size?: number; color?: string }) {
  const code = map[name];
  return (
    <Text
      {...props}
      selectable={false}
      style={[{ fontFamily: 'MaterialIcons', fontSize: size, lineHeight: size, color, fontWeight: 'normal', fontStyle: 'normal' }, style]}
    >
      {code ? String.fromCodePoint(code) : '?'}
    </Text>
  );
}
