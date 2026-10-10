#!/bin/bash
cd "$(dirname "$0")"
/bin/bash scripts/macos.sh start
result=$?
printf "\nPress Return to close..."
read -r _
exit "$result"
