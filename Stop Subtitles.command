#!/bin/bash
cd "$(dirname "$0")"
/bin/bash scripts/macos.sh stop
result=$?
printf "\nPress Return to close..."
read -r _
exit "$result"
