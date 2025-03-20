#!/bin/bash

npmBin="./node_modules/.bin"
flags="--sourcemap --bundle --outdir=dist --outbase=client --minify --alias:~=./client"
if [[ "$1" = "release" ]]; then
  pathChanged=""
else
  pathChanged=$(cat)
fi

tailwind="$npmBin/tailwindcss -i client/styles.css -o dist/styles.css"
esbuild="$npmBin/esbuild client/main.tsx $flags"

if [[ "$pathChanged" == *".tsx" || "$pathChanged" == *".ts" ]]; then
  cp -r public/* client/*.html dist & $tailwind & $esbuild & wait
elif [[ "$pathChanged" == *".html" ]]; then
  cp -r public/* client/*.html dist & $tailwind & wait
else
  mkdir -p dist
  rm -rf dist/*
  cp -r public/* client/*.html dist & $tailwind & $esbuild & wait
fi
