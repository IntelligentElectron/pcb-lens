#!/usr/bin/env bash
set -euo pipefail

# Download IPC-2581 consortium test fixtures for pcb-lens tests.
# These are public sample files from http://www.ipc2581.com/
#
# Extracts full-design IPC-2581 XML files and flattens them into
# test/fixtures/ with descriptive names. Nested directories and
# non-XML artifacts are cleaned up after extraction.
#
# Usage: bash scripts/download-fixtures.sh
#   or:  npm run setup

FIXTURES_DIR="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures"
mkdir -p "$FIXTURES_DIR"

# Download a zip, extract a specific IPC-2581 file, rename it, and clean up.
#   $1 = download URL
#   $2 = path inside zip to the IPC-2581 XML or CVG file
#   $3 = target filename (always .xml)
#   $4 = description for logging
download_fixture() {
  local url="$1"
  local inner_path="$2"
  local target_name="$3"
  local desc="$4"

  local target="$FIXTURES_DIR/$target_name"

  if [ -f "$target" ]; then
    echo "  [skip] $target_name already exists"
    return 0
  fi

  local zipfile
  zipfile="$FIXTURES_DIR/_download_$(basename "$url")"

  echo "  Downloading $desc..."
  if ! curl -fsSL -o "$zipfile" "$url"; then
    echo "  [warn] Failed to download $desc — skipping"
    rm -f "$zipfile"
    return 0
  fi

  echo "  Extracting $inner_path..."
  if ! unzip -o -q "$zipfile" "$inner_path" -d "$FIXTURES_DIR"; then
    echo "  [warn] Failed to extract $inner_path — skipping"
    rm -f "$zipfile"
    return 0
  fi

  mv "$FIXTURES_DIR/$inner_path" "$target"
  rm -f "$zipfile"

  # Clean up any extracted directories (only remove empty parents)
  local dir
  dir="$(dirname "$FIXTURES_DIR/$inner_path")"
  while [ "$dir" != "$FIXTURES_DIR" ] && [ -d "$dir" ]; do
    rmdir "$dir" 2>/dev/null || break
    dir="$(dirname "$dir")"
  done

  echo "  [done] $target_name"
}

# Same as download_fixture but handles nested zips (zip inside zip).
#   $1 = download URL
#   $2 = path to inner zip inside the outer zip
#   $3 = path inside inner zip to the IPC-2581 file
#   $4 = target filename
#   $5 = description
download_nested_fixture() {
  local url="$1"
  local inner_zip_path="$2"
  local inner_path="$3"
  local target_name="$4"
  local desc="$5"

  local target="$FIXTURES_DIR/$target_name"

  if [ -f "$target" ]; then
    echo "  [skip] $target_name already exists"
    return 0
  fi

  local zipfile
  zipfile="$FIXTURES_DIR/_download_$(basename "$url")"

  echo "  Downloading $desc..."
  if ! curl -fsSL -o "$zipfile" "$url"; then
    echo "  [warn] Failed to download $desc — skipping"
    rm -f "$zipfile"
    return 0
  fi

  echo "  Extracting nested zip..."
  if ! unzip -o -q "$zipfile" "$inner_zip_path" -d "$FIXTURES_DIR"; then
    echo "  [warn] Failed to extract inner zip — skipping"
    rm -f "$zipfile"
    return 0
  fi

  local inner_zip="$FIXTURES_DIR/$inner_zip_path"
  if ! unzip -o -q "$inner_zip" "$inner_path" -d "$FIXTURES_DIR"; then
    echo "  [warn] Failed to extract $inner_path from inner zip — skipping"
    rm -f "$zipfile" "$inner_zip"
    return 0
  fi

  mv "$FIXTURES_DIR/$inner_path" "$target"
  rm -f "$zipfile" "$inner_zip"

  # Clean up extracted directories
  local dir
  dir="$(dirname "$FIXTURES_DIR/$inner_path")"
  while [ "$dir" != "$FIXTURES_DIR" ] && [ -d "$dir" ]; do
    rmdir "$dir" 2>/dev/null || break
    dir="$(dirname "$dir")"
  done
  dir="$(dirname "$inner_zip")"
  while [ "$dir" != "$FIXTURES_DIR" ] && [ -d "$dir" ]; do
    rmdir "$dir" 2>/dev/null || break
    dir="$(dirname "$dir")"
  done

  echo "  [done] $target_name"
}

echo "Downloading IPC-2581 test fixtures to $FIXTURES_DIR"
echo ""

# ---------------------------------------------------------------------------
# RevA fixtures
# ---------------------------------------------------------------------------

# T3 — Round test card (Allegro, RevA)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2017/12/IPC2581_T3_Sample.zip" \
  "t3_test_data/IPC-2581A/testcase3.xml" \
  "testcase3-RevA.xml" \
  "T3 — Round Test Card (RevA)"

# T4 — Zuken CR5000 board (RevA)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2017/12/IPC2581_T4_Sample.zip" \
  "t4_test_data/IPC2581/Board.cvg" \
  "testcase4-RevA-Zuken.xml" \
  "T4 — Zuken Board (RevA)"

# T5 — Fujitsu Networks board (Allegro, RevA)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2017/12/IPC-2581_T5_Sample.zip" \
  "testcase_5_data/IPC-2581A/testcase5.xml" \
  "testcase5-RevA.xml" \
  "T5 — Network Board (RevA)"

# T6 — Fujitsu Networks board (Allegro, RevA)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2017/12/IPC2581_T6_Sample.zip" \
  "test6_data/ipc-2581/testcase_6.cvg" \
  "testcase6-RevA.xml" \
  "T6 — Network Board (RevA)"

# ---------------------------------------------------------------------------
# RevB fixtures
# ---------------------------------------------------------------------------

# BeagleBone Black RevB6 (Allegro, RevB)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2020/11/BeagleBone_Black_RevB6_nologo174-AllegroOut.zip" \
  "BeagleBone_Black_RevB6_nologo174.xml" \
  "BeagleBone_Black_RevB6.xml" \
  "BeagleBone Black RevB6 (RevB)"

# Parallella Board (Allegro, RevB)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2021/01/CDNS-parallella_layout17p4-1.zip" \
  "parallella_layout17p4.xml" \
  "parallella-RevB.xml" \
  "Parallella Board (RevB)"

# Testcase 3 (RevB)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2017/12/IPC2581_Testcase-3_IPC-2581B.zip" \
  "REVB/test-3_r2.xml" \
  "testcase3-RevB.xml" \
  "T3 — Round Test Card (RevB)"

# ---------------------------------------------------------------------------
# RevC fixtures
# ---------------------------------------------------------------------------

# Testcase 1 — Network Card (RevC)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2021/03/Testcase1-RevC-March2021.zip" \
  "Testcase1-RevC/testcase1-RevC-full.xml" \
  "testcase1-RevC.xml" \
  "T1 — Network Card (RevC)"

# Testcase 3 — Round Test Card (RevC)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2021/03/Testcase3_RevC-March2021.zip" \
  "testcase3_2581REVC/testcase3-RevC-full.xml" \
  "testcase3-RevC.xml" \
  "T3 — Round Test Card (RevC)"

# Testcase 9 — LED Display Card (RevC)
download_fixture \
  "http://www.ipc2581.com/wp-content/uploads/2021/08/CDNS_testcase9-RevC-data.zip" \
  "testcase9-RevC-data/testcase9-RevC-Full.xml" \
  "testcase9-RevC.xml" \
  "T9 — LED Display Card (RevC)"

echo ""
echo "Fixture download complete. Files in $FIXTURES_DIR:"
ls -lh "$FIXTURES_DIR"/*.xml 2>/dev/null || echo "  (no XML files found)"
