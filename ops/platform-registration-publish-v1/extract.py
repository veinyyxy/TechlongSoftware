"""The exact sealed registration ZIP layout; no arbitrary paths or symlinks."""
import os
import re
import shutil
import stat
import sys
import zipfile

if len(sys.argv) != 4 or not re.fullmatch(r"[1-9][0-9]{0,9}", sys.argv[3]):
    raise ValueError("REGISTRATION_ZIP_ARGUMENTS")
archive_bytes = int(sys.argv[3])
if archive_bytes >= 1610612736:  # Same absolute bound as the candidate sealer.
    raise ValueError("REGISTRATION_ZIP_ARGUMENTS")
LIMITS = {"image.tar.gz": archive_bytes, "image-receipt.json": 8192,
          "os-scan-summary.json": 65536, "SHA256SUMS": 1024}

with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = archive.infolist()
    if len(entries) != len(LIMITS) or {e.filename for e in entries} != set(LIMITS):
        raise ValueError("REGISTRATION_ZIP_ENTRIES")
    for e in entries:
        if (e.is_dir() or stat.S_IFMT(e.external_attr >> 16) not in (0, stat.S_IFREG)
                or e.flag_bits & 1 or not 0 < e.file_size <= LIMITS[e.filename]
                or (e.filename == "image.tar.gz" and e.file_size != archive_bytes)
                or e.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            raise ValueError("REGISTRATION_ZIP_ENTRY")
    os.mkdir(sys.argv[2], 0o700)
    for e in entries:
        with archive.open(e) as src, open(os.path.join(sys.argv[2], e.filename), "xb") as dst:
            shutil.copyfileobj(src, dst, 1024 * 1024)
