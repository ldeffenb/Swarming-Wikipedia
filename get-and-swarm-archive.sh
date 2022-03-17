#!/bin/sh
if [ "$#" -ne 3 ]; then
  echo "Usage: $0 ArchiveURL beeURL stamp" >&2
  exit 1
fi

echo
echo "Swarming Wikipedia archive $1"
echo "     via $2 with stamp $3"
echo

rm -rf ./archive.zim

echo "wget $1"
wget -q -O archive.zim $1

ls -al archive.zim

rm -rf ./archive

echo "zimdump archive.zim"
./zim-tools_linux-x86_64-3.1.0/zimdump dump --dir=./archive archive.zim | grep -v -E --line-buffered "Wrote "

rm -f archive.zim

echo
echo "node ./archive $2 $3"
node dist/index.js "./archive" "$2" "$3" >/dev/null

echo

rm -rf ./archive
