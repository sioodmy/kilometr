import { useEffect } from 'react';
import { suspendPredictiveBack } from '../../modules/kilometr-predictive-back';

export function usePredictiveBackBlocker() {
  useEffect(() => suspendPredictiveBack(), []);
}
