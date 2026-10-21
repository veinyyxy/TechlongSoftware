import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("artifact_extract", Path(__file__).resolve().parents[1] / "ops/platform-image-publication-v1/extract.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractionTests(unittest.TestCase):
    def archive(self, root, names=None, link=False):
        source = Path(root) / "input.zip"
        with zipfile.ZipFile(source, "w") as z:
            for name in names or module.LIMITS:
                info = zipfile.ZipInfo(name)
                info.external_attr = (stat.S_IFLNK | 0o777) << 16 if link else (stat.S_IFREG | 0o600) << 16
                z.writestr(info, b"synthetic fixture")
        return source

    def test_exact_entries_and_exclusive_destination(self):
        with tempfile.TemporaryDirectory() as root:
            src = self.archive(root)
            out = Path(root) / "out"
            module.extract(src, out)
            self.assertEqual({p.name for p in out.iterdir()}, set(module.LIMITS))
            with self.assertRaises(FileExistsError):
                module.extract(src, out)

    def test_traversal_extra_and_duplicate_entries(self):
        for names in [["../image.tar.gz", "image-receipt.json", "SHA256SUMS"],
                      ["image.tar.gz", "image-receipt.json", "SHA256SUMS", "extra"],
                      ["image.tar.gz", "image.tar.gz", "SHA256SUMS"]]:
            with self.subTest(names=names), tempfile.TemporaryDirectory() as root:
                src = self.archive(root, names)
                with self.assertRaises(ValueError):
                    module.extract(src, Path(root) / "out")

    def test_symlinks_rejected_before_output_creation(self):
        with tempfile.TemporaryDirectory() as root:
            src = self.archive(root, link=True)
            out = Path(root) / "out"
            with self.assertRaises(ValueError):
                module.extract(src, out)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
