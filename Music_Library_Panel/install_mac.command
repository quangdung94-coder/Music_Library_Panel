#!/bin/bash
# Cai Music Library cho DaVinci Resolve Studio tren macOS
cd "$(dirname "$0")"
BASE="/Library/Application Support/Blackmagic Design/DaVinci Resolve"
DEST="$BASE/Workflow Integration Plugins/Music_Library_Plugin"

if [ ! -d "$BASE" ]; then
  echo "Khong tim thay DaVinci Resolve tren may nay. Hay cai DaVinci Resolve Studio truoc."
  read -n 1 -s -r -p "Bam phim bat ky de dong..."; exit 1
fi
NODE=$(find "$BASE" -name WorkflowIntegration.node -path "*SamplePlugin*" 2>/dev/null | head -n 1)
if [ -z "$NODE" ]; then
  echo "Khong tim thay file WorkflowIntegration.node cua Blackmagic."
  echo "Hay lam theo muc 'Cach cai thu cong' trong file README_CAI_DAT.txt."
  read -n 1 -s -r -p "Bam phim bat ky de dong..."; exit 1
fi

echo "May se xin mat khau dang nhap cua may Mac de cai vao thu muc he thong."
sudo mkdir -p "$DEST" || exit 1
sudo cp -R Music_Library_Plugin/. "$DEST/" || exit 1
sudo cp "$NODE" "$DEST/WorkflowIntegration.node" || exit 1
sudo xattr -cr "$DEST" 2>/dev/null
echo ""
echo "CAI DAT XONG."
echo "Buoc tiep: TAT HAN DaVinci Resolve (Cmd+Q) roi mo lai."
echo "Mo panel: menu Workspace > Workflow Integrations > Music Library"
read -n 1 -s -r -p "Bam phim bat ky de dong..."
