#!/bin/bash

set -e

npm run build
pm2 restart stargate_timeline
