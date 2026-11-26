import { Fragment, memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { scheme, shape } from '../theme/tokens';
import type { TransitLegItem } from './connectionInsights';
import { LineBadge } from './LineBadge';
import { ArrowRight, TriangleAlert } from './icons';

export interface VariantLegChainProps {
  steps: TransitLegItem[];
  dimmed?: boolean;
}

/**
 * Kompaktowy łańcuch linii wariantu pokazujący ostrzeżenia o krótkiej przesiadce
 * dokładnie pomiędzy przesiadanymi pojazdami.
 */
export const VariantLegChain = memo(function VariantLegChain({
  steps,
  dimmed = false,
}: VariantLegChainProps) {
  if (steps.length === 0) return null;

  return (
    <View style={styles.row}>
      {steps.map((step, idx) => {
        const hasNext = idx < steps.length - 1;
        const risk = hasNext ? step.transferRiskAfter : undefined;
        const showRisk = !dimmed && risk != null;
        const critical = risk?.level === 'critical';
        const riskFg = critical ? scheme.onErrorContainer : scheme.onWarningContainer;
        const slackText = risk ? (risk.slackMin <= 0 ? "<1'" : `${risk.slackMin}'`) : '';

        return (
          <Fragment key={`${step.key}-${idx}`}>
            <LineBadge leg={step.leg} compact />
            {hasNext &&
              (showRisk ? (
                <View
                  style={[
                    styles.riskPill,
                    critical ? styles.riskCritical : styles.riskTight,
                  ]}
                >
                  <TriangleAlert size={10} color={riskFg} />
                  <Text style={[styles.riskText, { color: riskFg }]}>{slackText}</Text>
                </View>
              ) : (
                <ArrowRight size={11} color={scheme.onSurfaceVariant} />
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
    gap: 5,
    flexShrink: 1,
  },
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: shape.full,
    minHeight: 22,
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
});
