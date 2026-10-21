"""Extract exactly the three digest-bound artifact entries; no shell/archive paths."""
import os
import stat
import sys
import zipfile
import shutil

LIMITS = {"image.tar.gz": 1610612735, "image-receipt.json": 8192, "SHA256SUMS": 1024}


def extract(source, output):
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) != 3 or {e.filename for e in entries} != set(LIMITS):
            raise ValueError("ARTIFACT_ENTRY_SET")
        for e in entries:
            kind = stat.S_IFMT(e.external_attr >> 16)
            if (e.is_dir() or kind not in (0, stat.S_IFREG) or e.flag_bits & 1
                    or not 0 < e.file_size <= LIMITS[e.filename]
                    or e.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                raise ValueError("ARTIFACT_ENTRY_TYPE_OR_SIZE")
        os.mkdir(output, 0o700)  # Exclusive; no takeover, merge or recursive removal.
        for e in entries:
            with archive.open(e) as src, open(os.path.join(output, e.filename), "xb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise ValueError("ARTIFACT_ARGUMENTS")
    extract(sys.argv[1], sys.argv[2])
