#!/bin/bash
cd /home/kavia/workspace/code-generation/nordic-carpool-platform-89320-89331/blablabil_backend
npm run lint
LINT_EXIT_CODE=$?
if [ $LINT_EXIT_CODE -ne 0 ]; then
  exit 1
fi

