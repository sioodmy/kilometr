// Importuj jako pierwsze w main.tsx. react-dom jest przypięty w overrides
// package.json na 19.2.0, a react to nowszy patch 19.2.x; react-dom bez tego
// odmawia startu. Dotyczy tylko zrzutów ekranów w wideo.
import React from 'react';
import { version } from 'react-dom';

Object.defineProperty(React, 'version', { value: version });
