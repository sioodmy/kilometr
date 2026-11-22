// Mostek iframe dla map MapLibre na webie: używa dokładnie tego samego
// dokumentu HTML co natywny WebView, więc wygląd i zachowanie mapy są 1:1.

import React, { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef } from 'react';

export interface WebMapFrameHandle {
  postMessage: (json: string) => void;
}

interface WebMapFrameProps {
  html: string;
  title: string;
  onMessage: (data: string) => void;
  onError?: () => void;
}

function injectBridgeShim(html: string, bridgeId: string): string {
  const shim =
    `<script>(function(){` +
    `var id=${JSON.stringify(bridgeId)};` +
    `window.ReactNativeWebView={` +
    `postMessage:function(data){` +
    `try{window.parent.postMessage({__kmMapBridge:id,data:String(data)},'*');}catch(e){}` +
    `}` +
    `};` +
    `})();</script>`;
  const headIdx = html.indexOf('<head>');
  if (headIdx >= 0) {
    const insertAt = headIdx + '<head>'.length;
    return html.slice(0, insertAt) + '\n' + shim + html.slice(insertAt);
  }
  return shim + html;
}

export const WebMapFrame = forwardRef<WebMapFrameHandle, WebMapFrameProps>(function WebMapFrame(
  { html, title, onMessage, onError },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeId = useId();
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const srcDoc = useMemo(() => injectBridgeShim(html, bridgeId), [html, bridgeId]);

  useImperativeHandle(
    ref,
    () => ({
      postMessage: (json: string) => {
        try {
          iframeRef.current?.contentWindow?.postMessage(json, '*');
        } catch {
          // ramka może być jeszcze w trakcie ładowania
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const payload = event.data as { __kmMapBridge?: string; data?: string } | null;
      if (!payload || payload.__kmMapBridge !== bridgeId || typeof payload.data !== 'string') return;
      onMessageRef.current(payload.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [bridgeId]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      srcDoc={srcDoc}
      onError={onError}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        display: 'block',
        backgroundColor: 'transparent',
      }}
    />
  );
});
