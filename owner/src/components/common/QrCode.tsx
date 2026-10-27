import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrMatrix, qrPath } from '../../utils/qr';

// A QR code drawn on the device (see utils/qr.ts): the text is never sent to a QR website.
const QUIET_ZONE = 2;

export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const matrix = qrMatrix(value);
    return { path: qrPath(matrix), count: matrix.length };
  }, [value]);
  const box = count + QUIET_ZONE * 2;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel="QR code for the staff link" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${box} ${box}`}>
        <Rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={box} height={box} fill="#fff" />
        <Path d={path} fill="#000" />
      </Svg>
    </View>
  );
}
