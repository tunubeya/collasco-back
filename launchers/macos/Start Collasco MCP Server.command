#!/bin/zsh

set -u

BACKEND_DIR="/Users/thomascleenewerck/Collasco/Collasco Back-End"

printf '\033]0;Collasco MCP Server\007'
clear
echo "Starting Collasco MCP Server..."
echo
echo "Directory: $BACKEND_DIR"
echo "Command: npm run mcp:collasco:http:login"
echo

if [ ! -d "$BACKEND_DIR" ]; then
  echo "Could not find the Collasco back-end directory:"
  echo "$BACKEND_DIR"
  echo
  echo "Press any key to close this window."
  read -k 1
  exit 1
fi

cd "$BACKEND_DIR" || exit 1
npm run mcp:collasco:http:login

status=$?
echo
echo "Collasco MCP Server exited with status $status."
echo "Press any key to close this window."
read -k 1
exit "$status"
