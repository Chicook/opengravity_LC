'use strict';

function resetSessionState(state, turnCheckpoints, cambiosDelTurno) {
  state.sessionId = null;
  state.messages = [];
  turnCheckpoints.clear();
  if (Array.isArray(cambiosDelTurno)) cambiosDelTurno.length = 0;
}

module.exports = { resetSessionState };
