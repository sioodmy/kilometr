import { tr } from '../../i18n/locale';

export function getTransferNativeCopy(): Record<string, string> {
  const s = tr().transferGuard;
  return {
    title: s.title,
    waiting: s.waiting,
    safeBody: s.next('{nextLine}', '{stop}'),
    riskTitle: s.riskTitle('{nextLine}'),
    riskBody: s.riskBody,
    changedTitle: s.stayOn('{line}'),
    changedBody: s.changedBody('{nextLine}', '{stop}'),
    alternativeTitle: s.alternativeTitle,
    alternativeBody: s.alternativeBody,
    noAlternative: s.noAlternative,
    unavailable: s.unavailable,
    unavailableBody: s.unavailableBody,
    rerouting: s.rerouting,
    channelName: s.channel,
  };
}
