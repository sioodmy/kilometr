import { Fragment, memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { scheme, shape } from '../theme/tokens';
import type { TransitLegItem } from './connectionInsights';
import { LineBadge } from './LineBadge';
import { ArrowRight, TriangleAlert } from './icons';

export interface VariantLegChainProps {
  steps: TransitLegItem[];
  dimmed?: boolean;
  dense?: boolean;
}

/**
 * Kompaktowy łańcuch linii wariantu pokazujący ostrzeżenia o krótkiej przesiadce
 * dokładnie pomiędzy przesiadanymi pojazdami.
 */
export const VariantLegChain = memo(function VariantLegChain({
  steps,
  dimmed = false,
  dense = false,
}: VariantLegChainProps) {
  if (steps.length === 0) return null;

  return (
    <View style={[styles.row, dense && styles.rowDense]}>
      {steps.map((step, idx) => {
        const hasNext = idx < steps.length - 1;
        const risk = hasNext ? step.transferRiskAfter : undefined;
        const showRisk = !dimmed && risk != null;
        const critical = risk?.level === 'critical';
        const riskFg = critical ? scheme.onErrorContainer : scheme.onWarningContainer;
        const slackText = risk ? (risk.slackMin <= 0 ? "<1'" : `${risk.slackMin}'`) : '';

        return (
          <Fragment key={`${step.key}-${idx}`}>
            <LineBadge leg={step.leg} compact size={dense ? 'small' : 'medium'} />
            {hasNext &&
              (showRisk ? (
                <View
                  style={[
                    styles.riskPill,
                    dense && styles.riskPillDense,
                    critical ? styles.riskCritical : styles.riskTight,
                  ]}
                >
                  <TriangleAlert size={dense ? 9 : 10} color={riskFg} />
                  <Text style={[styles.riskText, dense && styles.riskTextDense, { color: riskFg }]}>
                    {slackText}
                  </Text>
                </View>
              ) : (
                <ArrowRight size={dense ? 10 : 11} color={scheme.onSurfaceVariant} />
              ))}
          </Fragment>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  rowDense: {
    gap: 3.5,
  },
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: shape.full,
    minHeight: 22,
  },
  riskPillDense: {
    paddingHorizontal: 4.5,
    paddingVertical: 1.5,
    minHeight: 19,
  },
  riskTight: {
    backgroundColor: scheme.warningContainer,
  },
  riskCritical: {
    backgroundColor: scheme.errorContainer,
  },
  riskText: {
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  riskTextDense: {
    fontSize: 9.5,
    lineHeight: 11,
  },
});
